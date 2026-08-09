// ═══════════════════════════════════════════════════════════════════════════
// app.js — Init, tab switching, and all business-logic handlers
// ═══════════════════════════════════════════════════════════════════════════

// ── Init ─────────────────────────────────────────────────────────────────
async function init() {
  // Pull from cloud if menu-items absent locally (new device / cleared browser)
  if (!localStorage.getItem('menu-items') && isOnline) {
    setSyncStatus('syncing');
    const count = await pullAllFromSupa();
    if (count > 0) showToast(`Restored ${count} records from cloud ☁`);
    setSyncStatus('online');
  } else {
    setSyncStatus(isOnline ? 'online' : 'offline');
  }

  state.menu      = (await dbGet('menu-items'))    || [];
  state.raw       = (await dbGet('raw-materials')) || [];
  state.customers = (await dbGet('customers'))     || [];
  const settings  = await dbGet('app-settings');
  if (settings) state.settings = Object.assign({ autoDeductRaw: true }, settings);

  const dStr   = todayStr();
  const day    = await dbGet(dayKey(dStr));
  state.today  = ensureNextToken(day || emptyDay(dStr));

  renderAll();
  setInterval(refreshTodayIfNeeded, 60_000);
}

async function refreshTodayIfNeeded() {
  const dStr = todayStr();
  if (state.today.date !== dStr) {
    const day   = await dbGet(dayKey(dStr));
    state.today = ensureNextToken(day || emptyDay(dStr));
    renderAll();
  }
}

// ── Global render orchestrator ────────────────────────────────────────────
function renderAll() {
  renderTodayPill();
  renderMenuGrid();
  renderCart();
  if (state.activeTab === 'inventory') renderInventoryTab();
  if (state.activeTab === 'raw')       renderRawTab();
  if (state.activeTab === 'customers') renderCustomersTab();
  if (state.activeTab === 'sales')     loadRange(state.activeRange);
}

// ── Tab switching ─────────────────────────────────────────────────────────
function switchTab(tab) {
  state.activeTab = tab;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  ['order','sales','inventory','raw','customers'].forEach(t => {
    document.getElementById('panel-' + t).style.display = tab === t ? 'block' : 'none';
  });
  if (tab === 'sales')     loadRange(state.activeRange);
  if (tab === 'inventory') renderInventoryTab();
  if (tab === 'raw')       renderRawTab();
  if (tab === 'customers') renderCustomersTab();
}

// ── Cart actions ──────────────────────────────────────────────────────────
function addToCart(itemId) {
  const item = state.menu.find(m => m.id === itemId);
  if (!item) return;
  const line       = state.cart.find(c => c.id === itemId);
  const currentQty = line ? line.qty : 0;
  if (effectiveStock(item) - currentQty <= 0) { flashStockWarning(itemId); return; }
  if (line) line.qty++;
  else state.cart.push({ id: item.id, name: item.name, price: item.price, gst: item.gst, qty: 1 });
  renderCart(); renderMenuGrid();
}

function changeQty(itemId, delta) {
  const line   = state.cart.find(c => c.id === itemId);
  if (!line) return;
  const item   = state.menu.find(m => m.id === itemId);
  const newQty = line.qty + delta;
  if (newQty <= 0) {
    state.cart = state.cart.filter(c => c.id !== itemId);
  } else if (item && newQty > effectiveStock(item)) {
    flashStockWarning(itemId); return;
  } else {
    line.qty = newQty;
  }
  renderCart(); renderMenuGrid();
}

function removeLine(itemId)       { state.cart = state.cart.filter(c => c.id !== itemId); renderCart(); renderMenuGrid(); }
function clearCart()              { state.cart = []; renderCart(); renderMenuGrid(); }
function setPayment(p)            { state.payment = p; renderCart(); }
function setSelectedCustomer(id)  { state.selectedCustomerId = id; renderCart(); }

