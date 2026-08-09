// ── Supabase client ──────────────────────────────────────────────────────
const supa = window.supabase.createClient(SUPA_URL, SUPA_KEY);

// ── Online/offline state ─────────────────────────────────────────────────
let isOnline       = navigator.onLine;
let pendingSync    = {};        // key → value queued while offline / on error
let syncRetryTimer = null;

window.addEventListener('online',  () => { isOnline = true;  setSyncStatus('online');  flushPending(); });
window.addEventListener('offline', () => { isOnline = false; setSyncStatus('offline'); });

// ── Sync-status pill ─────────────────────────────────────────────────────
function setSyncStatus(s) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  const labels = { syncing: '↑ Syncing…', online: '☁ Synced', offline: '⚡ Offline', error: '⚠ Sync error' };
  el.textContent  = labels[s] || s;
  el.className    = 'sync-pill ' + s;
}

// ── Supabase write helpers ───────────────────────────────────────────────
async function pushToSupa(key, value) {
  if (!isOnline) { pendingSync[key] = value; return; }
  try {
    setSyncStatus('syncing');
    const { error } = await supa.from('store').upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) throw error;
    delete pendingSync[key];
    if (Object.keys(pendingSync).length === 0) setSyncStatus('online');
  } catch (e) {
    console.warn('Supabase sync deferred:', key, e.message);
    pendingSync[key] = value;
    setSyncStatus('error');
    clearTimeout(syncRetryTimer);
    syncRetryTimer = setTimeout(flushPending, 30_000);
  }
}

async function flushPending() {
  const keys = Object.keys(pendingSync);
  if (!keys.length || !isOnline) return;
  setSyncStatus('syncing');
  const rows = keys.map(k => ({ key: k, value: pendingSync[k], updated_at: new Date().toISOString() }));
  try {
    const { error } = await supa.from('store').upsert(rows);
    if (error) throw error;
    pendingSync = {};
    setSyncStatus('online');
  } catch (e) {
    console.warn('Supabase flush failed:', e.message);
    setSyncStatus('error');
    clearTimeout(syncRetryTimer);
    syncRetryTimer = setTimeout(flushPending, 60_000);
  }
}

async function deleteFromSupa(key) {
  if (!isOnline) return;
  try { await supa.from('store').delete().eq('key', key); } catch (e) { /* non-critical */ }
}

async function clearSupabaseStore() {
  if (!isOnline) return;
  try {
    await supa.from('store').delete().neq('key', '__placeholder__');
  } catch (e) { console.warn('Supabase clear failed', e); }
}

// ── Pull all cloud data to localStorage ─────────────────────────────────
async function pullAllFromSupa() {
  try {
    const { data, error } = await supa.from('store').select('key, value');
    if (error) throw error;
    if (data && data.length) {
      data.forEach(row => localStorage.setItem(row.key, JSON.stringify(row.value)));
      return data.length;
    }
    return 0;
  } catch (e) {
    console.warn('Supabase pull failed:', e.message);
    return 0;
  }
}

// ── Manual force-pull (triggered by "Re-sync from cloud" button) ─────────
async function forcePullFromCloud() {
  if (!isOnline) { showToast('You are offline — connect to the internet first'); return; }
  showToast('☁ Pulling all data from Supabase…');
  setSyncStatus('syncing');
  const count = await pullAllFromSupa();
  if (count > 0) {
    showToast(`✓ Pulled ${count} records from cloud — reloading…`);
    setSyncStatus('online');
    setTimeout(() => location.reload(), 1200);
  } else {
    setSyncStatus('online');
    showToast('Cloud is empty — nothing to pull. Import a backup first.');
  }
}

// ── Hybrid storage API (localStorage-first, Supabase in background) ──────
async function dbGet(key) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : null;
  } catch (e) { return null; }
}

async function dbSet(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    pushToSupa(key, value);   // fire-and-forget — never blocks the UI
    return true;
  } catch (e) {
    console.error('storage set failed', key, e);
    showToast('Could not save — storage may be full or disabled');
    return false;
  }
}

async function dbDelete(key) {
  try { localStorage.removeItem(key); deleteFromSupa(key); } catch (e) { /* ignore */ }
}
