// ── Load & aggregate a date range ────────────────────────────────────────
async function loadRange(range) {
  state.activeRange = range;
  document.querySelectorAll('#rangeRow .range-btn[data-range]').forEach(b =>
    b.classList.toggle('active', b.dataset.range === range)
  );
  document.getElementById('salesContent').innerHTML = 'Loading…';

  let dates;
  if (range === 'all' || range === 'overview') {
    dates = ((await dbGet('all-dates')) || []).slice().sort().reverse();
  } else {
    dates = dateStringsForRange(range);
  }

  const days = await Promise.all(dates.map(d => dbGet(dayKey(d))));
  const agg  = aggregateDays(days);
  agg.range  = range;
  state._currentAgg = agg;

  if (range === 'overview') renderOverview(agg);
  else                      renderSalesReport(agg);
}

// ── Overview (all-time analytics) ────────────────────────────────────────
function renderOverview(agg) {
  const el = document.getElementById('salesContent');
  if (agg.count === 0) {
    el.innerHTML = `<p class="empty-state" style="display:block;">No sales recorded yet — the overview will fill in as you punch orders.</p>`;
    return;
  }

  const bestDOW  = Object.entries(agg.byDOW).sort((a, b) => b[1].total - a[1].total)[0];
  const dowRows  = DOW_NAMES.map((name, i) => {
    const d = agg.byDOW[i];
    if (!d) return `<tr><td>${name}</td><td class="num">—</td><td class="num">—</td><td class="num">—</td></tr>`;
    return `<tr><td>${name}${bestDOW && +bestDOW[0] === i ? ' ⭐' : ''}</td><td class="num">${d.count}</td><td class="num">${fmt(d.total)}</td><td class="num">${fmt(d.total / d.days)}</td></tr>`;
  }).join('');

  const weekRows = Object.entries(agg.byWeek)
    .sort((a, b) => b[0].localeCompare(a[0])).slice(0, 10)
    .map(([wk, w]) => `<tr><td>Week of ${niceDate(wk)}</td><td class="num">${w.count}</td><td class="num">${fmt(w.gst)}</td><td class="num">${fmt(w.total)}</td></tr>`)
    .join('');

  const monthRows = Object.entries(agg.byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([mo, m]) => `<tr><td>${monthLabel(mo)}</td><td class="num">${m.count}</td><td class="num">${fmt(m.taxable)}</td><td class="num">${fmt(m.gst)}</td><td class="num">${fmt(m.total)}</td></tr>`)
    .join('');

  const dailyRows = agg.daily.slice(0, 31)
    .map(d => `<tr><td>${niceDate(d.date)}</td><td class="num">${d.count}</td><td class="num">${fmt(d.gst)}</td><td class="num">${fmt(d.total)}</td></tr>`)
    .join('');

  const payParts  = ['Cash','UPI','Card','Account'].filter(p => agg.byPayment[p]).map(p => `${p} ${fmt(agg.byPayment[p])}`).join(' · ');
  const activeDays = agg.daily.length;

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="label">All-time sales</div><div class="value">${fmt(agg.total)}</div><div class="sub">${payParts}</div></div>
      <div class="stat-card"><div class="label">All-time orders</div><div class="value">${agg.count}</div><div class="sub">across ${activeDays} selling day${activeDays === 1 ? '' : 's'}</div></div>
      <div class="stat-card"><div class="label">Avg per selling day</div><div class="value">${fmt(activeDays ? agg.total / activeDays : 0)}</div></div>
      <div class="stat-card"><div class="label">GST collected (all time)</div><div class="value">${fmt(agg.gst)}</div><div class="sub">CGST ${fmt(agg.gst/2)} · SGST ${fmt(agg.gst/2)}</div></div>
    </div>

    <h4>Sales by day of the week ${bestDOW ? '<span style="font-weight:400;font-size:.78rem;color:var(--ink-soft);">(⭐ = your best day)</span>' : ''}</h4>
    <div class="table-scroll">
      <table class="report-table">
        <thead><tr><th>Day</th><th class="num">Orders</th><th class="num">Total sales</th><th class="num">Avg per day</th></tr></thead>
        <tbody>${dowRows}</tbody>
      </table>
    </div>

    <h4>Weekly sales (last 10 weeks)</h4>
    <div class="table-scroll">
      <table class="report-table">
        <thead><tr><th>Week</th><th class="num">Orders</th><th class="num">GST</th><th class="num">Total</th></tr></thead>
        <tbody>${weekRows}</tbody>
      </table>
    </div>

    <h4>Monthly sales</h4>
    <div class="table-scroll">
      <table class="report-table">
        <thead><tr><th>Month</th><th class="num">Orders</th><th class="num">Taxable</th><th class="num">GST</th><th class="num">Total</th></tr></thead>
        <tbody>${monthRows}</tbody>
      </table>
    </div>

    <h4>Day by day (last 31 selling days)</h4>
    <div class="table-scroll">
      <table class="report-table">
        <thead><tr><th>Date</th><th class="num">Orders</th><th class="num">GST</th><th class="num">Total</th></tr></thead>
        <tbody>${dailyRows}</tbody>
      </table>
    </div>
  `;
}

// ── Standard sales report (today / week / month / all) ───────────────────
function renderSalesReport(agg) {
  const el       = document.getElementById('salesContent');
  state._currentAgg = agg;

  const itemRows = Object.values(agg.byItem || {})
    .sort((a, b) => b.revenue - a.revenue)
    .map(it => `<tr><td>${escapeHtml(it.name)}</td><td class="num">${it.qty}</td><td class="num">${fmt(it.revenue)}</td></tr>`)
    .join('');

  const payParts = ['Cash','UPI','Card','Account']
    .filter(p => agg.byPayment[p])
    .map(p => `${p} ${fmt(agg.byPayment[p])}`).join(' · ');

  // Group orders under date headings
  let orderRows  = '';
  let currentDate = '';
  (agg.orders || []).forEach(o => {
    const oDate = dateFromOrderId(o.id);
    if (oDate !== currentDate) {
      currentDate = oDate;
      orderRows += `<div class="order-day-heading">${niceDate(oDate)}</div>`;
    }
    const d = new Date(o.time);
    const itemsSummary = o.items.map(it => `${it.qty}× ${escapeHtml(it.name)}`).join(', ');
    const payLabel     = o.payment === 'Account' && o.customerName ? `Account (${escapeHtml(o.customerName)})` : escapeHtml(o.payment);
    orderRows += `<div class="order-row">
      <div>
        <strong>#${o.token}</strong>${o.editedAt ? ' <span style="font-size:.68rem;color:var(--ink-soft);">(edited)</span>' : ''}
        <span class="meta">${d.toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'})} · ${itemsSummary} · ${payLabel}</span>
      </div>
      <div style="display:flex;align-items:center;gap:.7rem;">
        <div class="amt">${fmt(o.total)}</div>
        <button class="order-edit"   onclick="startEditOrder('${o.id}')">Edit</button>
        <button class="order-delete" onclick="confirmAction(this, ()=>deleteOrder('${o.id}'))">Delete</button>
      </div>
    </div>`;
  });

  el.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="label">Orders</div><div class="value">${agg.count}</div></div>
      <div class="stat-card"><div class="label">Taxable Value</div><div class="value">${fmt(agg.taxable)}</div></div>
      <div class="stat-card"><div class="label">GST Collected</div><div class="value">${fmt(agg.gst)}</div><div class="sub">CGST ${fmt(agg.gst/2)} · SGST ${fmt(agg.gst/2)}</div></div>
      <div class="stat-card"><div class="label">Grand Total</div><div class="value">${fmt(agg.total)}</div><div class="sub">${payParts || ''}</div></div>
    </div>
    ${agg.count === 0 ? `<p class="empty-state" style="display:block;">No sales recorded for this period yet.</p>` : `
    <div class="table-scroll">
      <table class="report-table">
        <thead><tr><th>Item</th><th class="num">Qty Sold</th><th class="num">Revenue</th></tr></thead>
        <tbody>${itemRows}</tbody>
      </table>
    </div>
    <h4>All orders in this period (${(agg.orders || []).length})</h4>
    <div class="order-row-list">${orderRows}</div>
    `}
  `;
}

// ── Excel / CSV export ───────────────────────────────────────────────────
function loadXLSX() {
  return new Promise((resolve, reject) => {
    if (window.XLSX) return resolve(window.XLSX);
    const s   = document.createElement('script');
    s.src     = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload  = () => window.XLSX ? resolve(window.XLSX) : reject(new Error('XLSX missing'));
    s.onerror = () => reject(new Error('could not load XLSX library'));
    document.head.appendChild(s);
  });
}

function buildReportSections(agg) {
  const rangeLabels = { today:'Today', week:'This Week', month:'This Month', all:'All Time', overview:'All Time' };
  const payRows     = ['Cash','UPI','Card','Account'].filter(p => agg.byPayment[p]).map(p => [p, agg.byPayment[p]]);
  const sections    = [];

  sections.push({ name:'Summary', rows:[
    ['Canteen Sales Report'],
    ['Period', rangeLabels[agg.range] || ''],
    ['Generated', new Date().toLocaleString('en-IN')],
    [],
    ['Orders', agg.count],
    ['Taxable Value', agg.taxable],
    ['CGST', round2(agg.gst/2)],
    ['SGST', round2(agg.gst/2)],
    ['Total GST', agg.gst],
    ['Grand Total', agg.total],
    [],
    ['Payment method','Amount'],
    ...payRows
  ]});

  sections.push({ name:'Daily', rows:[
    ['Date','Orders','Taxable','GST','Total'],
    ...agg.daily.map(d => [d.date, d.count, d.taxable, d.gst, d.total])
  ]});

  if (agg.range === 'all' || agg.range === 'overview') {
    sections.push({ name:'Day of Week', rows:[
      ['Day','Selling days','Orders','Total','Avg per day'],
      ...DOW_NAMES.map((name,i) => {
        const d = agg.byDOW[i];
        return d ? [name, d.days, d.count, d.total, round2(d.total/d.days)] : [name,0,0,0,0];
      })
    ]});
    sections.push({ name:'Weekly', rows:[
      ['Week starting','Orders','GST','Total'],
      ...Object.entries(agg.byWeek).sort((a,b) => b[0].localeCompare(a[0])).map(([wk,w]) => [wk, w.count, w.gst, w.total])
    ]});
    sections.push({ name:'Monthly', rows:[
      ['Month','Orders','Taxable','GST','Total'],
      ...Object.entries(agg.byMonth).sort((a,b) => b[0].localeCompare(a[0])).map(([mo,m]) => [monthLabel(mo), m.count, m.taxable, m.gst, m.total])
    ]});
  }

  sections.push({ name:'Items', rows:[
    ['Item','Qty sold','Revenue'],
    ...Object.values(agg.byItem).sort((a,b) => b.revenue-a.revenue).map(it => [it.name, it.qty, it.revenue])
  ]});

  const orderRows = [['Token','Date','Time','Item','Qty','Price','Line Total','Payment','Customer']];
  agg.orders.forEach(o => {
    const d = new Date(o.time);
    o.items.forEach(it => {
      orderRows.push([o.token, d.toLocaleDateString('en-IN'), d.toLocaleTimeString('en-IN'), it.name, it.qty, it.price, it.lineTotal, o.payment, o.customerName||'']);
    });
  });
  sections.push({ name:'Orders', rows: orderRows });

  return sections;
}

async function exportReport() {
  const agg = state._currentAgg;
  if (!agg || agg.count === 0) { showToast('Nothing to export yet'); return; }
  const sections = buildReportSections(agg);
  const stamp    = todayStr();
  try {
    const XLSX = await loadXLSX();
    const wb   = XLSX.utils.book_new();
    sections.forEach(sec => {
      const ws = XLSX.utils.aoa_to_sheet(sec.rows);
      ws['!cols'] = (sec.rows[0]||[]).map((_,i) => ({
        wch: Math.max(12, ...sec.rows.map(r => String(r[i]??'').length+2).slice(0,50))
      }));
      XLSX.utils.book_append_sheet(wb, ws, sec.name);
    });
    XLSX.writeFile(wb, `canteen-report-${stamp}.xlsx`);
    showToast('Excel report downloaded — check the sheet tabs at the bottom');
  } catch (e) {
    console.error('XLSX failed, falling back to CSV', e);
    const csv = sections.map(sec =>
      `=== ${sec.name} ===\n` + sec.rows.map(r => r.map(v => `"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n')
    ).join('\n\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `canteen-report-${stamp}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    showToast('No internet for Excel — downloaded a CSV instead');
  }
}
