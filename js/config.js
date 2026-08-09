// ── Cloud credentials ────────────────────────────────────────────────────
// Keep these here; rotate the anon key in Supabase dashboard if ever
// the repo becomes public — the anon key is safe for client-side use
// but RLS policies are your real security layer.
const SUPA_URL = 'https://gmimiyaehcpvivqodqts.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdtaW1peWFlaGNwdml2cW9kcXRzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYyNjE3NzcsImV4cCI6MjEwMTgzNzc3N30.5qeqcHVJcIkSXZGVxBDFX9k_-PMzbuVTtoSMcMc8fcE';

// ── Domain constants ─────────────────────────────────────────────────────
const PRESET_CATEGORIES = ['Veg Snacks', 'Non-Veg Snacks', 'Combos', 'Beverages', 'Desserts', 'Other'];
const DOW_NAMES         = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
