// ── Customers tab ─────────────────────────────────────────────────────────
function renderCustomersTab() {
  const c            = document.getElementById('customersContent');
  const totalBalance = round2(state.customers.reduce((s, x) => s + x.balance, 0));
  const dueCustomers = state.customers.filter(x => x.balance < 0);

  const activityLine = (cu, h, idx) => {
    const d      = new Date(h.time);
    const label  = h.type === 'topup' ? 'Top-up' : (h.type === 'purchase' ? 'Purchase' : 'Refund');
    const controls = h.type === 'topup' ? `
      <button onclick="promptEditTopUp('${cu.id}',${idx},${h.amount})" style="font-size:.72rem;text-decoration:underline;border:none;background:none;color:var(--green-mid);padding:0;">Edit</button>
      <button onclick="confirmAction(this, ()=>deleteTopUp('${cu.id}',${idx}))" style="font-size:.72rem;text-decoration:underline;border:none;background:none;color:var(--chili);padding:0;">Delete</button>
    ` : '';
    return `<div>
      <span>${d.toLocaleDateString('en-IN')} ${d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})} · ${label}${h.note ? ` · ${escapeHtml(h.note)}` : ''}</span>
      <span style="display:flex;align-items:center;gap:.5rem;">
        <span class="t-amt">${h.amount > 0 ? '+' : ''}${fmt(h.amount)}</span>
        ${controls}
      </span>
    </div>`;
  };

  const rows = state.customers.slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(cu => {
      const recentHtml = (cu.history && cu.history.length)
        ? `<div class="cust-history">
            <div style="font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-soft);margin-bottom:.2rem;">Recent — edit or delete a mistaken top-up here</div>
            ${cu.history.slice(0, 3).map((h, idx) => activityLine(cu, h, idx)).join('')}
            ${cu.history.length > 3
              ? `<button onclick="toggleCustomerHistory('${cu.id}')" style="font-size:.72rem;border:none;background:none;color:var(--ink-soft);text-decoration:underline;padding:.2rem 0 0;">
                  ${state.historyOpenCustomerId === cu.id ? 'Hide full history' : `Show all ${cu.history.length} transactions`}
                </button>`
              : ''}
          </div>`
        : `<div class="cust-history" style="color:var(--ink-soft);">No transactions yet.</div>`;

      const fullHistHtml = (state.historyOpenCustomerId === cu.id && cu.history && cu.history.length > 3)
        ? `<tr><td colspan="6">
            <div class="cust-history">
              ${cu.history.map((h, idx) => ({ h, idx })).slice(3, 40).map(({ h, idx }) => activityLine(cu, h, idx)).join('')}
            </div>
          </td></tr>`
        : '';

      return `<tr>
        <td><input class="wide" value="${escapeHtml(cu.name)}" onchange="updateCustomer('${cu.id}','name',this.value)"></td>
        <td><input class="wide" value="${escapeHtml(cu.phone || '')}" placeholder="phone" onchange="updateCustomer('${cu.id}','phone',this.value)"></td>
        <td class="num">
          <span class="cust-balance ${cu.balance < 0 ? 'negative' : ''}">${fmt(cu.balance)}</span>
          ${cu.balance < 0 ? ' <span style="font-size:.7rem;color:var(--chili);">DUE</span>' : ''}
        </td>
        <td style="display:flex;gap:.3rem;align-items:center;">
          <input type="number" min="1" placeholder="₹" id="topup-${cu.id}" style="width:70px;">
          <button onclick="topUpCustomer('${cu.id}')">Add money</button>
        </td>
        <td></td>
        <td><button onclick="confirmAction(this, ()=>deleteCustomer('${cu.id}'))" title="Needs a zero balance">Delete customer</button></td>
      </tr>
      <tr><td colspan="6" style="padding-top:0;">${recentHtml}</td></tr>
      ` + fullHistHtml;
    }).join('');

  c.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="label">Customers</div><div class="value">${state.customers.length}</div></div>
      <div class="stat-card"><div class="label">Wallet money held</div><div class="value">${fmt(totalBalance)}</div><div class="sub">Total of all balances — this is customers' money with you</div></div>
      <div class="stat-card"><div class="label">Customers in due</div><div class="value">${dueCustomers.length}</div><div class="sub">${dueCustomers.length ? dueCustomers.map(x => escapeHtml(x.name)).join(', ') : 'Nobody owes you right now'}</div></div>
    </div>

    <h3>Add a customer</h3>
    <div class="add-item-form">
      <div><label>First name</label><input id="custName" placeholder="e.g. Ramesh"></div>
      <div><label>Phone (or last digits)</label><input id="custPhone" placeholder="e.g. 98765"></div>
      <div><label>Opening balance ₹ (optional)</label><input id="custOpening" type="number" min="0" value="0"></div>
      <div><button class="btn-primary" style="width:100%;margin:0;" onclick="addCustomer()">Add customer</button></div>
    </div>

    ${state.customers.length ? `
    <div class="table-scroll">
      <table class="report-table">
        <thead><tr><th>Name</th><th>Phone</th><th class="num">Balance</th><th>Top up</th><th></th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`
    : `<p class="empty-state" style="display:block;">No customers yet. Add regulars here, top up their balance, and pick "Account" as the payment method when they order.</p>`}
  `;
}