// ── Order record engine ───────────────────────────────────────────────────
async function addOrderRecord(order) {
  const dateStr   = dateFromOrderId(order.id);
  let dayRecord   = (dateStr === state.today.date)
    ? state.today
    : ensureNextToken((await dbGet(dayKey(dateStr))) || emptyDay(dateStr));

  dayRecord.orders.push(order);
  dayRecord.orders.sort((a, b) => a.token - b.token);
  dayRecord.taxable   = round2(dayRecord.taxable + order.taxable);
  dayRecord.gst       = round2(dayRecord.gst     + order.gst);
  dayRecord.total     = round2(dayRecord.total   + order.total);
  dayRecord.count    += 1;
  dayRecord.nextToken = Math.max(dayRecord.nextToken, order.token + 1);
  await dbSet(dayKey(dateStr), dayRecord);
  if (dateStr === state.today.date) state.today = dayRecord;

  // Deduct finished-goods stock (auto-stock items are tracked via raw materials)
  order.items.forEach(it => {
    if (it.autoStock) return;
    const item = state.menu.find(m => m.id === it.id);
    if (item) item.stock = Math.max(0, item.stock - it.qty);
  });
  await dbSet('menu-items', state.menu);

  // Deduct raw materials
  if (order.rawUsage && order.rawUsage.length) {
    order.rawUsage.forEach(u => {
      const raw = rawById(u.rawId);
      if (raw) raw.stock = round2(raw.stock - u.qty);
    });
    await dbSet('raw-materials', state.raw);
  }

  // Customer account debit
  if (order.payment === 'Account' && order.customerId) {
    await adjustCustomerBalance(order.customerId, -order.total, 'purchase', `Token #${order.token} (${dateStr})`);
  }

  // Dates index
  let dates = await dbGet('all-dates') || [];
  if (!dates.includes(dateStr)) { dates.push(dateStr); await dbSet('all-dates', dates); }

  // Overall summary
  let overall = await dbGet('overall-summary') || emptyOverall();
  overall.taxable = round2(overall.taxable + order.taxable);
  overall.gst     = round2(overall.gst     + order.gst);
  overall.total   = round2(overall.total   + order.total);
  overall.count  += 1;
  order.items.forEach(it => {
    if (!overall.byItem[it.id]) overall.byItem[it.id] = { name: it.name, qty: 0, revenue: 0 };
    overall.byItem[it.id].qty     += it.qty;
    overall.byItem[it.id].revenue  = round2(overall.byItem[it.id].revenue + it.lineTotal);
  });
  await dbSet('overall-summary', overall);
}

async function removeOrderRecord(orderId) {
  const dateStr  = dateFromOrderId(orderId);
  if (!dateStr) return null;
  let dayRecord  = (dateStr === state.today.date) ? state.today : await dbGet(dayKey(dateStr));
  if (!dayRecord) return null;

  const idx = dayRecord.orders.findIndex(o => o.id === orderId);
  if (idx === -1) return null;
  const removed = dayRecord.orders[idx];

  dayRecord.orders.splice(idx, 1);
  dayRecord.taxable  = round2(dayRecord.taxable - removed.taxable);
  dayRecord.gst      = round2(dayRecord.gst     - removed.gst);
  dayRecord.total    = round2(dayRecord.total   - removed.total);
  dayRecord.count    = Math.max(0, dayRecord.count - 1);
  ensureNextToken(dayRecord);
  await dbSet(dayKey(dateStr), dayRecord);
  if (dateStr === state.today.date) state.today = dayRecord;

  // Restore finished-goods stock
  removed.items.forEach(it => {
    if (it.autoStock) return;
    const item = state.menu.find(m => m.id === it.id);
    if (item) item.stock += it.qty;
  });
  await dbSet('menu-items', state.menu);

  // Restore raw materials
  if (removed.rawUsage && removed.rawUsage.length) {
    removed.rawUsage.forEach(u => {
      const raw = rawById(u.rawId);
      if (raw) raw.stock = round2(raw.stock + u.qty);
    });
    await dbSet('raw-materials', state.raw);
  }

  // Customer account credit
  if (removed.payment === 'Account' && removed.customerId) {
    await adjustCustomerBalance(removed.customerId, removed.total, 'refund', `Token #${removed.token} (${dateStr}) reversed`);
  }

  // Overall summary
  let overall = await dbGet('overall-summary') || emptyOverall();
  overall.taxable = round2(overall.taxable - removed.taxable);
  overall.gst     = round2(overall.gst     - removed.gst);
  overall.total   = round2(overall.total   - removed.total);
  overall.count   = Math.max(0, overall.count - 1);
  removed.items.forEach(it => {
    if (overall.byItem[it.id]) {
      overall.byItem[it.id].qty     -= it.qty;
      overall.byItem[it.id].revenue  = round2(overall.byItem[it.id].revenue - it.lineTotal);
      if (overall.byItem[it.id].qty <= 0) delete overall.byItem[it.id];
    }
  });
  await dbSet('overall-summary', overall);
  return removed;
}

