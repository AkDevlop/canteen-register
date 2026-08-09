// ── Today pill ───────────────────────────────────────────────────────────
function renderTodayPill() {
  document.getElementById('todayPill').textContent =
    `Today · ${fmt(state.today.total)} · ${state.today.count} order${state.today.count === 1 ? '' : 's'}`;
}

// ── Category chips ───────────────────────────────────────────────────────
function renderCategoryChips() {
  const row = document.getElementById('categoryChips');
  if (!row) return;
  const cats = getUsedCategories();
  if (cats.length <= 1) { row.style.display = 'none'; row.innerHTML = ''; return; }
  if (state.activeCategory !== 'All' && !cats.includes(state.activeCategory)) state.activeCategory = 'All';
  row.style.display = 'flex';
  const chips = ['All', ...cats];
  row.innerHTML = chips.map(c =>
    `<button class="cat-chip ${state.activeCategory === c ? 'active' : ''}" data-category="${escapeHtml(c)}">${escapeHtml(c)}</button>`
  ).join('');
  row.querySelectorAll('.cat-chip').forEach(btn => {
    btn.addEventListener('click', () => setActiveCategory(btn.dataset.category));
  });
}

// ── Menu card ────────────────────────────────────────────────────────────
function renderMenuCard(m) {
  const inCart    = state.cart.find(c => c.id === m.id);
  const avail     = effectiveStock(m);
  const remaining = avail - (inCart ? inCart.qty : 0);
  const out       = remaining <= 0;
  const low       = !out && remaining <= m.threshold;
  const auto      = isAutoStock(m);
  return `<button class="menu-card" ${out ? 'disabled' : ''} onclick="addToCart('${m.id}')">
    <div class="name">${escapeHtml(m.name)}</div>
    <div class="price">${fmt(m.price)}${m.unit ? ` / ${escapeHtml(m.unit)}` : ''}</div>
    <div class="stock ${low ? 'low' : ''}">${out ? (auto ? 'No raw stock' : 'Out of stock') : `${remaining} ${auto ? 'possible' : 'left'}`}</div>
  </button>`;
}

// ── Menu grid ────────────────────────────────────────────────────────────
function renderMenuGrid() {
  renderCategoryChips();
  const q    = (document.getElementById('menuSearch')?.value || '').toLowerCase();
  const grid = document.getElementById('menuGrid');

  if (state.menu.length === 0) {
    grid.innerHTML = `<div class="empty-state">No menu items yet.<br>
      <button class="btn-primary" style="width:auto;display:inline-block;margin:.8rem 0 0;" onclick="switchTab('inventory')">Add your first item</button>
    </div>`;
    return;
  }

  let items = state.menu.filter(m => m.name.toLowerCase().includes(q));
  if (state.activeCategory !== 'All') {
    items = items.filter(m => (m.category || 'Uncategorized') === state.activeCategory);
  }

  if (items.length === 0) {
    const where = state.activeCategory !== 'All' ? ` in ${escapeHtml(state.activeCategory)}` : '';
    grid.innerHTML = `<div class="empty-state">No items match${q ? ` "${escapeHtml(q)}"` : ''}${where}.</div>`;
    return;
  }

  if (state.activeCategory === 'All') {
    let html = '';
    getUsedCategories().forEach(cat => {
      const catItems = items.filter(m => (m.category || 'Uncategorized') === cat);
      if (!catItems.length) return;
      html += `<div class="menu-section-heading">${escapeHtml(cat)}</div>`;
      html += catItems.map(renderMenuCard).join('');
    });
    grid.innerHTML = html;
  } else {
    grid.innerHTML = items.map(renderMenuCard).join('');
  }
}

function flashStockWarning(itemId) {
  const item = state.menu.find(m => m.id === itemId);
  if (!item) { showToast('Not enough stock'); return; }
  showToast(isAutoStock(item)
    ? `Raw materials only allow ${effectiveStock(item)} more ${item.name}`
    : `Only ${item.stock} ${item.name} left in stock`
  );
}

