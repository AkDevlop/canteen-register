# Canteen Register

A lightweight, offline-first Point-of-Sale (POS) system for a canteen.  
No framework. No build step. Vanilla HTML + CSS + JS deployed on Vercel with Supabase as the cloud backup.

---

## What it does

| Tab | Purpose |
|---|---|
| **New Order** | Browse menu, add items to cart, punch orders (Cash / UPI / Card / Account) |
| **Sales & GST** | View daily / weekly / monthly sales; GST breakdown; export to Excel |
| **Inventory & Menu** | Add/edit menu items, manage stock, set up recipes |
| **Raw Materials** | Track raw material stock; see how many portions you can make |
| **Customers** | Manage customer wallet balances; top-up / purchase history |

---

## Tech Stack

| Layer | What's used |
|---|---|
| Frontend | Vanilla HTML, CSS, JavaScript (no framework, no build step) |
| Storage (primary) | `localStorage` — works fully offline |
| Storage (backup) | [Supabase](https://supabase.com) — Postgres via REST API |
| Hosting | [Vercel](https://vercel.com) — auto-deploys on every `git push` to `main` |
| Fonts | Google Fonts (Inter, IBM Plex Mono, Archivo) |
| Excel export | [SheetJS (xlsx)](https://sheetjs.com/) — loaded on demand from CDN |

---

## File Structure

```
canteen-register/
│
├── index.html                  ← App shell (HTML skeleton only, no logic)
├── import-to-supabase.html     ← One-time migration tool (see "Data Import" below)
│
├── css/
│   └── styles.css              ← All styling — design tokens, layout, responsive
│
└── js/
    ├── config.js               ← Supabase credentials + app-wide constants
    ├── db.js                   ← Storage engine (localStorage + Supabase sync)
    ├── utils.js                ← Pure helper functions (formatting, dates, UI)
    ├── state.js                ← App state singleton + domain calculations
    ├── app.js                  ← App init + all business logic (CRUD, orders)
    │
    └── render/                 ← One file per tab — only HTML generation
        ├── order.js            ← Menu grid + cart/ticket
        ├── inventory.js        ← Inventory table + recipe editor
        ├── raw.js              ← Raw materials table + portions tracker
        ├── customers.js        ← Customers table + transaction history
        └── sales.js            ← Sales report + Excel/CSV export
```

### Script load order (matters — no bundler)

```html
config.js   →  db.js  →  utils.js  →  state.js
  →  render/order.js  →  render/inventory.js  →  render/raw.js
  →  render/customers.js  →  render/sales.js  →  app.js
```

All scripts share the `window` (global) scope. Functions defined in any script are accessible from all scripts loaded after it. `app.js` loads last because it calls `init()` which depends on everything else.

---

## File-by-file Breakdown

### `index.html`
Pure HTML skeleton — topbar, tab buttons, five `<section>` panels, a toast element.  
Contains **zero business logic**. All tab content is injected by the render functions.

### `css/styles.css`
All CSS in one file, structured in sections:

- **Design tokens** — colours, spacing, radii in `:root` CSS variables  
- **Component styles** — topbar, tabs, menu grid, ticket/cart, tables, forms  
- **Responsive breakpoints** — 900px (tablet), 780px (order layout), 640px (phone), 420px (small phone)  
- **Dark/light theme** — `prefers-color-scheme` + explicit `data-theme` attribute support  
- **Reduce-motion** — disables all transitions/animations when the user prefers it  

Key mobile behaviour:
- Cart/ticket becomes `position: sticky; bottom: 0` at ≤ 780px (stays visible while scrolling menu)
- All tables are wrapped in `.table-scroll { overflow-x: auto }` for horizontal scroll on narrow screens
- Inventory table switches to a **2-column card layout** at ≤ 640px using CSS grid areas + `data-label` attributes

---

### `js/config.js`
```js
const SUPA_URL  = '...';          // Supabase project URL
const SUPA_KEY  = '...';          // Supabase anon key (safe for client-side)
const PRESET_CATEGORIES = [...];  // Default menu categories shown in dropdowns
const DOW_NAMES = [...];          // ['Mon','Tue',...,'Sun'] for sales charts
```
> **Security note:** The anon key is public by design — Supabase Row Level Security (RLS) is the real access control. If this repo goes fully public, rotate the key in the Supabase dashboard.

---

### `js/db.js` — Storage Engine

This is the core of the offline-first architecture.

**How writes work:**
```
dbSet(key, value)
  ├─ localStorage.setItem(key, JSON.stringify(value))   ← instant, synchronous
  └─ pushToSupa(key, value)                             ← async, fire-and-forget
       ├─ online  → upsert to Supabase immediately
       └─ offline → queue in pendingSync{}, retry in 30s
```

**How reads work:**
```
dbGet(key)
  └─ localStorage.getItem(key)   ← always reads locally, never waits for network
```

**On first load (fresh device):**
```
init()
  └─ if 'menu-items' not in localStorage
       └─ pullAllFromSupa()   ← SELECT all rows → write to localStorage → reload
```

**Key functions:**

| Function | What it does |
|---|---|
| `dbGet(key)` | Read from localStorage, return parsed JSON |
| `dbSet(key, value)` | Write to localStorage + push to Supabase in background |
| `dbDelete(key)` | Remove from localStorage + delete from Supabase |
| `pushToSupa(key, value)` | Upsert a single row; queues on failure, retries in 30s |
| `flushPending()` | Batch-upsert all queued writes; retries in 60s on failure |
| `pullAllFromSupa()` | SELECT * from Supabase → write everything to localStorage |
| `forcePullFromCloud()` | Manual "Re-sync from cloud" button handler — pulls + reloads |
| `setSyncStatus(s)` | Updates the sync pill: `syncing` / `online` / `offline` / `error` |

---

### `js/utils.js` — Pure Helpers

No side effects, no state. Safe to call from anywhere.

| Function | What it does |
|---|---|
| `fmt(n)` | Format as Indian Rupee: `fmt(150)` → `₹150.00` |
| `round2(n)` | Round to 2 decimal places |
| `escapeHtml(s)` | Escape `& < > " '` to prevent XSS in innerHTML |
| `uid(prefix)` | Generate a unique ID: `uid('I')` → `'Il8f3k2a9x'` |
| `todayStr()` | Today as `'YYYY-MM-DD'` |
| `dayKey(dateStr)` | `'day:2026-08-09'` — the localStorage key for a day's data |
| `niceDate(dStr)` | `'2026-08-09'` → `'Sat, 9 Aug 2026'` |
| `dateFromOrderId(id)` | Extract date from order ID `'2026-08-09-5'` → `'2026-08-09'` |
| `emptyDay(dateStr)` | Return a blank day record (zero orders, zero totals) |
| `ensureNextToken(day)` | Recover the next order token number if missing |
| `showToast(msg)` | Show a temporary notification (auto-hides in 2.6s) |
| `confirmAction(btn, fn)` | Double-click confirmation — first click: "Click again to confirm", second click: runs `fn()` |
| `dowIndex(dateStr)` | Day-of-week index, Mon=0 … Sun=6 |
| `weekStartOf(dateStr)` | Monday of that week as `'YYYY-MM-DD'` |
| `monthLabel(ym)` | `'2026-08'` → `'August 2026'` |

---

### `js/state.js` — App State + Domain Logic

Single mutable state object (no framework):

```js
const state = {
  menu:                  [],      // all menu items (loaded from localStorage)
  raw:                   [],      // all raw materials
  customers:             [],      // all customers
  settings:              { autoDeductRaw: true },
  cart:                  [],      // current order in progress
  payment:               'Cash',
  selectedCustomerId:    '',
  editing:               null,    // non-null when editing a past order
  recipeEditItemId:      null,    // which item's recipe panel is open
  historyOpenCustomerId: null,
  activeTab:             'order',
  activeRange:           'today',
  activeCategory:        'All',
  today:                 null,    // today's day record (loaded on init)
  _currentAgg:           null,    // cached aggregation for Excel export
};
```

Key calculation functions (pure — no DB calls):

| Function | What it does |
|---|---|
| `cartTotals()` | Returns `{ total, taxable, gst, cgst, sgst }` — GST is back-calculated from inclusive prices |
| `portionsPossible(item)` | How many portions of an item can be made from current raw stock |
| `isAutoStock(item)` | `true` if item's stock is driven by raw materials (not manual) |
| `effectiveStock(item)` | Stock number to display — real stock or computed from raw |
| `computeRawUsage(cartLines)` | Aggregate raw material consumption for a cart |
| `aggregateDays(days)` | Turn an array of day records into the full sales report aggregate |

---

### `js/app.js` — Init + Business Logic

The main controller. Initialises the app, wires up all user actions.

**`init()` flow:**
```
DOMContentLoaded
  └─ init()
       ├─ load menu, raw, customers, settings from localStorage
       ├─ if 'menu-items' missing → pull from Supabase → reload
       ├─ load today's day record (create if first time today)
       ├─ renderAll()
       └─ start 60s timer to refresh today's record at midnight
```

**Sections in app.js:**

| Section | Functions |
|---|---|
| Init & render | `init`, `renderAll`, `switchTab`, `refreshTodayIfNeeded` |
| Cart | `addToCart`, `changeQty`, `removeLine`, `clearCart`, `setPayment`, `setSelectedCustomer` |
| Orders | `completeOrder`, `addOrderRecord`, `removeOrderRecord`, `deleteOrder`, `startEditOrder`, `cancelEdit` |
| Menu CRUD | `submitNewItem`, `addMenuItem`, `updateMenuItem`, `restock`, `setStock`, `setStockMode`, `deleteMenuItem` |
| Recipe CRUD | `toggleRecipeEditor`, `addRecipeLine`, `updateRecipeLine`, `removeRecipeLine`, `addFromMenuItem` |
| Raw CRUD | `addRawMaterial`, `updateRawMaterial`, `adjustRawStock`, `deleteRawMaterial`, `toggleAutoDeduct` |
| Customer CRUD | `addCustomer`, `updateCustomer`, `topUpCustomer`, `deleteCustomer`, `toggleCustomerHistory`, `deleteTopUp`, `editTopUp` |
| Backup | `backupAllData`, `restoreFromBackup`, `resetAllData` |

---

### `js/render/*.js` — HTML Generators

Each file owns one tab's HTML. They read from `state`, build an HTML string, and write it to the tab's container element. They call `dbSet` / `dbGet` indirectly via `app.js` functions (via `onclick` attributes).

| File | Container element | Key functions |
|---|---|---|
| `render/order.js` | `#menuGrid`, `#ticket` | `renderMenuGrid`, `renderCart`, `renderCategoryChips`, `renderTodayPill` |
| `render/inventory.js` | `#inventoryContent` | `renderInventoryTab`, `renderRecipeEditor` |
| `render/raw.js` | `#rawContent` | `renderRawTab` |
| `render/customers.js` | `#customersContent` | `renderCustomersTab` |
| `render/sales.js` | `#salesContent` | `loadRange`, `renderSalesReport`, `renderOverview`, `exportReport` |

---

## Database Architecture

### Storage: Hybrid (localStorage + Supabase)

```
┌─────────────────────────┐        ┌──────────────────────────┐
│      Browser             │        │       Supabase            │
│  ┌───────────────────┐  │  sync  │  ┌────────────────────┐  │
│  │   localStorage    │──┼───────►│  │   store table      │  │
│  │  (primary store)  │  │        │  │ key | value | time │  │
│  └───────────────────┘  │        │  └────────────────────┘  │
│                          │  pull  │                          │
│  (reads are instant,    │◄───────┤  (cloud backup,          │
│   no network needed)    │        │   cross-device sync)     │
└─────────────────────────┘        └──────────────────────────┘
```

- **Reads** always come from `localStorage` — zero latency, works offline  
- **Writes** go to `localStorage` first (synchronous), then Supabase (async, background)  
- If Supabase write fails (offline or error), the value is queued in `pendingSync` and retried automatically  
- On a **fresh device** (no `menu-items` in localStorage), the app pulls all data from Supabase once and reloads  

### Supabase Table: `store`

One table. One row per data collection.

```sql
CREATE TABLE store (
  key        TEXT PRIMARY KEY,
  value      JSONB,
  updated_at TIMESTAMPTZ
);
```

| `key` | `value` type | Description |
|---|---|---|
| `menu-items` | `MenuItem[]` | All menu items |
| `raw-materials` | `RawMaterial[]` | All raw materials |
| `customers` | `Customer[]` | All customers |
| `app-settings` | `{ autoDeductRaw: bool }` | Global settings |
| `all-dates` | `string[]` | List of every date that has order data |
| `day:YYYY-MM-DD` | `DayRecord` | One row per selling day |

RLS policy: `anon` role can SELECT / INSERT / UPDATE / DELETE. The anon key is scoped to this project only — there is no user authentication.

---

## Data Models

### MenuItem
```js
{
  id:        'Il8f3k...',       // uid('I')
  name:      'Masala Tea',
  category:  'Beverages',
  price:     20,                // GST-inclusive selling price
  gst:       5,                 // GST rate in %
  stock:     100,               // manual stock count (ignored when stockMode='auto')
  stockMode: 'manual',          // 'manual' | 'auto'
  threshold: 10,                // low-stock alert level
  unit:      'cup',             // optional display unit
  recipe:    [                  // raw material requirements per 1 portion
    { rawId: 'Rl9x...', qty: 200 }   // 200 ml of milk per cup
  ]
}
```

### RawMaterial
```js
{
  id:        'Rl9x...',         // uid('R')
  name:      'Milk',
  unit:      'ml',              // g | kg | ml | l | pc
  stock:     5000,
  threshold: 1000
}
```

### Customer
```js
{
  id:       'Cm2p...',          // uid('C')
  name:     'Ramesh Kumar',
  phone:    '98765',
  balance:  250,                // wallet balance (positive = credit, negative = due)
  history:  [                   // capped at 40 entries
    { time: '2026-08-09T...', type: 'topup', amount: 500, note: 'Top-up at counter' },
    { time: '2026-08-09T...', type: 'purchase', amount: -150, note: '' }
  ]
}
```

### DayRecord (`day:YYYY-MM-DD`)
```js
{
  date:      '2026-08-09',
  count:     12,                // total orders today
  taxable:   843.20,
  gst:       56.80,
  total:     900,
  nextToken: 13,                // next order number for today
  orders: [
    {
      id:           '2026-08-09-1',
      token:        1,
      time:         '2026-08-09T09:30:00.000Z',
      payment:      'Cash',
      customerId:   null,
      customerName: null,
      total:        75,
      items: [
        { id: 'Il8f3k...', name: 'Masala Tea', qty: 3, price: 20, gst: 5, lineTotal: 60 },
        { id: 'Ij9x2m...', name: 'Biscuit',    qty: 1, price: 15, gst: 0, lineTotal: 15 }
      ]
    }
  ]
}
```

### GST Calculation
Prices are **GST-inclusive**. The split is calculated as:

```
taxable  = price / (1 + gst/100)
GST      = price - taxable
CGST     = GST / 2          ← intra-state split
SGST     = GST / 2
```

---

## Order Number (Token) System

Each day has a `nextToken` counter that resets to `1` every new day. When an order is placed:
1. The order gets `token = day.nextToken`
2. `day.nextToken` is incremented and saved

The order `id` is always `'YYYY-MM-DD-{token}'` (e.g. `'2026-08-09-5'`).  
If the counter is missing (e.g. old data), `ensureNextToken()` reconstructs it from the highest token in the day's orders.

---

## Setup / Deployment

### 1. Supabase

Create the `store` table:
```sql
CREATE TABLE store (
  key        TEXT PRIMARY KEY,
  value      JSONB,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Allow anon access (RLS)
ALTER TABLE store ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all" ON store
  FOR ALL TO anon USING (true) WITH CHECK (true);
```

Copy your project URL and anon key into `js/config.js`.

### 2. Vercel

Connect your GitHub repo to Vercel. No build command needed — it's a static site. Every push to `main` deploys automatically.

### 3. Import existing data

If you have a backup JSON file (downloaded via "Download backup file" in the app):

1. Open `https://your-vercel-url/import-to-supabase.html`
2. Drag and drop the backup JSON
3. It upserts all records to Supabase in batches

---

## Importing data (`import-to-supabase.html`)

A standalone one-page tool — no dependencies, no SDK.  
Uses raw `fetch()` to call the Supabase REST API directly.  
Works from any HTTPS URL (must be served over HTTPS, not `file://`).

```
Drag backup.json
  └─ Parse JSON
       └─ Split into chunks of 5 rows
            └─ POST /rest/v1/store  (Prefer: resolution=merge-duplicates)
                 └─ Show progress log
```

---

## Architecture Decisions

**Why no framework?**  
The app needs to work offline on basic devices with no internet. No `npm install`, no build step, no CDN dependencies at runtime (except fonts and the Supabase SDK). Simpler to maintain, simpler to debug.

**Why localStorage as primary?**  
All reads are synchronous and instant. The UI never waits for a network call. Supabase is a safety net, not the bottleneck.

**Why one `store` table instead of separate tables?**  
The data is small (a few hundred KB total). Using one key-value table keeps the sync logic trivial — every `dbSet` is one upsert, every `dbGet` is one localStorage read. No joins, no migrations.

**Why global scope instead of ES modules?**  
Vercel serves this as a static site with no build step. ES modules require either a bundler or careful CORS/MIME handling on the server. Global scope with intentional load order is simpler and works everywhere.

**Why `onclick="..."` attributes instead of `addEventListener`?**  
The entire tab content is replaced on each render (innerHTML). `addEventListener` bindings attached to old DOM nodes would be lost. Inline `onclick` attributes resolve function names at call time against the global scope — they survive re-renders automatically.

---

## Local Development

No server needed for basic development:

```bash
# Clone the repo
git clone https://github.com/AkDevlop/canteen-register.git
cd canteen-register

# Open directly in browser (most things work)
open index.html

# Or use a simple local server (avoids any file:// quirks)
npx serve .
# or
python -m http.server 8080
```

Changes to any `.js` or `.css` file take effect on browser refresh. No build step.