// ── Order actions ─────────────────────────────────────────────────────────
async function completeOrder() {
  if (state.cart.length === 0) return;
  if (state.payment === 'Account') {
    const cust = customerById(state.selectedCustomerId);
    if (!cust) { showToast('Select a customer for account payment'); return; }
  }

  const totals = cartTotals();
  const dStr   = state.editing ? dateFromOrderId(state.editing.id) : todayStr();
  if (!state.editing && state.today.date !== dStr) state.today = emptyDay(dStr);

  const token = state.editing ? state.editing.token : state.today.nextToken;
  const cust  = state.payment === 'Account' ? customerById(state.selectedCustomerId) : null;

  const order = {
    id:          state.editing ? state.editing.id : `${dStr}-${token}`,
    token,
    time:        state.editing ? state.editing.time : new Date().toISOString(),
    editedAt:    state.editing ? new Date().toISOString() : undefined,
    items:       state.cart.map(l => {
      const menuItem = state.menu.find(m => m.id === l.id);
      return { id:l.id, name:l.name, qty:l.qty, price:l.price, gst:l.gst, lineTotal:round2(l.price*l.qty), autoStock: menuItem ? isAutoStock(menuItem) : false };
    }),
    taxable:     round2(totals.taxable),
    gst:         round2(totals.gst),
    total:       round2(totals.total),
    payment:     state.payment,
    customerId:  cust ? cust.id   : undefined,
    customerName:cust ? cust.name : undefined,
    rawUsage:    computeRawUsage(state.cart)
  };

  const wasEditing = !!state.editing;
  await addOrderRecord(order);
  state.cart = []; state.payment = 'Cash'; state.selectedCustomerId = ''; state.editing = null;
  renderAll();
  showToast(wasEditing ? `Token #${token} updated` : `Token #${token} · ${fmt(order.total)} saved`);
}

async function deleteOrder(orderId) {
  const removed = await removeOrderRecord(orderId);
  if (!removed) { showToast('Could not find that order'); return; }
  renderAll();
  showToast(`Token #${removed.token} removed`);
}

async function startEditOrder(orderId) {
  if (state.editing) { showToast('Finish or cancel the current edit first'); return; }
  const removed = await removeOrderRecord(orderId);
  if (!removed) { showToast('Could not find that order'); return; }
  state.editing            = removed;
  state.cart               = removed.items.map(it => ({ id:it.id, name:it.name, price:it.price, gst:it.gst, qty:it.qty }));
  state.payment            = removed.payment;
  state.selectedCustomerId = removed.customerId || '';
  switchTab('order');
  renderAll();
  showToast(`Editing Token #${removed.token} — make changes, then Save`);
}

async function cancelEdit() {
  if (!state.editing) return;
  const original = state.editing;
  state.editing = null; state.cart = []; state.payment = 'Cash'; state.selectedCustomerId = '';
  await addOrderRecord(original);
  renderAll();
  showToast(`Token #${original.token} restored unchanged`);
}

// ── Menu item CRUD ────────────────────────────────────────────────────────
async function addMenuItem(data) {
  const item = { id:uid('I'), name:data.name, category:data.category||'Uncategorized', price:+data.price||0, gst:+data.gst||0, stock:+data.stock||0, stockMode:'manual', threshold:+data.threshold||5, unit:data.unit||'', recipe:[] };
  state.menu.push(item);
  await dbSet('menu-items', state.menu);
  renderAll();
  showToast(`${item.name} added — set a recipe to track stock from raw materials, or manage it manually`);
}

