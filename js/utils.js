// ── Number / currency helpers ────────────────────────────────────────────
const fmt = n => new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 2
}).format(n || 0);

function round2(n)    { return Math.round(n * 100) / 100; }

// ── String helpers ───────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}
function uid(p) { return (p || 'I') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// ── Date helpers ─────────────────────────────────────────────────────────
function fmtDate(d) {
  const y   = d.getFullYear();
  const m   = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function todayStr()      { return fmtDate(new Date()); }
function dayKey(d)       { return `day:${d}`; }

function niceDate(dStr) {
  const [y, m, d] = dStr.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric'
  });
}

// Extracts "YYYY-MM-DD" from order IDs like "2026-07-14-5"
function dateFromOrderId(id) {
  const i = id.lastIndexOf('-');
  return i > -1 ? id.slice(0, i) : null;
}

// ── Domain helpers ───────────────────────────────────────────────────────
function emptyDay(dateStr) {
  return { date: dateStr, orders: [], taxable: 0, gst: 0, total: 0, count: 0, nextToken: 1 };
}
function emptyOverall() {
  return { taxable: 0, gst: 0, total: 0, count: 0, byItem: {} };
}
function ensureNextToken(day) {
  if (day.nextToken === undefined || day.nextToken === null) {
    day.nextToken = day.orders.reduce((max, o) => Math.max(max, o.token || 0), 0) + 1;
  }
  return day;
}

// ── Sales date helpers ───────────────────────────────────────────────────
function dowIndex(dateStr)    { const [y,m,d] = dateStr.split('-').map(Number); return (new Date(y,m-1,d).getDay()+6)%7; }
function weekStartOf(dateStr) { const [y,m,d] = dateStr.split('-').map(Number); const dt=new Date(y,m-1,d); dt.setDate(dt.getDate()-((dt.getDay()+6)%7)); return fmtDate(dt); }
function monthLabel(ym)       { const [y,m] = ym.split('-').map(Number); return new Date(y,m-1,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'}); }

// ── Toast notification ───────────────────────────────────────────────────
let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ── Confirm-twice pattern ────────────────────────────────────────────────
function confirmAction(btn, action) {
  if (btn.dataset.confirm === '1') {
    btn.dataset.confirm = '0';
    action();
  } else {
    const orig = btn.textContent;
    btn.dataset.confirm = '1';
    btn.dataset.orig    = orig;
    btn.textContent     = 'Click again to confirm';
    setTimeout(() => {
      if (btn.dataset.confirm === '1') {
        btn.dataset.confirm = '0';
        btn.textContent = btn.dataset.orig;
      }
    }, 4000);
  }
}