// ── Cart / ticket ────────────────────────────────────────────────────────
function renderCart() {
  const t      = document.getElementById('ticket');
  const totals = cartTotals();
  const token  = state.editing ? state.editing.token : state.today.nextToken;

  const linesHtml = state.cart.length
    ? state.cart.map(l => `
      <div class="ticket-line">
        <div class="qty-ctrl">
          <button onclick="changeQty('${l.id}',-1)">−</button>
          <span>${l.qty}</span>
          <button onclick="changeQty('${l.id}',1)">+</button>
        </div>
        <div class="name">${escapeHtml(l.name)}</div>
        <div class="amt">${fmt(l.price * l.qty)}</div>
        <button class="remove" onclick="removeLine('${l.id}')">✕</button>
      </div>`).join('')
    : `<p class="ticket-empty">Tap a menu item to add it to this order.</p>`;

  const payChips = ['Cash', 'UPI', 'Card', 'Account'].map(p =>
    `<button class="pay-chip ${state.payment === p ? 'active' : ''}" onclick="setPayment('${p}')">${p}</button>`
  ).join('');

  let customerPicker = '';
  if (state.payment === 'Account') {
    if (state.customers.length === 0) {
      customerPicker = `<div class="customer-picker"><div class="bal-note">No customers yet — add them in the Customers tab first.</div></div>`;
    } else {
      const opts = state.customers.slice()
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(c => `<option value="${c.id}" ${state.selectedCustomerId === c.id ? 'selected' : ''}>${escapeHtml(customerLabel(c))} — ${fmt(c.balance)}</option>`)
        .join('');
      const sel = customerById(state.selectedCustomerId);
      let balNote = '';
      if (sel) {
        const after = round2(sel.balance - totals.total);
        balNote = `<div class="bal-note ${after < 0 ? 'negative' : ''}">Balance after order: ${fmt(after)}${after < 0 ? ' (goes into due)' : ''}</div>`;
      }
      customerPicker = `<div class="customer-picker">
        <select onchange="setSelectedCustomer(this.value)">
          <option value="">— Select customer —</option>
          ${opts}
        </select>
        ${balNote}
      </div>`;
    }
  }

  const editBanner = state.editing
    ? `<div class="edit-banner">Editing Token #${state.editing.token} (${niceDate(dateFromOrderId(state.editing.id))}). Complete to save changes, or <button onclick="cancelEdit()">cancel and restore original</button>.</div>`
    : '';

  const lastOrder = state.today.orders[state.today.orders.length - 1];
  const undoHtml  = (!state.editing && lastOrder)
    ? `<div class="undo-bar">Last: Token #${lastOrder.token} · ${fmt(lastOrder.total)} — <button onclick="deleteOrder('${lastOrder.id}')">Undo</button></div>`
    : '';

  t.innerHTML = `
    <div class="ticket-header">
      <span>${state.editing ? 'Editing Order' : 'Order Ticket'}</span>
      <span class="ticket-token">Token #${token}</span>
    </div>
    ${editBanner}
    <div class="ticket-items">${linesHtml}</div>
    <div class="ticket-divider"></div>
    <div class="ticket-totals">
      <div class="row"><span>Taxable Value</span><span>${fmt(totals.taxable)}</span></div>
      <div class="row"><span>CGST</span><span>${fmt(totals.cgst)}</span></div>
      <div class="row"><span>SGST</span><span>${fmt(totals.sgst)}</span></div>
      <div class="row grand"><span>Total</span><span>${fmt(totals.total)}</span></div>
    </div>
    <div class="payment-row">${payChips}</div>
    ${customerPicker}
    <button class="btn-primary" ${state.cart.length === 0 ? 'disabled' : ''} onclick="completeOrder()">
      ${state.editing ? 'Save changes' : 'Complete order'}
    </button>
    <button class="btn-text" onclick="clearCart()">Clear ticket</button>
    ${undoHtml}
  `;
}