function submitNewItem() {
  const name  = document.getElementById('newName').value.trim();
  const price = document.getElementById('newPrice').value;
  if (!name || !price) { showToast('Enter a name and price first'); return; }
  addMenuItem({
    name, price,
    category:  document.getElementById('newCategory').value.trim(),
    gst:       document.getElementById('newGst').value,
    stock:     document.getElementById('newStock').value,
    threshold: document.getElementById('newThreshold').value,
    unit:      document.getElementById('newUnit').value.trim()
  });
}

async function updateMenuItem(id, field, value) {
  const item = state.menu.find(m => m.id === id);
  if (!item) return;
  item[field] = (['name','unit','category'].includes(field)) ? value : +value;
  await dbSet('menu-items', state.menu);
  renderMenuGrid(); renderInventoryTab();
}

async function restock(id, qty) {
  if (!qty || qty <= 0) { showToast('Enter a quantity to add'); return; }
  const item = state.menu.find(m => m.id === id);
  if (!item) return;
  item.stock += qty;
  await dbSet('menu-items', state.menu);
  renderAll();
  showToast(`${item.name}: +${qty} stock`);
}

async function setStock(id, value) {
  const item = state.menu.find(m => m.id === id);
  if (!item) return;
  const v = +value;
  if (isNaN(v) || v < 0) { showToast('Enter a valid stock number'); return; }
  item.stock = v;
  await dbSet('menu-items', state.menu);
  renderAll();
  showToast(`${item.name}: stock set to ${v}`);
}

async function setStockMode(id, mode) {
  const item = state.menu.find(m => m.id === id);
  if (!item) return;
  if (mode === 'auto' && itemRecipe(item).length === 0) {
    showToast('Add a recipe first — auto stock is calculated from raw materials');
    renderInventoryTab(); return;
  }
  item.stockMode = mode;
  await dbSet('menu-items', state.menu);
  renderAll();
  showToast(mode === 'auto' ? `${item.name}: stock now tracked from raw materials` : `${item.name}: stock now manual`);
}

async function deleteMenuItem(id) {
  state.menu = state.menu.filter(m => m.id !== id);
  if (state.recipeEditItemId === id) state.recipeEditItemId = null;
  await dbSet('menu-items', state.menu);
  renderAll();
}

async function resetAllData() {
  const dates = await dbGet('all-dates') || [];
  await Promise.all(dates.map(d => dbDelete(dayKey(d))));
  await dbDelete('all-dates'); await dbDelete('overall-summary');
  await dbDelete('menu-items'); await dbDelete('raw-materials'); await dbDelete('customers');
  await clearSupabaseStore();
  state.menu = []; state.raw = []; state.customers = [];
  state.cart = []; state.editing = null;
  state.today = emptyDay(todayStr());
  renderAll(); showToast('All data cleared');
}

// ── Recipe CRUD ───────────────────────────────────────────────────────────
function toggleRecipeEditor(itemId) {
  state.recipeEditItemId = state.recipeEditItemId === itemId ? null : itemId;
  renderInventoryTab();
}

async function addRecipeLine(itemId) {
  const item = state.menu.find(m => m.id === itemId);
  if (!item) return;
  if (state.raw.length === 0) { showToast('Add raw materials first (Raw Materials tab)'); return; }
  item.recipe = item.recipe || [];
  const usedIds     = item.recipe.map(l => l.rawId);
  const firstUnused = state.raw.find(r => !usedIds.includes(r.id)) || state.raw[0];
  item.recipe.push({ rawId: firstUnused.id, qty: 0 });
  await dbSet('menu-items', state.menu);
  renderInventoryTab();
}

async function updateRecipeLine(itemId, index, field, value) {
  const item = state.menu.find(m => m.id === itemId);
  if (!item || !item.recipe || !item.recipe[index]) return;
  if (field === 'rawId') item.recipe[index].rawId = value;
  else                   item.recipe[index].qty   = Math.max(0, +value || 0);
  await dbSet('menu-items', state.menu);
  renderInventoryTab();
}

async function removeRecipeLine(itemId, index) {
  const item = state.menu.find(m => m.id === itemId);
  if (!item || !item.recipe) return;
  item.recipe.splice(index, 1);
  if (item.stockMode === 'auto' && item.recipe.length === 0) item.stockMode = 'manual';
  await dbSet('menu-items', state.menu);
  renderInventoryTab();
}

