// ── Application state (single source of truth) ───────────────────────────
const state = {
  menu:                  [],
  raw:                   [],
  customers:             [],
  settings:              { autoDeductRaw: true },
  cart:                  [],
  payment:               'Cash',
  selectedCustomerId:    '',
  editing:               null,    // original order while editing, null otherwise
  recipeEditItemId:      null,    // menu item whose recipe panel is open
  historyOpenCustomerId: null,
  activeTab:             'order',
  activeRange:           'today',
  activeCategory:        'All',
  today:                 null,
  _currentAgg:           null,    // cached aggregation for export
};

// ── Category helpers ─────────────────────────────────────────────────────
function getUsedCategories() {
  const set = new Set(state.menu.map(m => m.category || 'Uncategorized'));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}
function allKnownCategories() {
  const used = state.menu.map(m => m.category).filter(Boolean);
  return Array.from(new Set([...PRESET_CATEGORIES, ...used])).sort((a, b) => a.localeCompare(b));
}
function setActiveCategory(cat) {
  state.activeCategory = cat;
  renderMenuGrid();
}

// ── Stock calculation helpers ────────────────────────────────────────────
function rawById(id)    { return state.raw.find(r => r.id === id); }
function itemRecipe(item) { return (item.recipe || []).filter(l => rawById(l.rawId)); }

function portionsPossible(item) {
  const recipe = itemRecipe(item);
  if (!recipe.length) return null;
  let min = Infinity;
  recipe.forEach(l => {
    const raw = rawById(l.rawId);
    if (!raw || l.qty <= 0) return;
    min = Math.min(min, Math.floor(Math.max(0, raw.stock) / l.qty));
  });
  return min === Infinity ? null : min;
}

function isAutoStock(item) {
  return item.stockMode === 'auto' && itemRecipe(item).length > 0;
}
function effectiveStock(item) {
  if (isAutoStock(item)) {
    const p = portionsPossible(item);
    return p === null ? 0 : p;
  }
  return item.stock;
}

// Returns [{rawId, qty}] aggregated from a cart
function computeRawUsage(cartLines) {
  const usage = {};
  cartLines.forEach(l => {
    const item = state.menu.find(m => m.id === l.id);
    if (!item) return;
    // Auto-stock items ALWAYS consume raw; manual items only when global flag is on
    if (!isAutoStock(item) && !state.settings.autoDeductRaw) return;
    itemRecipe(item).forEach(r => {
      usage[r.rawId] = (usage[r.rawId] || 0) + r.qty * l.qty;
    });
  });
  return Object.entries(usage).map(([rawId, qty]) => ({ rawId, qty: round2(qty) }));
}

// ── Cart helpers ─────────────────────────────────────────────────────────
function cartTotals() {
  let total = 0, taxable = 0;
  state.cart.forEach(l => {
    const lineTotal = l.price * l.qty;
    total   += lineTotal;
    taxable += lineTotal / (1 + l.gst / 100);
  });
  const gst = total - taxable;
  return { total, taxable, gst, cgst: gst / 2, sgst: gst / 2 };
}

// ── Customer helpers ─────────────────────────────────────────────────────
function customerById(id) { return state.customers.find(c => c.id === id); }
function customerLabel(c) {
  const ph = c.phone ? ` (…${String(c.phone).slice(-4)})` : '';
  return `${c.name}${ph}`;
}
async function adjustCustomerBalance(customerId, delta, type, note) {
  const c = customerById(customerId);
  if (!c) return;
  c.balance  = round2(c.balance + delta);
  c.history  = c.history || [];
  c.history.unshift({ time: new Date().toISOString(), type, amount: round2(delta), note: note || '' });
  if (c.history.length > 40) c.history.length = 40;
  await dbSet('customers', state.customers);
}

// ── Sales aggregation ────────────────────────────────────────────────────
function dateStringsForRange(range) {
  const dates = [];
  const now   = new Date();
  if (range === 'today') {
    dates.push(todayStr());
  } else if (range === 'week') {
    for (let i = 0; i < 7; i++) { const d = new Date(now); d.setDate(d.getDate() - i); dates.push(fmtDate(d)); }
  } else if (range === 'month') {
    for (let i = 0; i < 31; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      if (d.getMonth() !== now.getMonth() || d.getFullYear() !== now.getFullYear()) break;
      dates.push(fmtDate(d));
    }
  }
  return dates;
}

function aggregateDays(days) {
  const agg = { taxable:0, gst:0, total:0, count:0, byItem:{}, byPayment:{}, orders:[], daily:[], byDOW:{}, byWeek:{}, byMonth:{} };
  days.filter(Boolean).forEach(day => {
    if (day.count > 0) {
      agg.daily.push({ date:day.date, count:day.count, taxable:day.taxable, gst:day.gst, total:day.total });
      const dow = dowIndex(day.date);
      if (!agg.byDOW[dow]) agg.byDOW[dow] = { days:0, count:0, total:0 };
      agg.byDOW[dow].days++; agg.byDOW[dow].count += day.count; agg.byDOW[dow].total = round2(agg.byDOW[dow].total + day.total);
      const wk = weekStartOf(day.date);
      if (!agg.byWeek[wk]) agg.byWeek[wk] = { count:0, total:0, gst:0 };
      agg.byWeek[wk].count += day.count; agg.byWeek[wk].total = round2(agg.byWeek[wk].total + day.total); agg.byWeek[wk].gst = round2(agg.byWeek[wk].gst + day.gst);
      const mo = day.date.slice(0, 7);
      if (!agg.byMonth[mo]) agg.byMonth[mo] = { count:0, total:0, gst:0, taxable:0 };
      agg.byMonth[mo].count += day.count; agg.byMonth[mo].total = round2(agg.byMonth[mo].total + day.total);
      agg.byMonth[mo].gst = round2(agg.byMonth[mo].gst + day.gst); agg.byMonth[mo].taxable = round2(agg.byMonth[mo].taxable + day.taxable);
    }
    agg.taxable = round2(agg.taxable + day.taxable);
    agg.gst     = round2(agg.gst     + day.gst);
    agg.total   = round2(agg.total   + day.total);
    agg.count  += day.count;
    day.orders.forEach(o => {
      agg.orders.push(o);
      agg.byPayment[o.payment] = round2((agg.byPayment[o.payment] || 0) + o.total);
      o.items.forEach(it => {
        if (!agg.byItem[it.id]) agg.byItem[it.id] = { name:it.name, qty:0, revenue:0 };
        agg.byItem[it.id].qty     += it.qty;
        agg.byItem[it.id].revenue  = round2(agg.byItem[it.id].revenue + it.lineTotal);
      });
    });
  });
  agg.daily.sort((a, b)  => b.date.localeCompare(a.date));
  agg.orders.sort((a, b) => new Date(b.time) - new Date(a.time));
  return agg;
}