async function addFromMenuItem(itemId, sourceId, qty) {
  const item   = state.menu.find(m => m.id === itemId);
  const source = state.menu.find(m => m.id === sourceId);
  if (!item || !source) { showToast('Pick an item to copy ingredients from'); return; }
  if (source.id === item.id) { showToast("An item can't use itself as an ingredient"); return; }
  const sourceRecipe = itemRecipe(source);
  if (!sourceRecipe.length) { showToast(`${source.name} doesn't have a recipe yet`); return; }
  const multiplier = Math.max(0.01, +qty || 1);
  item.recipe = item.recipe || [];
  sourceRecipe.forEach(line => {
    const addQty   = round2(line.qty * multiplier);
    const existing = item.recipe.find(l => l.rawId === line.rawId);
    if (existing) existing.qty = round2(existing.qty + addQty);
    else          item.recipe.push({ rawId: line.rawId, qty: addQty });
  });
  await dbSet('menu-items', state.menu);
  renderInventoryTab();
  showToast(`Copied ${source.name}'s ingredients${multiplier !== 1 ? ` (×${multiplier})` : ''} into ${item.name}'s recipe`);
}

// ── Raw material CRUD ─────────────────────────────────────────────────────
async function addRawMaterial() {
  const name      = document.getElementById('rawName').value.trim();
  const unit      = document.getElementById('rawUnit').value;
  const stock     = +document.getElementById('rawStock').value     || 0;
  const threshold = +document.getElementById('rawThreshold').value || 0;
  if (!name) { showToast('Enter a raw material name'); return; }
  state.raw.push({ id: uid('R'), name, unit, stock, threshold });
  await dbSet('raw-materials', state.raw);
  renderRawTab();
  showToast(`${name} added to raw materials`);
}

async function updateRawMaterial(id, field, value) {
  const raw = rawById(id);
  if (!raw) return;
  raw[field] = (['name','unit'].includes(field)) ? value : +value;
  await dbSet('raw-materials', state.raw);
  renderRawTab();
}

async function adjustRawStock(id, delta) {
  if (!delta) { showToast('Enter a quantity'); return; }
  const raw = rawById(id);
  if (!raw) return;
  raw.stock = round2(raw.stock + delta);
  await dbSet('raw-materials', state.raw);
  renderRawTab();
  showToast(`${raw.name}: ${delta > 0 ? '+' : ''}${delta} ${raw.unit}`);
}

async function deleteRawMaterial(id) {
  state.raw = state.raw.filter(r => r.id !== id);
  // Clean up recipes and drop auto-stock mode if no ingredients remain
  state.menu.forEach(m => {
    if (m.recipe) m.recipe = m.recipe.filter(l => l.rawId !== id);
    if (m.stockMode === 'auto' && (!m.recipe || !m.recipe.length)) m.stockMode = 'manual';
  });
  await dbSet('raw-materials', state.raw);
  await dbSet('menu-items', state.menu);
  renderRawTab();
}

async function toggleAutoDeduct(checked) {
  state.settings.autoDeductRaw = !!checked;
  await dbSet('app-settings', state.settings);
  showToast(state.settings.autoDeductRaw
    ? 'Auto-deduct ON — orders will use up raw materials via recipes'
    : 'Auto-deduct OFF — adjust raw stock manually'
  );
}

// ── Customer CRUD ─────────────────────────────────────────────────────────
async function addCustomer() {
  const name    = document.getElementById('custName').value.trim();
  const phone   = document.getElementById('custPhone').value.trim();
  const opening = +document.getElementById('custOpening').value || 0;
  if (!name) { showToast("Enter the customer's name"); return; }
  const cust = { id:uid('C'), name, phone, balance:round2(opening), history:[] };
  if (opening > 0) cust.history.push({ time:new Date().toISOString(), type:'topup', amount:opening, note:'Opening balance' });
  state.customers.push(cust);
  await dbSet('customers', state.customers);
  renderCustomersTab();
  showToast(`${name} added${opening > 0 ? ` with ${fmt(opening)}` : ''}`);
}

async function updateCustomer(id, field, value) {
  const c = customerById(id);
  if (!c) return;
  c[field] = value;
  await dbSet('customers', state.customers);
  renderCustomersTab();
}

async function topUpCustomer(id) {
  const input  = document.getElementById('topup-' + id);
  const amount = +input.value;
  if (!amount || amount <= 0) { showToast('Enter a top-up amount'); return; }
  await adjustCustomerBalance(id, amount, 'topup', 'Top-up at counter');
  input.value = '';
  renderCustomersTab();
  const c = customerById(id);
  showToast(`${c.name}: +${fmt(amount)} — balance ${fmt(c.balance)}`);
}

async function deleteCustomer(id) {
  const c = customerById(id);
  if (c && Math.abs(c.balance) > 0.005) {
    showToast(`${c.name} has a balance of ${fmt(c.balance)} — settle it before deleting`);
    return;
  }
  state.customers = state.customers.filter(x => x.id !== id);
  await dbSet('customers', state.customers);
  renderCustomersTab();
}

async function deleteTopUp(customerId, index) {
  const c = customerById(customerId);
  if (!c || !c.history || !c.history[index]) { showToast('Could not find that entry'); return; }
  const entry = c.history[index];
  if (entry.type !== 'topup') { showToast('Only top-ups can be deleted here — reverse purchases by deleting/editing the order in Sales'); return; }
  c.history.splice(index, 1);
  c.balance = round2(c.balance - entry.amount);
  await dbSet('customers', state.customers);
  renderCustomersTab();
  showToast(`Removed ${fmt(entry.amount)} top-up — ${c.name}'s balance is now ${fmt(c.balance)}`);
}

async function editTopUp(customerId, index, newAmount) {
  const c = customerById(customerId);
  if (!c || !c.history || !c.history[index]) { showToast('Could not find that entry'); return; }
  const entry = c.history[index];
  if (entry.type !== 'topup') { showToast('Only top-ups can be edited here'); return; }
  const val = +newAmount;
  if (isNaN(val) || val <= 0) { showToast('Enter a valid amount'); return; }
  const delta  = round2(val - entry.amount);
  entry.amount = round2(val);
  c.balance    = round2(c.balance + delta);
  await dbSet('customers', state.customers);
  renderCustomersTab();
  showToast(`Top-up corrected to ${fmt(val)} — ${c.name}'s balance is now ${fmt(c.balance)}`);
}

function promptEditTopUp(customerId, index, currentAmount) {
  const val = window.prompt('Correct top-up amount (₹):', currentAmount);
  if (val === null) return;
  editTopUp(customerId, index, val);
}

function toggleCustomerHistory(id) {
  state.historyOpenCustomerId = state.historyOpenCustomerId === id ? null : id;
  renderCustomersTab();
}

// ── Backup / restore ──────────────────────────────────────────────────────
function backupAllData() {
  const dump = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    dump[k]  = localStorage.getItem(k);
  }
  const blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `canteen-backup-${todayStr()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showToast('Backup file downloaded');
}

function restoreFromBackup(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const dump = JSON.parse(reader.result);
      const keys = Object.keys(dump);
      if (!keys.length) { showToast('That file has no data in it'); return; }

      // 1. Restore to localStorage immediately (app works offline too)
      keys.forEach(k => localStorage.setItem(k, dump[k]));
      showToast(`↑ Pushing ${keys.length} records to cloud — please wait…`);

      // 2. Parse each JSON string back to real value for Supabase JSONB
      const rows = keys.map(k => {
        let value;
        try { value = JSON.parse(dump[k]); } catch (e) { value = dump[k]; }
        return { key: k, value, updated_at: new Date().toISOString() };
      });

      // 3. Upsert in small batches to avoid oversized requests
      const CHUNK = 8;
      let errors  = 0;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const chunk = rows.slice(i, i + CHUNK);
        const { error } = await supa.from('store').upsert(chunk, { onConflict: 'key' });
        if (error) { console.error('Supabase batch error', error); errors++; }
      }

      showToast(errors === 0
        ? `☁ All ${keys.length} records restored & synced to Supabase!`
        : `Local restore done — ${errors} cloud batch(es) failed (check console)`
      );
      setTimeout(() => location.reload(), 1800);
    } catch (e) {
      console.error(e);
      showToast('Could not read that file — is it a canteen backup .json?');
    }
  };
  reader.readAsText(file);
}

// ── Boot ──────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
