// ===========================================================================
// OPD Development Corp — single-file build (for easy GitHub web-upload + Railway deploy)
// Zero npm dependencies: uses only Node's built-ins (http, node:sqlite, crypto, fetch).
// This file is generated from the multi-file source project — see the README
// in the original delivered zip if you want to work from the split-out version.
// ===========================================================================

const http = require('http');
const crypto = require('crypto');
const tls = require('tls');
const { DatabaseSync } = require('node:sqlite');

// ---------------------------------------------------------------------------
// .env loader (no `dotenv` package needed)
// ---------------------------------------------------------------------------
const fs = require('fs');
const path = require('path');
(function loadEnv() {
  const file = path.join(__dirname, '.env');
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split('\n').forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const idx = trimmed.indexOf('=');
    if (idx === -1) return;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  });
})();

const PORT = process.env.PORT || 3000;
const OFFICE_PASSWORD = process.env.OFFICE_PASSWORD || 'gravel2026';
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_API = 'https://api.stripe.com/v1';
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM_NUMBER = process.env.TWILIO_FROM_NUMBER || '';
const CLICKSEND_USERNAME = process.env.CLICKSEND_USERNAME || '';
const CLICKSEND_API_KEY = process.env.CLICKSEND_API_KEY || '';
const CLICKSEND_FROM = process.env.CLICKSEND_FROM || '';
const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = Number(process.env.SMTP_PORT || 465);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;

// ---------------------------------------------------------------------------
// Database (embedded schema + helpers)
// ---------------------------------------------------------------------------
const SCHEMA_SQL = "-- MaterialFlow schema\n\nCREATE TABLE IF NOT EXISTS customers (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  phone TEXT,\n  email TEXT,\n  billing_address TEXT,\n  notes TEXT,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS drivers (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  phone TEXT,\n  truck_label TEXT,\n  pin TEXT NOT NULL,\n  active INTEGER NOT NULL DEFAULT 1,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS materials (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  unit TEXT NOT NULL DEFAULT 'yard',\n  default_price REAL NOT NULL DEFAULT 0,\n  active INTEGER NOT NULL DEFAULT 1\n);\n\nCREATE TABLE IF NOT EXISTS settings (\n  key TEXT PRIMARY KEY,\n  value TEXT\n);\n\nCREATE TABLE IF NOT EXISTS mileage_bands (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  min_miles REAL NOT NULL,\n  max_miles REAL,\n  fee REAL,\n  label TEXT,\n  sort_order INTEGER NOT NULL DEFAULT 0\n);\n\nCREATE TABLE IF NOT EXISTS sms_recipients (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  phone TEXT NOT NULL,\n  carrier TEXT NOT NULL DEFAULT 'verizon',\n  custom_gateway_domain TEXT,\n  active INTEGER NOT NULL DEFAULT 1,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS orders (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  order_number TEXT NOT NULL UNIQUE,\n  customer_id INTEGER NOT NULL REFERENCES customers(id),\n  material_id INTEGER NOT NULL REFERENCES materials(id),\n  quantity REAL NOT NULL,\n  unit TEXT NOT NULL,\n  price_per_unit REAL NOT NULL DEFAULT 0,\n  delivery_address TEXT NOT NULL,\n  distance_miles REAL,\n  delivery_fee REAL NOT NULL DEFAULT 0,\n  sales_tax_rate REAL NOT NULL DEFAULT 0,\n  sales_tax_amount REAL NOT NULL DEFAULT 0,\n  total_amount REAL NOT NULL DEFAULT 0,\n  square_invoice_number TEXT,\n  square_invoiced INTEGER NOT NULL DEFAULT 0,\n  square_paid INTEGER NOT NULL DEFAULT 0,\n  requested_date TEXT,\n  requested_window TEXT,\n  notes TEXT,\n  status TEXT NOT NULL DEFAULT 'new', -- new, scheduled, out_for_delivery, delivered, invoiced, cancelled\n  driver_id INTEGER REFERENCES drivers(id),\n  scheduled_date TEXT,\n  scheduled_time TEXT,\n  delivered_at TEXT,\n  driver_notes TEXT,\n  invoice_id INTEGER,\n  created_at TEXT NOT NULL DEFAULT (datetime('now')),\n  updated_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS invoices (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  invoice_number TEXT NOT NULL UNIQUE,\n  customer_id INTEGER NOT NULL REFERENCES customers(id),\n  status TEXT NOT NULL DEFAULT 'draft', -- draft, sent, paid, partial, void\n  subtotal REAL NOT NULL DEFAULT 0,\n  tax_rate REAL NOT NULL DEFAULT 0,\n  tax_amount REAL NOT NULL DEFAULT 0,\n  total REAL NOT NULL DEFAULT 0,\n  amount_paid REAL NOT NULL DEFAULT 0,\n  issued_date TEXT,\n  due_date TEXT,\n  paid_date TEXT,\n  notes TEXT,\n  pay_token TEXT UNIQUE,\n  stripe_checkout_url TEXT,\n  stripe_session_id TEXT,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS invoice_items (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  invoice_id INTEGER NOT NULL REFERENCES invoices(id),\n  order_id INTEGER REFERENCES orders(id),\n  description TEXT NOT NULL,\n  quantity REAL NOT NULL,\n  unit TEXT,\n  unit_price REAL NOT NULL,\n  amount REAL NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS payments (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  invoice_id INTEGER NOT NULL REFERENCES invoices(id),\n  amount REAL NOT NULL,\n  method TEXT NOT NULL, -- stripe, cash, check, ach, other\n  reference TEXT,\n  paid_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS deliveries (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,\n  sequence INTEGER NOT NULL DEFAULT 1,\n  quantity REAL NOT NULL,\n  driver_id INTEGER REFERENCES drivers(id),\n  scheduled_date TEXT,\n  slot_index INTEGER,\n  status TEXT NOT NULL DEFAULT 'unscheduled', -- unscheduled, scheduled, delivered, cancelled\n  delivered_at TEXT,\n  created_at TEXT NOT NULL DEFAULT (datetime('now')),\n  updated_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\n-- ===== Construction Jobs module =====\n\nCREATE TABLE IF NOT EXISTS crews (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  active INTEGER NOT NULL DEFAULT 1,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS equipment (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  type TEXT,\n  active INTEGER NOT NULL DEFAULT 1,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS jobs (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  job_number TEXT NOT NULL UNIQUE,\n  customer_id INTEGER REFERENCES customers(id),\n  customer_name TEXT NOT NULL,\n  customer_phone TEXT,\n  site_address TEXT,\n  scope TEXT,\n  price REAL,\n  target_start_date TEXT,\n  duration_days REAL,\n  crew_id INTEGER REFERENCES crews(id),\n  status TEXT NOT NULL DEFAULT 'inquiry',\n  -- inquiry, estimate_scheduled, quote_sent, accepted, scheduled, deposit_received, in_progress, complete, cancelled\n  permit_number TEXT,\n  next_followup_date TEXT,\n  followup_note TEXT,\n  notes TEXT,\n  created_at TEXT NOT NULL DEFAULT (datetime('now')),\n  updated_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS job_equipment (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,\n  equipment_id INTEGER NOT NULL REFERENCES equipment(id),\n  start_date TEXT,\n  end_date TEXT\n);\n\nCREATE TABLE IF NOT EXISTS job_checklist_items (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,\n  label TEXT NOT NULL,\n  done INTEGER NOT NULL DEFAULT 0,\n  sort_order INTEGER NOT NULL DEFAULT 0,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS job_todos (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,\n  description TEXT NOT NULL,\n  category TEXT NOT NULL DEFAULT 'office', -- office, field\n  done INTEGER NOT NULL DEFAULT 0,\n  sort_order INTEGER NOT NULL DEFAULT 0,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS job_permits (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  job_id INTEGER NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,\n  permit_number TEXT,\n  file_name TEXT,\n  file_type TEXT,\n  file_data BLOB,\n  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);\nCREATE INDEX IF NOT EXISTS idx_orders_driver_date ON orders(driver_id, scheduled_date);\nCREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);\nCREATE INDEX IF NOT EXISTS idx_deliveries_order ON deliveries(order_id);\nCREATE INDEX IF NOT EXISTS idx_deliveries_driver_date ON deliveries(driver_id, scheduled_date);\nCREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);\nCREATE INDEX IF NOT EXISTS idx_jobs_start_date ON jobs(target_start_date);\nCREATE INDEX IF NOT EXISTS idx_jobs_followup ON jobs(next_followup_date);\nCREATE INDEX IF NOT EXISTS idx_job_equipment_job ON job_equipment(job_id);\nCREATE INDEX IF NOT EXISTS idx_job_equipment_equip_dates ON job_equipment(equipment_id, start_date, end_date);\nCREATE INDEX IF NOT EXISTS idx_job_checklist_job ON job_checklist_items(job_id);\nCREATE INDEX IF NOT EXISTS idx_job_todos_job ON job_todos(job_id);\nCREATE INDEX IF NOT EXISTS idx_job_permits_job ON job_permits(job_id);\n";

// DATA_DIR points at a persistent volume mount in production (e.g. Railway) so
// the database survives redeploys. Falls back to the app directory otherwise
// (fine for local runs, but ephemeral on most hosts without a volume).
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_PATH = path.join(DATA_DIR, 'materialflow.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec(SCHEMA_SQL);

// Lightweight migrations: CREATE TABLE IF NOT EXISTS above does nothing for a
// table that already exists, so any new column added to the schema after a
// database was first created needs an explicit ADD COLUMN here (guarded so
// it's a no-op once applied). This keeps existing data intact across deploys.
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}
(function migrate() {
  ensureColumn('orders', 'distance_miles', 'REAL');
  ensureColumn('orders', 'delivery_fee', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('orders', 'square_invoice_number', 'TEXT');
  ensureColumn('orders', 'square_invoiced', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('orders', 'square_paid', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn('sms_recipients', 'carrier', "TEXT NOT NULL DEFAULT 'verizon'");
  ensureColumn('sms_recipients', 'custom_gateway_domain', 'TEXT');
  ensureColumn('orders', 'sales_tax_rate', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('orders', 'sales_tax_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn('orders', 'total_amount', 'REAL NOT NULL DEFAULT 0');
  backfillDeliveries();
})();

// Orders created before the `deliveries` table existed have no rows there.
// The schedule board and driver app both read from `deliveries`, so give
// every such order exactly one delivery mirroring its own driver/date/status
// — never re-split a legacy order, that would rewrite real delivery history.
function backfillDeliveries() {
  const orphans = db.prepare(`
    SELECT o.id, o.quantity, o.status, o.driver_id, o.scheduled_date, o.delivered_at
    FROM orders o LEFT JOIN deliveries d ON d.order_id = o.id
    WHERE d.id IS NULL
  `).all();
  if (!orphans.length) return;
  for (const o of orphans) {
    let status = 'unscheduled';
    let driverId = null, scheduledDate = null, slotIndex = null, deliveredAt = null;
    if (o.status === 'cancelled') {
      status = 'cancelled';
    } else if (o.status === 'delivered' || o.status === 'invoiced') {
      status = 'delivered'; driverId = o.driver_id; scheduledDate = o.scheduled_date; deliveredAt = o.delivered_at;
    } else if (o.status === 'out_for_delivery') {
      status = 'out_for_delivery'; driverId = o.driver_id; scheduledDate = o.scheduled_date; slotIndex = 0;
    } else if (o.driver_id && o.scheduled_date) {
      status = 'scheduled'; driverId = o.driver_id; scheduledDate = o.scheduled_date; slotIndex = 0;
    }
    db.prepare(
      `INSERT INTO deliveries (order_id, sequence, quantity, driver_id, scheduled_date, slot_index, status, delivered_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)`
    ).run(o.id, o.quantity, driverId, scheduledDate, slotIndex, status, deliveredAt);
  }
}

function run(sql, params = []) { return db.prepare(sql).run(...params); }
function get(sql, params = []) { return db.prepare(sql).get(...params); }
function all(sql, params = []) { return db.prepare(sql).all(...params); }

function getSetting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', [key]);
  return row && row.value !== '' && row.value !== null ? row.value : fallback;
}
function setSetting(key, value) {
  const existing = get('SELECT key FROM settings WHERE key = ?', [key]);
  if (existing) run('UPDATE settings SET value = ? WHERE key = ?', [value, key]);
  else run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value]);
}

// ---------------------------------------------------------------------------
// Seed real OPD data on first boot (only if the database is empty)
// ---------------------------------------------------------------------------
(function seed() {
  if (get('SELECT COUNT(*) as c FROM materials').c > 0) return;
  const materials = [
    ['1/2" Screened Loam', 'yard', 20], ['1/2" Screened Millings', 'yard', 25],
    ['Nuggets', 'yard', 14], ['Screened Fill', 'yard', 15],
    ['Unscreened Fill', 'yard', 10], ['3/4" Processed Gravel', 'yard', 18],
  ];
  materials.forEach(([name, unit, price]) => run('INSERT INTO materials (name, unit, default_price) VALUES (?, ?, ?)', [name, unit, price]));

  const drivers = [
    ['Al Loiselle', null, 'Kenworth T880', '1111'],
    ['Jared Parrillo', null, 'Mack RD688 / Peterbilt 389', '2222'],
    ['Fill-In Driver', null, 'Mack RD688 / Kenworth T880', '3333'],
    ['Tom Brown', null, 'F600', '4444'],
  ];
  drivers.forEach(([name, phone, truck, pin]) => run('INSERT INTO drivers (name, phone, truck_label, pin) VALUES (?, ?, ?, ?)', [name, phone, truck, pin]));

  setSetting('shop_address', '14 Priscilla Lane, Johnston, RI');
  setSetting('shop_lat', '');
  setSetting('shop_lng', '');

  const bands = [
    [0, 5, 75, '0–5 miles'], [5, 10, 100, '5–10 miles'], [10, 15, 125, '10–15 miles'],
    [15, 20, 150, '15–20 miles'], [20, null, null, '20+ miles — call for quote'],
  ];
  bands.forEach(([min_miles, max_miles, fee, label], i) => run('INSERT INTO mileage_bands (min_miles, max_miles, fee, label, sort_order) VALUES (?, ?, ?, ?, ?)', [min_miles, max_miles, fee, label, i]));

  const customers = [
    ['Henry Landscaping LLC', '555-0201', 'billing@henrylandscaping.com', '12 Birch Rd, Johnston, RI'],
    ['Tom Baker (Residential)', '555-0202', 'tbaker@example.com', '48 Elm St, Johnston, RI'],
    ['Riverside Builders', '555-0203', 'ap@riversidebuilders.com', '900 Industrial Pkwy, Cranston, RI'],
  ];
  customers.forEach(([name, phone, email, addr]) => run('INSERT INTO customers (name, phone, email, billing_address) VALUES (?, ?, ?, ?)', [name, phone, email, addr]));

  const custRows = all('SELECT * FROM customers');
  const matRows = all('SELECT * FROM materials');
  const drvRows = all('SELECT * FROM drivers');
  const today = new Date().toISOString().slice(0, 10);
  const sample = [
    { customer: 0, material: 0, qty: 12, address: '12 Birch Rd, Johnston, RI', status: 'new' },
    { customer: 1, material: 3, qty: 4, address: '48 Elm St, Johnston, RI', status: 'scheduled', driver: 0, date: today },
    { customer: 2, material: 1, qty: 22, address: '900 Industrial Pkwy, Cranston, RI', status: 'scheduled', driver: 1, date: today },
    { customer: 0, material: 5, qty: 8, address: '12 Birch Rd, Johnston, RI', status: 'delivered', driver: 2, date: today },
    { customer: 1, material: 4, qty: 6, address: '48 Elm St, Johnston, RI', status: 'delivered', driver: 3, date: today },
  ];
  sample.forEach((s, i) => {
    const cust = custRows[s.customer], mat = matRows[s.material];
    const driver = s.driver !== undefined ? drvRows[s.driver] : null;
    const d = new Date();
    const orderNumber = `ORD-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(i + 1).padStart(3, '0')}`;
    run(
      `INSERT INTO orders (order_number, customer_id, material_id, quantity, unit, price_per_unit, delivery_address, requested_date, status, driver_id, scheduled_date, delivered_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderNumber, cust.id, mat.id, s.qty, mat.unit, mat.default_price, s.address, s.date || today, s.status,
        driver ? driver.id : null, s.date || null, s.status === 'delivered' ? new Date().toISOString() : null]
    );
  });
})();

// ---------------------------------------------------------------------------
// Delivery distance estimator (Nominatim geocoding + OSRM driving distance,
// both free/no-key public services; falls back to a padded straight-line
// estimate if the routing service is unreachable)
// ---------------------------------------------------------------------------
async function geocodeAddress(address) {
  const geoUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;
  const res = await fetch(geoUrl, { headers: { 'User-Agent': 'OPD-Raw-Materials-Dispatch/1.0 (internal delivery estimator)' } });
  if (!res.ok) throw new Error('Geocoding service unavailable right now.');
  const data = await res.json();
  if (!data || !data.length) throw new Error(`Could not locate "${address}". Check the address and try again.`);
  return { lat: Number(data[0].lat), lng: Number(data[0].lon) };
}
function haversineMiles(a, b) {
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}
async function drivingMiles(origin, dest) {
  try {
    const routeUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${dest.lng},${dest.lat}?overview=false`;
    const res = await fetch(routeUrl);
    if (res.ok) {
      const data = await res.json();
      if (data && data.routes && data.routes[0]) return { miles: data.routes[0].distance / 1609.34, method: 'driving' };
    }
  } catch (e) { /* fall through to straight-line */ }
  return { miles: haversineMiles(origin, dest) * 1.3, method: 'estimated' };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function todayStr() { return new Date().toISOString().slice(0, 10); }
function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// ---- CSV import helpers (zero-dependency) ----
function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let inQuotes = false;
  const len = text.length; let i = 0;
  while (i < len) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i += 2; continue; } inQuotes = false; i += 1; continue; }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { row.push(field); field = ''; i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += c; i += 1;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ''));
}
function csvToObjects(text) {
  const rows = parseCsv(text);
  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, ''));
  return rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (r[idx] !== undefined ? r[idx] : '').trim(); });
    return obj;
  });
}
function parseFlexibleDate(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) { let [, mo, d, y] = m; if (y.length === 2) y = `20${y}`; return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`; }
  return null;
}
function parseMoneyLoose(str) {
  if (str === undefined || str === null || str === '') return null;
  const n = Number(String(str).replace(/[^0-9.\-]/g, ''));
  return isNaN(n) ? null : n;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 20_000_000) { req.destroy(); reject(new Error('Body too large')); } });
    req.on('end', () => { if (!data) return resolve({}); try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON body')); } });
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// Auth (cookie sessions)
// ---------------------------------------------------------------------------
const SESSION_COOKIE = 'mf_session';
const sessions = new Map();

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  header.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    out[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  });
  return out;
}
function getSession(req) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  return sid ? sessions.get(sid) || null : null;
}
function createSession(res, payload) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { ...payload, createdAt: Date.now() });
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
  return sid;
}
function destroySession(req, res) {
  const sid = parseCookies(req)[SESSION_COOKIE];
  if (sid) sessions.delete(sid);
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

// ---------------------------------------------------------------------------
// Stripe (raw REST calls, no SDK)
// ---------------------------------------------------------------------------
function stripeConfigured() { return Boolean(STRIPE_SECRET_KEY); }
function toFormBody(obj, prefix) {
  const parts = [];
  for (const [key, value] of Object.entries(obj)) {
    const paramKey = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (typeof value === 'object' && !Array.isArray(value)) parts.push(toFormBody(value, paramKey));
    else if (Array.isArray(value)) value.forEach((v, i) => {
      if (typeof v === 'object') parts.push(toFormBody(v, `${paramKey}[${i}]`));
      else parts.push(`${encodeURIComponent(`${paramKey}[${i}]`)}=${encodeURIComponent(v)}`);
    });
    else parts.push(`${encodeURIComponent(paramKey)}=${encodeURIComponent(value)}`);
  }
  return parts.join('&');
}
async function createCheckoutSession({ invoiceNumber, amountCents, customerName, description, successUrl, cancelUrl, invoiceId }) {
  if (!stripeConfigured()) throw new Error('STRIPE_SECRET_KEY is not set. Add it in Railway’s Variables tab to enable online payments.');
  const body = toFormBody({
    mode: 'payment', success_url: successUrl, cancel_url: cancelUrl,
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: amountCents, product_data: { name: `Invoice ${invoiceNumber}`, description: description || `Payment for ${customerName}` } } }],
    metadata: { invoice_id: String(invoiceId) },
  });
  const resp = await fetch(`${STRIPE_API}/checkout/sessions`, { method: 'POST', headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.error?.message || 'Stripe checkout session creation failed');
  return json;
}
function verifyWebhookSignature(rawBody, signatureHeader) {
  if (!STRIPE_WEBHOOK_SECRET || !signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(',').map((p) => p.split('=')));
  if (!parts.t || !parts.v1) return false;
  const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(`${parts.t}.${rawBody}`).digest('hex');
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(parts.v1)); } catch { return false; }
}

// ---------------------------------------------------------------------------
// Email-to-text (free alternative to Twilio) — sends SMS via carrier email
// gateways (e.g. number@vtext.com) using a raw SMTP client over TLS.
// ---------------------------------------------------------------------------
const CARRIER_GATEWAYS = {
  verizon: 'vtext.com',
  att: 'txt.att.net',
  tmobile: 'tmomail.net',
  sprint: 'messaging.sprintpcs.com',
  uscellular: 'email.uscc.net',
  boost: 'sms.myboostmobile.com',
  cricket: 'sms.cricketwireless.net',
  metro: 'mymetropcs.com',
  googlefi: 'msg.fi.google.com',
  visible: 'vtext.com',
  mint: 'tmomail.net',
  straighttalk: 'vtext.com',
};
function emailSmsConfigured() { return Boolean(SMTP_USER && SMTP_PASS); }
function gatewayAddressFor(recipient) {
  const digits = String(recipient.phone).replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
  if (!digits) throw new Error(`Recipient "${recipient.name}" has no usable phone number`);
  const domain = recipient.carrier === 'other' ? recipient.custom_gateway_domain : CARRIER_GATEWAYS[recipient.carrier];
  if (!domain) throw new Error(`Recipient "${recipient.name}" has no known carrier gateway (carrier: ${recipient.carrier || 'unset'})`);
  return `${digits}@${domain}`;
}
function readSmtpResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = buffer.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) { cleanup(); resolve(buffer); }
    };
    const onError = (err) => { cleanup(); reject(err); };
    const onEnd = () => { cleanup(); reject(new Error('SMTP connection closed unexpectedly')); };
    function cleanup() { socket.removeListener('data', onData); socket.removeListener('error', onError); socket.removeListener('end', onEnd); }
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('end', onEnd);
  });
}
function checkSmtpOk(response, step) {
  const code = Number(response.slice(0, 3));
  if (code >= 400) throw new Error(`SMTP error during ${step}: ${response.trim()}`);
}
function sendSmtpLine(socket, line) { socket.write(line + '\r\n'); }
async function sendEmailSms(recipients, subject, body) {
  if (!emailSmsConfigured()) throw new Error('Email-to-SMS is not configured (SMTP_USER / SMTP_PASS).');
  if (!recipients.length) return { sent: 0 };

  const addresses = [];
  const skipped = [];
  for (const r of recipients) {
    try { addresses.push({ name: r.name, address: gatewayAddressFor(r) }); }
    catch (e) { skipped.push({ name: r.name, error: e.message }); }
  }
  if (skipped.length) skipped.forEach((s) => console.error(`Skipping SMS recipient ${s.name}: ${s.error}`));
  if (!addresses.length) throw new Error('No recipients had a usable carrier gateway address.');

  const CONNECT_TIMEOUT_MS = 10_000;
  const COMMAND_TIMEOUT_MS = 15_000;
  const socket = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST });
  socket.setTimeout(COMMAND_TIMEOUT_MS, () => socket.destroy(new Error('SMTP connection timed out')));
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.destroy(); reject(new Error(`Could not reach ${SMTP_HOST}:${SMTP_PORT} (timed out)`)); }, CONNECT_TIMEOUT_MS);
      socket.once('secureConnect', () => { clearTimeout(timer); resolve(); });
      socket.once('error', (e) => { clearTimeout(timer); reject(e); });
    });
    checkSmtpOk(await readSmtpResponse(socket), 'greeting');

    sendSmtpLine(socket, `EHLO ${SMTP_HOST}`);
    checkSmtpOk(await readSmtpResponse(socket), 'EHLO');

    sendSmtpLine(socket, 'AUTH LOGIN');
    checkSmtpOk(await readSmtpResponse(socket), 'AUTH LOGIN');
    sendSmtpLine(socket, Buffer.from(SMTP_USER).toString('base64'));
    checkSmtpOk(await readSmtpResponse(socket), 'AUTH username');
    sendSmtpLine(socket, Buffer.from(SMTP_PASS).toString('base64'));
    checkSmtpOk(await readSmtpResponse(socket), 'AUTH password');

    sendSmtpLine(socket, `MAIL FROM:<${SMTP_FROM}>`);
    checkSmtpOk(await readSmtpResponse(socket), 'MAIL FROM');

    for (const a of addresses) {
      sendSmtpLine(socket, `RCPT TO:<${a.address}>`);
      checkSmtpOk(await readSmtpResponse(socket), `RCPT TO ${a.address}`);
    }

    sendSmtpLine(socket, 'DATA');
    checkSmtpOk(await readSmtpResponse(socket), 'DATA');
    const message = [
      `From: ${SMTP_FROM}`,
      `To: ${addresses.map((a) => a.address).join(', ')}`,
      `Subject: ${subject}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      body,
      '.',
    ].join('\r\n');
    sendSmtpLine(socket, message);
    checkSmtpOk(await readSmtpResponse(socket), 'message body');

    sendSmtpLine(socket, 'QUIT');
    socket.end();
    return { sent: addresses.length, skipped };
  } catch (e) {
    socket.destroy();
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Twilio (raw REST calls, no SDK) — SMS order alerts
// ---------------------------------------------------------------------------
function twilioConfigured() { return Boolean(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_FROM_NUMBER); }
async function sendSms(to, body) {
  if (!twilioConfigured()) throw new Error('Twilio is not configured.');
  const url = `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`;
  const params = new URLSearchParams({ To: to, From: TWILIO_FROM_NUMBER, Body: body });
  const auth = Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString('base64');
  const resp = await fetch(url, { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
  const json = await resp.json();
  if (!resp.ok) throw new Error(json.message || 'Twilio send failed');
  return json;
}
async function broadcastSms(recipients, body) {
  const results = await Promise.allSettled(recipients.map((r) => sendSms(r.phone, body)));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`SMS to ${recipients[i].name} (${recipients[i].phone}) failed:`, r.reason?.message || r.reason); });
  return results;
}

// ---------------------------------------------------------------------------
// ClickSend (raw REST calls, no SDK) — primary SMS channel. Carrier
// email-to-text gateways (AT&T/Verizon/T-Mobile) were shut down
// industry-wide in 2025 to fight spam abuse, so a real SMS API is needed.
// ---------------------------------------------------------------------------
function clicksendConfigured() { return Boolean(CLICKSEND_USERNAME && CLICKSEND_API_KEY); }
function clicksendE164(phone) {
  const raw = String(phone || '').trim();
  if (raw.startsWith('+')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return `+${digits}`;
}
async function sendClickSendSms(to, body) {
  if (!clicksendConfigured()) throw new Error('ClickSend is not configured (CLICKSEND_USERNAME / CLICKSEND_API_KEY).');
  const auth = Buffer.from(`${CLICKSEND_USERNAME}:${CLICKSEND_API_KEY}`).toString('base64');
  const message = { source: 'materialflow', to: clicksendE164(to), body };
  if (CLICKSEND_FROM) message.from = CLICKSEND_FROM;
  const resp = await fetch('https://rest.clicksend.com/v3/sms/send', {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [message] }),
  });
  let json = null;
  try { json = await resp.json(); } catch (e) { /* no body */ }
  const firstResult = json?.data?.messages?.[0];
  const ok = resp.ok && json && json.response_code === 'SUCCESS' && (!firstResult || firstResult.status !== 'FAILED');
  if (!ok) {
    const detail = firstResult?.status_text || firstResult?.status || json?.response_msg || `HTTP ${resp.status}`;
    throw new Error(`ClickSend send failed: ${detail}`);
  }
  return json;
}
async function broadcastClickSendSms(recipients, body) {
  const results = await Promise.allSettled(recipients.map((r) => sendClickSendSms(r.phone, body)));
  results.forEach((r, i) => { if (r.status === 'rejected') console.error(`ClickSend to ${recipients[i].name} (${recipients[i].phone}) failed:`, r.reason?.message || r.reason); });
  return results;
}

function formatOrderSms(order) {
  const materialCost = Number(order.quantity || 0) * Number(order.price_per_unit || 0);
  const salesTax = order.sales_tax_amount !== undefined && order.sales_tax_amount !== null
    ? Number(order.sales_tax_amount) : materialCost * (Number(order.sales_tax_rate || 0) / 100);
  const total = order.total_amount !== undefined && order.total_amount !== null
    ? Number(order.total_amount) : materialCost + salesTax + Number(order.delivery_fee || 0);
  const orderDate = (order.created_at || '').slice(0, 10) || todayStr();
  const lines = [
    `NEW ORDER - ${order.order_number}`,
    `- Date: ${orderDate}`,
    `- Name: ${order.customer_name}`,
    `- Address: ${order.delivery_address}`,
    `- Material: ${order.material_name}`,
    `- Amount: ${order.quantity} ${order.unit}`,
    `- Total: $${total.toFixed(2)} (incl. $${salesTax.toFixed(2)} sales tax)`,
  ];
  if (order.customer_phone) lines.push(`- Phone: ${order.customer_phone}`);
  if (order.requested_window === 'ASAP') lines.push('- Requested: ASAP');
  else if (order.requested_date) lines.push(`- Requested: ${order.requested_date}${order.requested_window ? ' ' + order.requested_window : ''}`);
  if (order.deliveries && order.deliveries.length > 1) {
    lines.push(`- Split into ${order.deliveries.length} truckloads (${MAX_YARDS_PER_DELIVERY}yd max each):`);
    order.deliveries.forEach((d) => {
      lines.push(`  ${d.sequence}) ${d.quantity} ${order.unit} — ${d.driver_name ? d.driver_name : 'unassigned'}${d.scheduled_date ? ' on ' + d.scheduled_date : ''}`);
    });
  } else if (order.driver_name) {
    lines.push(`- Driver: ${order.driver_name}${order.scheduled_date ? ' on ' + order.scheduled_date : ''}`);
  }
  if (order.delivery_fee) lines.push(`- Delivery fee: $${Number(order.delivery_fee).toFixed(2)}${order.distance_miles ? ` (${order.distance_miles} mi)` : ''}`);
  if (order.notes) lines.push(`- Notes: ${order.notes}`);
  return lines.join('\n');
}
async function notifyNewOrder(order) {
  try {
    const recipients = all('SELECT * FROM sms_recipients WHERE active = 1');
    if (!recipients.length) return;
    const body = formatOrderSms(order);
    if (clicksendConfigured()) {
      await broadcastClickSendSms(recipients, body);
    } else if (twilioConfigured()) {
      await broadcastSms(recipients, body);
    } else if (emailSmsConfigured()) {
      await sendEmailSms(recipients, `New Order ${order.order_number}`, body);
    }
  } catch (e) { console.error('notifyNewOrder failed:', e && e.stack ? e.stack : e); }
}

// ---------------------------------------------------------------------------
// Route table
// ---------------------------------------------------------------------------
const routes = [];
function on(method, pattern, handler) {
  const paramNames = [];
  const regexStr = pattern.replace(/:([A-Za-z]+)/g, (_, name) => { paramNames.push(name); return '([^/]+)'; });
  routes.push({ method, regex: new RegExp(`^${regexStr}$`), paramNames, handler });
}

function requireAuth(req, res) {
  const session = getSession(req);
  if (!session) { sendJson(res, 401, { error: 'Not logged in' }); return null; }
  return session;
}
function requireOffice(req, res) {
  const session = requireAuth(req, res);
  if (!session) return null;
  if (session.role !== 'office') { sendJson(res, 403, { error: 'Office access required' }); return null; }
  return session;
}

const ORDER_SELECT = `
  SELECT o.*, c.name as customer_name, c.phone as customer_phone, c.billing_address as customer_address,
         m.name as material_name, d.name as driver_name, d.truck_label as driver_truck
  FROM orders o JOIN customers c ON c.id = o.customer_id JOIN materials m ON m.id = o.material_id
  LEFT JOIN drivers d ON d.id = o.driver_id
`;
function nextOrderNumberForDate(date) {
  const prefix = `ORD-${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  const rows = all('SELECT order_number FROM orders WHERE order_number LIKE ?', [`${prefix}%`]);
  let max = 0;
  rows.forEach((r) => {
    const n = parseInt(r.order_number.slice(prefix.length + 1), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}
function nextOrderNumber() { return nextOrderNumberForDate(new Date()); }
function computeOrderTotals(quantity, pricePerUnit, deliveryFee, taxRatePercent) {
  const materialCost = Number(quantity || 0) * Number(pricePerUnit || 0);
  const rate = Number(taxRatePercent || 0);
  const salesTaxAmount = money(materialCost * (rate / 100));
  const totalAmount = money(materialCost + salesTaxAmount + Number(deliveryFee || 0));
  return { salesTaxRate: rate, salesTaxAmount, totalAmount };
}
function nextInvoiceNumber() {
  const prefix = `INV-${new Date().getFullYear()}`;
  const count = get('SELECT COUNT(*) as c FROM invoices WHERE invoice_number LIKE ?', [`${prefix}%`]).c;
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
}

// ---- DELIVERY SPLITTING & AUTO-SCHEDULING ---------------------------------
// A delivery is one truckload — max 20 yards. Orders over that get split
// into multiple deliveries, each auto-placed into the earliest open
// (driver, day, hour-slot). Drivers work a 9-hour day => 9 one-hour slots/day.
const MAX_YARDS_PER_DELIVERY = 20;
const SLOTS_PER_DAY = 9;
const WORKDAY_START_HOUR = 8; // slot 0 = 8:00am, for display only

function splitIntoDeliveryChunks(quantity) {
  const qty = Number(quantity || 0);
  if (qty <= 0) return [];
  const count = Math.ceil(qty / MAX_YARDS_PER_DELIVERY);
  const chunks = [];
  let remaining = qty;
  for (let i = 0; i < count; i++) {
    const chunk = i === count - 1 ? money(remaining) : MAX_YARDS_PER_DELIVERY;
    chunks.push(chunk);
    remaining = money(remaining - MAX_YARDS_PER_DELIVERY);
  }
  return chunks;
}
function slotTimeLabel(slotIndex) {
  if (slotIndex === null || slotIndex === undefined) return null;
  const hour = WORKDAY_START_HOUR + Number(slotIndex);
  const period = hour >= 12 ? 'PM' : 'AM';
  const h12 = ((hour + 11) % 12) + 1;
  return `${h12}:00 ${period}`;
}
function addDays(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function usedSlots(driverId, dateStr) {
  return all(`SELECT slot_index FROM deliveries WHERE driver_id = ? AND scheduled_date = ? AND status != 'cancelled'`, [driverId, dateStr])
    .map((r) => r.slot_index).filter((s) => s !== null && s !== undefined);
}
function autoAssignDelivery(deliveryId, opts) {
  const { startDate, preferredDriverId } = opts || {};
  const drivers = preferredDriverId
    ? [get('SELECT * FROM drivers WHERE id = ? AND active = 1', [preferredDriverId])].filter(Boolean)
    : all('SELECT * FROM drivers WHERE active = 1 ORDER BY id');
  if (!drivers.length) return false;
  let date = startDate || todayStr();
  for (let i = 0; i < 120; i++) {
    let bestDriverId = null, bestSlot = null, bestUsedCount = Infinity;
    for (const d of drivers) {
      const used = usedSlots(d.id, date);
      if (used.length >= SLOTS_PER_DAY) continue;
      if (used.length < bestUsedCount) {
        const usedSet = new Set(used);
        let openSlot = null;
        for (let s = 0; s < SLOTS_PER_DAY; s++) if (!usedSet.has(s)) { openSlot = s; break; }
        bestUsedCount = used.length; bestDriverId = d.id; bestSlot = openSlot;
      }
    }
    if (bestDriverId !== null) {
      run(`UPDATE deliveries SET driver_id = ?, scheduled_date = ?, slot_index = ?, status = 'scheduled', updated_at = datetime('now') WHERE id = ?`,
        [bestDriverId, date, bestSlot, deliveryId]);
      return true;
    }
    date = addDays(date, 1);
  }
  return false;
}
function generateDeliveriesForOrder(order, opts) {
  const { preferredDriverId, startDate } = opts || {};
  const chunks = splitIntoDeliveryChunks(order.quantity);
  chunks.forEach((qty, idx) => {
    const result = run(`INSERT INTO deliveries (order_id, sequence, quantity, status) VALUES (?, ?, ?, 'unscheduled')`, [order.id, idx + 1, qty]);
    autoAssignDelivery(result.lastInsertRowid, { startDate, preferredDriverId });
  });
}
function recomputeOrderRollup(orderId) {
  const order = get('SELECT * FROM orders WHERE id = ?', [orderId]);
  if (!order || order.status === 'invoiced') return;
  const deliveries = all('SELECT * FROM deliveries WHERE order_id = ? ORDER BY sequence', [orderId]);
  const active = deliveries.filter((d) => d.status !== 'cancelled');
  let status;
  let deliveredAt = order.delivered_at;
  if (!active.length) {
    status = deliveries.length ? 'cancelled' : 'new';
  } else if (active.every((d) => d.status === 'delivered')) {
    status = 'delivered';
    const dates = active.map((d) => d.delivered_at).filter(Boolean).sort();
    if (dates.length) deliveredAt = dates[dates.length - 1];
  } else if (active.some((d) => d.driver_id && d.scheduled_date)) {
    status = 'scheduled';
  } else {
    status = 'new';
  }
  const scheduledOnes = active.filter((d) => d.driver_id && d.scheduled_date)
    .sort((a, b) => (a.scheduled_date === b.scheduled_date ? a.sequence - b.sequence : (a.scheduled_date < b.scheduled_date ? -1 : 1)));
  const driverId = scheduledOnes.length ? scheduledOnes[0].driver_id : null;
  const scheduledDate = scheduledOnes.length ? scheduledOnes[0].scheduled_date : null;
  run(`UPDATE orders SET status = ?, driver_id = ?, scheduled_date = ?, delivered_at = ?, updated_at = datetime('now') WHERE id = ?`,
    [status, driverId, scheduledDate, deliveredAt, orderId]);
}

// ---- AUTH ----
on('POST', '/api/login', async (req, res) => {
  const body = await readJsonBody(req);
  if (body.role === 'office') {
    if (body.password === OFFICE_PASSWORD) { createSession(res, { role: 'office', name: 'Dispatch' }); return sendJson(res, 200, { ok: true, role: 'office', name: 'Dispatch' }); }
    return sendJson(res, 401, { error: 'Incorrect password' });
  }
  if (body.role === 'driver') {
    const driver = get('SELECT * FROM drivers WHERE id = ? AND active = 1', [body.driverId]);
    if (driver && driver.pin === String(body.pin || '')) { createSession(res, { role: 'driver', driverId: driver.id, name: driver.name }); return sendJson(res, 200, { ok: true, role: 'driver', name: driver.name, driverId: driver.id }); }
    return sendJson(res, 401, { error: 'Incorrect PIN' });
  }
  return sendJson(res, 400, { error: 'Unknown role' });
});
on('POST', '/api/logout', async (req, res) => { destroySession(req, res); sendJson(res, 200, { ok: true }); });
on('GET', '/api/me', async (req, res) => { const session = getSession(req); if (!session) return sendJson(res, 200, { loggedIn: false }); sendJson(res, 200, { loggedIn: true, ...session }); });

// ---- DASHBOARD ----
on('GET', '/api/dashboard/summary', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const counts = get(`SELECT SUM(CASE WHEN status='new' THEN 1 ELSE 0 END) as new_orders, SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) as scheduled_orders, SUM(CASE WHEN status='delivered' THEN 1 ELSE 0 END) as delivered_orders, SUM(CASE WHEN status='invoiced' THEN 1 ELSE 0 END) as invoiced_orders FROM orders`);
  const invoiceCounts = get(`SELECT SUM(CASE WHEN status IN ('sent','partial') THEN total - amount_paid ELSE 0 END) as outstanding, SUM(CASE WHEN status='paid' THEN total ELSE 0 END) as paid_total FROM invoices`);
  const todaysDeliveries = all(`${DELIVERY_SELECT} WHERE del.scheduled_date = ? AND del.status != 'cancelled' ORDER BY del.driver_id, del.slot_index IS NULL, del.slot_index`, [todayStr()])
    .map((r) => ({ ...r, slot_time: slotTimeLabel(r.slot_index) }));
  sendJson(res, 200, { counts, invoiceCounts, todaysDeliveries });
});

// ---- CUSTOMERS ----
on('GET', '/api/customers', async (req, res) => { if (!requireAuth(req, res)) return; sendJson(res, 200, all('SELECT * FROM customers ORDER BY name')); });
on('POST', '/api/customers', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.name) return sendJson(res, 400, { error: 'Name is required' });
  const result = run('INSERT INTO customers (name, phone, email, billing_address, notes) VALUES (?, ?, ?, ?, ?)', [b.name, b.phone || null, b.email || null, b.billing_address || null, b.notes || null]);
  sendJson(res, 201, get('SELECT * FROM customers WHERE id = ?', [result.lastInsertRowid]));
});
on('GET', '/api/customers/:id', async (req, res, params) => {
  if (!requireAuth(req, res)) return;
  const row = get('SELECT * FROM customers WHERE id = ?', [params.id]);
  if (!row) return sendJson(res, 404, { error: 'Customer not found' });
  sendJson(res, 200, row);
});
on('PUT', '/api/customers/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM customers WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Customer not found' });
  const name = b.name !== undefined ? b.name : existing.name;
  const phone = b.phone !== undefined ? b.phone : existing.phone;
  const email = b.email !== undefined ? b.email : existing.email;
  const billing_address = b.billing_address !== undefined ? b.billing_address : existing.billing_address;
  const notes = b.notes !== undefined ? b.notes : existing.notes;
  run('UPDATE customers SET name = ?, phone = ?, email = ?, billing_address = ?, notes = ? WHERE id = ?', [name, phone, email, billing_address, notes, params.id]);
  sendJson(res, 200, get('SELECT * FROM customers WHERE id = ?', [params.id]));
});

// ---- MATERIALS ----
on('GET', '/api/materials', async (req, res, params, query) => {
  if (!requireAuth(req, res)) return;
  sendJson(res, 200, query && query.all === '1' ? all('SELECT * FROM materials ORDER BY name') : all('SELECT * FROM materials WHERE active = 1 ORDER BY name'));
});
on('POST', '/api/materials', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.name) return sendJson(res, 400, { error: 'Name is required' });
  const result = run('INSERT INTO materials (name, unit, default_price) VALUES (?, ?, ?)', [b.name, b.unit || 'yard', money(b.default_price)]);
  sendJson(res, 201, get('SELECT * FROM materials WHERE id = ?', [result.lastInsertRowid]));
});
on('PUT', '/api/materials/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM materials WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Material not found' });
  const name = b.name !== undefined ? b.name : existing.name;
  const unit = b.unit !== undefined ? b.unit : existing.unit;
  const default_price = b.default_price !== undefined ? money(b.default_price) : existing.default_price;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : existing.active;
  run('UPDATE materials SET name = ?, unit = ?, default_price = ?, active = ? WHERE id = ?', [name, unit, default_price, active, params.id]);
  sendJson(res, 200, get('SELECT * FROM materials WHERE id = ?', [params.id]));
});
on('DELETE', '/api/materials/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const inUse = get('SELECT COUNT(*) as c FROM orders WHERE material_id = ?', [params.id]).c;
  if (inUse > 0) return sendJson(res, 400, { error: `Can't delete — ${inUse} order(s) use this material. Mark it inactive instead.` });
  run('DELETE FROM materials WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- DRIVERS ----
on('GET', '/api/drivers-public', async (req, res) => { sendJson(res, 200, all('SELECT id, name FROM drivers WHERE active = 1 ORDER BY name')); });
on('GET', '/api/drivers', async (req, res) => { if (!requireAuth(req, res)) return; sendJson(res, 200, all('SELECT id, name, phone, truck_label, active FROM drivers ORDER BY name')); });
on('POST', '/api/drivers', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.name || !b.pin) return sendJson(res, 400, { error: 'Name and PIN are required' });
  const result = run('INSERT INTO drivers (name, phone, truck_label, pin) VALUES (?, ?, ?, ?)', [b.name, b.phone || null, b.truck_label || null, String(b.pin)]);
  sendJson(res, 201, get('SELECT id, name, phone, truck_label, active FROM drivers WHERE id = ?', [result.lastInsertRowid]));
});
on('PUT', '/api/drivers/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM drivers WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Driver not found' });
  const name = b.name !== undefined ? b.name : existing.name;
  const phone = b.phone !== undefined ? b.phone : existing.phone;
  const truck_label = b.truck_label !== undefined ? b.truck_label : existing.truck_label;
  const pin = b.pin !== undefined && b.pin !== '' ? String(b.pin) : existing.pin;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : existing.active;
  run('UPDATE drivers SET name = ?, phone = ?, truck_label = ?, pin = ?, active = ? WHERE id = ?', [name, phone, truck_label, pin, active, params.id]);
  sendJson(res, 200, get('SELECT id, name, phone, truck_label, pin, active FROM drivers WHERE id = ?', [params.id]));
});
on('DELETE', '/api/drivers/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const inUse = get('SELECT COUNT(*) as c FROM orders WHERE driver_id = ?', [params.id]).c;
  if (inUse > 0) return sendJson(res, 400, { error: `Can't delete — ${inUse} order(s) are assigned to this driver. Mark them inactive instead.` });
  run('DELETE FROM drivers WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- SETTINGS ----
on('GET', '/api/settings', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const rows = all('SELECT * FROM settings');
  const obj = {}; rows.forEach((r) => { obj[r.key] = r.value; });
  sendJson(res, 200, obj);
});
on('PUT', '/api/settings', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (b.shop_address !== undefined) {
    const prev = getSetting('shop_address');
    setSetting('shop_address', b.shop_address);
    if (b.shop_address !== prev) { setSetting('shop_lat', ''); setSetting('shop_lng', ''); }
  }
  if (b.sales_tax_rate !== undefined) {
    setSetting('sales_tax_rate', String(Number(b.sales_tax_rate) || 0));
  }
  sendJson(res, 200, { ok: true });
});

// ---- MILEAGE BANDS ----
on('GET', '/api/mileage-bands', async (req, res) => { if (!requireAuth(req, res)) return; sendJson(res, 200, all('SELECT * FROM mileage_bands ORDER BY min_miles')); });
on('POST', '/api/mileage-bands', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (b.min_miles === undefined || b.min_miles === '') return sendJson(res, 400, { error: 'min_miles is required' });
  const result = run('INSERT INTO mileage_bands (min_miles, max_miles, fee, label, sort_order) VALUES (?, ?, ?, ?, ?)', [
    Number(b.min_miles), b.max_miles !== undefined && b.max_miles !== '' ? Number(b.max_miles) : null,
    b.fee !== undefined && b.fee !== '' ? money(b.fee) : null, b.label || null, b.sort_order !== undefined ? Number(b.sort_order) : 0,
  ]);
  sendJson(res, 201, get('SELECT * FROM mileage_bands WHERE id = ?', [result.lastInsertRowid]));
});
on('PUT', '/api/mileage-bands/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM mileage_bands WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Not found' });
  const min_miles = b.min_miles !== undefined ? Number(b.min_miles) : existing.min_miles;
  const max_miles = b.max_miles !== undefined ? (b.max_miles === '' ? null : Number(b.max_miles)) : existing.max_miles;
  const fee = b.fee !== undefined ? (b.fee === '' ? null : money(b.fee)) : existing.fee;
  const label = b.label !== undefined ? b.label : existing.label;
  run('UPDATE mileage_bands SET min_miles = ?, max_miles = ?, fee = ?, label = ? WHERE id = ?', [min_miles, max_miles, fee, label, params.id]);
  sendJson(res, 200, get('SELECT * FROM mileage_bands WHERE id = ?', [params.id]));
});
on('DELETE', '/api/mileage-bands/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  run('DELETE FROM mileage_bands WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- SMS ORDER ALERTS ----
on('GET', '/api/sms-status', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const channel = clicksendConfigured() ? 'clicksend' : (twilioConfigured() ? 'twilio' : (emailSmsConfigured() ? 'email' : null));
  sendJson(res, 200, { configured: Boolean(channel), channel });
});
on('GET', '/api/sms-recipients', async (req, res) => { if (!requireOffice(req, res)) return; sendJson(res, 200, all('SELECT * FROM sms_recipients ORDER BY name')); });
on('POST', '/api/sms-recipients', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.name || !b.phone) return sendJson(res, 400, { error: 'Name and phone are required' });
  const result = run('INSERT INTO sms_recipients (name, phone, carrier, custom_gateway_domain) VALUES (?, ?, ?, ?)',
    [b.name, b.phone, b.carrier || 'verizon', b.custom_gateway_domain || null]);
  sendJson(res, 201, get('SELECT * FROM sms_recipients WHERE id = ?', [result.lastInsertRowid]));
});
on('PUT', '/api/sms-recipients/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM sms_recipients WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Not found' });
  const name = b.name !== undefined ? b.name : existing.name;
  const phone = b.phone !== undefined ? b.phone : existing.phone;
  const carrier = b.carrier !== undefined ? b.carrier : existing.carrier;
  const custom_gateway_domain = b.custom_gateway_domain !== undefined ? b.custom_gateway_domain : existing.custom_gateway_domain;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : existing.active;
  run('UPDATE sms_recipients SET name = ?, phone = ?, carrier = ?, custom_gateway_domain = ?, active = ? WHERE id = ?',
    [name, phone, carrier, custom_gateway_domain, active, params.id]);
  sendJson(res, 200, get('SELECT * FROM sms_recipients WHERE id = ?', [params.id]));
});
on('POST', '/api/sms-recipients/:id/test', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const recipient = get('SELECT * FROM sms_recipients WHERE id = ?', [params.id]);
  if (!recipient) return sendJson(res, 404, { error: 'Not found' });
  try {
    // sendSms/sendClickSendSms (single recipient) on purpose, not the
    // broadcast* helpers — those swallow per-recipient failures by design
    // (fire-and-forget for real order alerts), which would make this Test
    // button always report success even when the send actually failed.
    if (clicksendConfigured()) {
      await sendClickSendSms(recipient.phone, 'This is a test alert from OPD Development Corp — if you got this, order alerts are working.');
    } else if (twilioConfigured()) {
      await sendSms(recipient.phone, 'This is a test alert from OPD Development Corp — if you got this, order alerts are working.');
    } else if (emailSmsConfigured()) {
      await sendEmailSms([recipient], 'OPD Development Corp test', 'This is a test alert from OPD Development Corp — if you got this, order alerts are working.');
    } else {
      return sendJson(res, 400, { error: 'No SMS channel is configured yet.' });
    }
    sendJson(res, 200, { ok: true });
  } catch (e) {
    console.error('SMS test send failed:', e && e.stack ? e.stack : e);
    sendJson(res, 502, { error: (e && e.message) || 'Test message failed to send.' });
  }
});
on('DELETE', '/api/sms-recipients/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  run('DELETE FROM sms_recipients WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- DELIVERY DISTANCE ESTIMATOR ----
on('POST', '/api/estimate-distance', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.address) return sendJson(res, 400, { error: 'address is required' });
  const shopAddress = getSetting('shop_address');
  if (!shopAddress) return sendJson(res, 400, { error: 'Shop address is not set. Set it on the Admin page first.' });
  try {
    let shopLat = getSetting('shop_lat'), shopLng = getSetting('shop_lng');
    if (!shopLat || !shopLng) {
      const shopGeo = await geocodeAddress(shopAddress);
      shopLat = shopGeo.lat; shopLng = shopGeo.lng;
      setSetting('shop_lat', String(shopLat)); setSetting('shop_lng', String(shopLng));
    }
    const dest = await geocodeAddress(b.address);
    const { miles, method } = await drivingMiles({ lat: Number(shopLat), lng: Number(shopLng) }, dest);
    const bands = all('SELECT * FROM mileage_bands ORDER BY min_miles');
    const band = bands.find((bd) => miles >= bd.min_miles && (bd.max_miles === null || miles < bd.max_miles));
    sendJson(res, 200, {
      miles: Math.round(miles * 10) / 10,
      fee: band ? band.fee : null,
      band_label: band ? band.label : 'Outside defined mileage ranges — quote manually',
      method,
    });
  } catch (e) {
    sendJson(res, 502, { error: e.message || 'Could not estimate distance right now.' });
  }
});

// ---- ORDERS ----
on('GET', '/api/orders', async (req, res, params, query) => {
  if (!requireAuth(req, res)) return;
  const clauses = [], args = [];
  if (query.status) { clauses.push('o.status = ?'); args.push(query.status); }
  if (query.driver_id) { clauses.push('o.driver_id = ?'); args.push(query.driver_id); }
  if (query.date) { clauses.push('o.scheduled_date = ?'); args.push(query.date); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  sendJson(res, 200, all(`${ORDER_SELECT} ${where} ORDER BY o.created_at DESC`, args));
});
on('GET', '/api/orders/:id', async (req, res, params) => {
  if (!requireAuth(req, res)) return;
  const row = get(`${ORDER_SELECT} WHERE o.id = ?`, [params.id]);
  if (!row) return sendJson(res, 404, { error: 'Order not found' });
  sendJson(res, 200, row);
});
on('POST', '/api/orders', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.customer_id || !b.material_id || !b.quantity || !b.delivery_address) return sendJson(res, 400, { error: 'customer_id, material_id, quantity, and delivery_address are required' });
  const material = get('SELECT * FROM materials WHERE id = ?', [b.material_id]);
  if (!material) return sendJson(res, 400, { error: 'Unknown material' });
  const pricePerUnit = b.price_per_unit !== undefined ? money(b.price_per_unit) : material.default_price;
  const orderNumber = nextOrderNumber();
  const distanceMiles = b.distance_miles !== undefined && b.distance_miles !== null && b.distance_miles !== '' ? Number(b.distance_miles) : null;
  const deliveryFee = b.delivery_fee !== undefined && b.delivery_fee !== null && b.delivery_fee !== '' ? money(b.delivery_fee) : 0;
  const taxRatePercent = Number(getSetting('sales_tax_rate', '7'));
  const { salesTaxRate, salesTaxAmount, totalAmount } = computeOrderTotals(b.quantity, pricePerUnit, deliveryFee, taxRatePercent);
  const result = run(
    `INSERT INTO orders (order_number, customer_id, material_id, quantity, unit, price_per_unit, delivery_address, distance_miles, delivery_fee, sales_tax_rate, sales_tax_amount, total_amount, requested_date, requested_window, notes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new')`,
    [orderNumber, b.customer_id, b.material_id, b.quantity, material.unit, pricePerUnit, b.delivery_address, distanceMiles, deliveryFee, salesTaxRate, salesTaxAmount, totalAmount, b.requested_date || null, b.requested_window || null, b.notes || null]
  );
  const orderId = result.lastInsertRowid;
  const seedDate = b.driver_id && b.scheduled_date ? b.scheduled_date : (b.requested_date || todayStr());
  const preferredDriverId = b.driver_id && b.scheduled_date ? Number(b.driver_id) : null;
  generateDeliveriesForOrder({ id: orderId, quantity: b.quantity }, { startDate: seedDate, preferredDriverId });
  recomputeOrderRollup(orderId);
  const newOrder = get(`${ORDER_SELECT} WHERE o.id = ?`, [orderId]);
  newOrder.deliveries = all(`SELECT del.*, dr.name as driver_name FROM deliveries del LEFT JOIN drivers dr ON dr.id = del.driver_id WHERE del.order_id = ? ORDER BY del.sequence`, [orderId]);
  notifyNewOrder(newOrder); // fire-and-forget — never blocks or fails the order creation response
  sendJson(res, 201, newOrder);
});
on('PUT', '/api/orders/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM orders WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Order not found' });
  const fields = ['customer_id', 'material_id', 'quantity', 'unit', 'price_per_unit', 'delivery_address', 'distance_miles', 'delivery_fee', 'requested_date', 'requested_window', 'notes', 'square_invoice_number'];
  const updates = {};
  for (const f of fields) if (b[f] !== undefined) updates[f] = b[f];
  if (b.square_invoiced !== undefined) updates.square_invoiced = b.square_invoiced ? 1 : 0;
  if (b.square_paid !== undefined) updates.square_paid = b.square_paid ? 1 : 0;
  if (updates.quantity !== undefined || updates.price_per_unit !== undefined || updates.delivery_fee !== undefined) {
    const quantity = updates.quantity !== undefined ? updates.quantity : existing.quantity;
    const pricePerUnit = updates.price_per_unit !== undefined ? updates.price_per_unit : existing.price_per_unit;
    const deliveryFee = updates.delivery_fee !== undefined ? updates.delivery_fee : existing.delivery_fee;
    const taxRatePercent = existing.sales_tax_rate || Number(getSetting('sales_tax_rate', '7'));
    const { salesTaxAmount, totalAmount } = computeOrderTotals(quantity, pricePerUnit, deliveryFee, taxRatePercent);
    updates.sales_tax_amount = salesTaxAmount;
    updates.total_amount = totalAmount;
  }
  if (b.status && ['delivered', 'out_for_delivery', 'cancelled'].includes(b.status)) {
    const activeDeliveries = all(`SELECT id FROM deliveries WHERE order_id = ? AND status NOT IN ('cancelled','delivered')`, [params.id]);
    activeDeliveries.forEach((d) => {
      if (b.status === 'delivered') run(`UPDATE deliveries SET status = 'delivered', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [d.id]);
      else if (b.status === 'out_for_delivery') run(`UPDATE deliveries SET status = 'out_for_delivery', updated_at = datetime('now') WHERE id = ?`, [d.id]);
      else if (b.status === 'cancelled') run(`UPDATE deliveries SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`, [d.id]);
    });
  }
  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  if (setClause) run(`UPDATE orders SET ${setClause}, updated_at = datetime('now') WHERE id = ?`, [...Object.values(updates), params.id]);
  recomputeOrderRollup(params.id);
  sendJson(res, 200, get(`${ORDER_SELECT} WHERE o.id = ?`, [params.id]));
});
on('DELETE', '/api/orders/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const existing = get('SELECT * FROM orders WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Order not found' });
  if (existing.status === 'invoiced' || existing.invoice_id) {
    return sendJson(res, 400, { error: 'This order is on an invoice — remove it from the invoice first, or use "Cancel Order" instead of deleting.' });
  }
  run('DELETE FROM orders WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- DELIVERIES (the schedule board's unit of work — one truckload) ------
const DELIVERY_SELECT = `
  SELECT del.*, o.order_number, o.delivery_address, o.notes as order_notes, o.requested_date, o.requested_window,
         o.customer_id, c.name as customer_name, c.phone as customer_phone,
         o.material_id, m.name as material_name, o.unit,
         dr.name as driver_name, dr.truck_label as driver_truck,
         (SELECT COUNT(*) FROM deliveries d2 WHERE d2.order_id = del.order_id AND d2.status != 'cancelled') as total_deliveries
  FROM deliveries del
  JOIN orders o ON o.id = del.order_id
  JOIN customers c ON c.id = o.customer_id
  JOIN materials m ON m.id = o.material_id
  LEFT JOIN drivers dr ON dr.id = del.driver_id
`;
on('GET', '/api/deliveries', async (req, res, params, query) => {
  if (!requireAuth(req, res)) return;
  const args = [];
  if (query.order_id) {
    const rows = all(`${DELIVERY_SELECT} WHERE del.order_id = ? ORDER BY del.sequence`, [query.order_id]);
    return sendJson(res, 200, rows.map((r) => ({ ...r, slot_time: slotTimeLabel(r.slot_index) })));
  }
  const clauses = [`del.status != 'cancelled'`];
  if (query.driver_id) { clauses.push('del.driver_id = ?'); args.push(query.driver_id); }
  let dateGroup = 'del.scheduled_date IS NULL';
  if (query.start && query.end) { dateGroup += ' OR (del.scheduled_date BETWEEN ? AND ?)'; args.push(query.start, query.end); }
  else if (query.date) { dateGroup += ' OR del.scheduled_date = ?'; args.push(query.date); }
  const rows = all(`${DELIVERY_SELECT} WHERE ${clauses.join(' AND ')} AND (${dateGroup}) ORDER BY del.scheduled_date IS NULL DESC, del.scheduled_date, del.driver_id, del.slot_index`, args);
  sendJson(res, 200, rows.map((r) => ({ ...r, slot_time: slotTimeLabel(r.slot_index) })));
});
on('PUT', '/api/deliveries/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM deliveries WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Delivery not found' });
  if (existing.status === 'delivered') return sendJson(res, 400, { error: 'Already delivered — nothing to reschedule.' });
  if (b.unschedule) {
    run(`UPDATE deliveries SET driver_id = NULL, scheduled_date = NULL, slot_index = NULL, status = 'unscheduled', updated_at = datetime('now') WHERE id = ?`, [params.id]);
  } else {
    const driverId = b.driver_id !== undefined ? Number(b.driver_id) : existing.driver_id;
    const scheduledDate = b.scheduled_date !== undefined ? b.scheduled_date : existing.scheduled_date;
    if (!driverId || !scheduledDate) return sendJson(res, 400, { error: 'driver_id and scheduled_date are required (or pass unschedule: true).' });
    let slot = b.slot_index !== undefined ? b.slot_index : null;
    if (slot === null) {
      const used = new Set(usedSlots(driverId, scheduledDate));
      if (existing.driver_id === driverId && existing.scheduled_date === scheduledDate && existing.slot_index !== null) used.delete(existing.slot_index);
      let openSlot = null;
      for (let s = 0; s < SLOTS_PER_DAY; s++) if (!used.has(s)) { openSlot = s; break; }
      if (openSlot === null) return sendJson(res, 400, { error: `That driver is fully booked that day (${SLOTS_PER_DAY}/${SLOTS_PER_DAY}). Pick another day or driver.` });
      slot = openSlot;
    } else {
      const clash = get(`SELECT id FROM deliveries WHERE driver_id = ? AND scheduled_date = ? AND slot_index = ? AND status != 'cancelled' AND id != ?`, [driverId, scheduledDate, slot, params.id]);
      if (clash) return sendJson(res, 400, { error: 'That slot is already taken.' });
    }
    run(`UPDATE deliveries SET driver_id = ?, scheduled_date = ?, slot_index = ?, status = CASE WHEN status = 'unscheduled' THEN 'scheduled' ELSE status END, updated_at = datetime('now') WHERE id = ?`, [driverId, scheduledDate, slot, params.id]);
  }
  recomputeOrderRollup(existing.order_id);
  sendJson(res, 200, get(`${DELIVERY_SELECT} WHERE del.id = ?`, [params.id]));
});
on('POST', '/api/deliveries/:id/start', async (req, res, params) => {
  const session = requireAuth(req, res); if (!session) return;
  const existing = get('SELECT * FROM deliveries WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Delivery not found' });
  if (session.role === 'driver' && existing.driver_id !== session.driverId) return sendJson(res, 403, { error: 'Not your delivery' });
  run(`UPDATE deliveries SET status = 'out_for_delivery', updated_at = datetime('now') WHERE id = ?`, [params.id]);
  recomputeOrderRollup(existing.order_id);
  sendJson(res, 200, get(`${DELIVERY_SELECT} WHERE del.id = ?`, [params.id]));
});
on('POST', '/api/deliveries/:id/deliver', async (req, res, params) => {
  const session = requireAuth(req, res); if (!session) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM deliveries WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Delivery not found' });
  if (session.role === 'driver' && existing.driver_id !== session.driverId) return sendJson(res, 403, { error: 'Not your delivery' });
  run(`UPDATE deliveries SET status = 'delivered', delivered_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`, [params.id]);
  if (b.driver_notes) run(`UPDATE orders SET driver_notes = ?, updated_at = datetime('now') WHERE id = ?`, [b.driver_notes, existing.order_id]);
  recomputeOrderRollup(existing.order_id);
  sendJson(res, 200, get(`${DELIVERY_SELECT} WHERE del.id = ?`, [params.id]));
});

// ---- DRIVER JOBS ----
on('GET', '/api/driver/jobs', async (req, res, params, query) => {
  const session = requireAuth(req, res); if (!session) return;
  const driverId = session.role === 'driver' ? session.driverId : query.driver_id;
  if (!driverId) return sendJson(res, 400, { error: 'driver_id required' });
  const date = query.date || todayStr();
  const rows = all(`${DELIVERY_SELECT} WHERE del.driver_id = ? AND del.scheduled_date = ? AND del.status IN ('scheduled','out_for_delivery','delivered') ORDER BY del.slot_index IS NULL, del.slot_index`, [driverId, date]);
  sendJson(res, 200, rows.map((r) => ({ ...r, slot_time: slotTimeLabel(r.slot_index) })));
});

// ---- INVOICES ----
on('GET', '/api/invoices', async (req, res, params, query) => {
  if (!requireOffice(req, res)) return;
  const clauses = [], args = [];
  if (query.status) { clauses.push('i.status = ?'); args.push(query.status); }
  if (query.customer_id) { clauses.push('i.customer_id = ?'); args.push(query.customer_id); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  sendJson(res, 200, all(`SELECT i.*, c.name as customer_name, c.email as customer_email FROM invoices i JOIN customers c ON c.id = i.customer_id ${where} ORDER BY i.created_at DESC`, args));
});
on('GET', '/api/invoices/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const invoice = get(`SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone, c.billing_address as customer_address FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.id = ?`, [params.id]);
  if (!invoice) return sendJson(res, 404, { error: 'Invoice not found' });
  const items = all('SELECT * FROM invoice_items WHERE invoice_id = ?', [params.id]);
  const payments = all('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at', [params.id]);
  sendJson(res, 200, { ...invoice, items, payments });
});
on('GET', '/api/orders-ready-to-invoice', async (req, res, params, query) => {
  if (!requireOffice(req, res)) return;
  const clauses = ["o.status = 'delivered'"], args = [];
  if (query.customer_id) { clauses.push('o.customer_id = ?'); args.push(query.customer_id); }
  sendJson(res, 200, all(`${ORDER_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY o.delivered_at`, args));
});
on('POST', '/api/invoices', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const orderIds = b.order_ids || [];
  if (!orderIds.length) return sendJson(res, 400, { error: 'order_ids is required' });
  const orders = orderIds.map((id) => get('SELECT * FROM orders WHERE id = ?', [id])).filter(Boolean);
  if (!orders.length) return sendJson(res, 400, { error: 'No valid orders found' });
  const customerId = orders[0].customer_id;
  if (orders.some((o) => o.customer_id !== customerId)) return sendJson(res, 400, { error: 'All orders on one invoice must belong to the same customer' });
  const taxRate = b.tax_rate !== undefined ? Number(b.tax_rate) : 0;
  const invoiceNumber = nextInvoiceNumber();
  const payToken = crypto.randomBytes(16).toString('hex');
  const issuedDate = todayStr();
  const subtotal = money(orders.reduce((sum, o) => sum + o.quantity * o.price_per_unit + (o.delivery_fee || 0), 0));
  const taxAmount = money(subtotal * (taxRate / 100));
  const total = money(subtotal + taxAmount);
  const result = run(`INSERT INTO invoices (invoice_number, customer_id, status, subtotal, tax_rate, tax_amount, total, issued_date, due_date, notes, pay_token) VALUES (?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`, [invoiceNumber, customerId, subtotal, taxRate, taxAmount, total, issuedDate, b.due_date || null, b.notes || null, payToken]);
  const invoiceId = result.lastInsertRowid;
  const materialsCache = {};
  for (const o of orders) {
    if (!materialsCache[o.material_id]) materialsCache[o.material_id] = get('SELECT * FROM materials WHERE id = ?', [o.material_id]);
    const material = materialsCache[o.material_id];
    const amount = money(o.quantity * o.price_per_unit);
    run(`INSERT INTO invoice_items (invoice_id, order_id, description, quantity, unit, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`, [invoiceId, o.id, `${material.name} – delivered to ${o.delivery_address}`, o.quantity, o.unit, o.price_per_unit, amount]);
    if (o.delivery_fee && o.delivery_fee > 0) {
      const feeDesc = o.distance_miles ? `Delivery Fee (${o.distance_miles} mi)` : 'Delivery Fee';
      run(`INSERT INTO invoice_items (invoice_id, order_id, description, quantity, unit, unit_price, amount) VALUES (?, ?, ?, ?, ?, ?, ?)`, [invoiceId, o.id, feeDesc, 1, 'trip', money(o.delivery_fee), money(o.delivery_fee)]);
    }
    run(`UPDATE orders SET status = 'invoiced', invoice_id = ?, updated_at = datetime('now') WHERE id = ?`, [invoiceId, o.id]);
  }
  sendJson(res, 201, get('SELECT * FROM invoices WHERE id = ?', [invoiceId]));
});
on('DELETE', '/api/invoices/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const invoice = get('SELECT * FROM invoices WHERE id = ?', [params.id]);
  if (!invoice) return sendJson(res, 404, { error: 'Invoice not found' });
  if (invoice.amount_paid > 0 || invoice.status === 'paid' || invoice.status === 'partial') {
    return sendJson(res, 400, { error: 'This invoice has payments recorded and can\'t be deleted. Void or refund the payment first.' });
  }
  run(`UPDATE orders SET status = 'delivered', invoice_id = NULL, updated_at = datetime('now') WHERE invoice_id = ?`, [params.id]);
  run('DELETE FROM payments WHERE invoice_id = ?', [params.id]);
  run('DELETE FROM invoice_items WHERE invoice_id = ?', [params.id]);
  run('DELETE FROM invoices WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});
on('POST', '/api/invoices/:id/send', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const invoice = get('SELECT * FROM invoices WHERE id = ?', [params.id]);
  if (!invoice) return sendJson(res, 404, { error: 'Invoice not found' });
  run(`UPDATE invoices SET status = 'sent' WHERE id = ?`, [params.id]);
  sendJson(res, 200, get('SELECT * FROM invoices WHERE id = ?', [params.id]));
});
on('POST', '/api/invoices/:id/mark-paid', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const invoice = get('SELECT * FROM invoices WHERE id = ?', [params.id]);
  if (!invoice) return sendJson(res, 404, { error: 'Invoice not found' });
  const amount = b.amount !== undefined ? money(b.amount) : invoice.total - invoice.amount_paid;
  run('INSERT INTO payments (invoice_id, amount, method, reference) VALUES (?, ?, ?, ?)', [params.id, amount, b.method || 'other', b.reference || null]);
  const newPaid = money(invoice.amount_paid + amount);
  const fullyPaid = newPaid >= invoice.total - 0.005;
  run(`UPDATE invoices SET amount_paid = ?, status = ?, paid_date = ? WHERE id = ?`, [newPaid, fullyPaid ? 'paid' : 'partial', fullyPaid ? todayStr() : invoice.paid_date, params.id]);
  sendJson(res, 200, get('SELECT * FROM invoices WHERE id = ?', [params.id]));
});
on('POST', '/api/invoices/:id/checkout', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const invoice = get('SELECT * FROM invoices WHERE id = ?', [params.id]);
  if (!invoice) return sendJson(res, 404, { error: 'Invoice not found' });
  if (!stripeConfigured()) return sendJson(res, 400, { error: 'Stripe is not configured yet. Add STRIPE_SECRET_KEY in Railway’s Variables tab. In the meantime, use "Mark Paid" to record cash/check/ACH payments.' });
  const customer = get('SELECT * FROM customers WHERE id = ?', [invoice.customer_id]);
  const baseUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  try {
    const session = await createCheckoutSession({ invoiceNumber: invoice.invoice_number, amountCents: Math.round((invoice.total - invoice.amount_paid) * 100), customerName: customer.name, description: `${customer.name} – Invoice ${invoice.invoice_number}`, successUrl: `${baseUrl}/pay/${invoice.pay_token}?paid=1`, cancelUrl: `${baseUrl}/pay/${invoice.pay_token}`, invoiceId: invoice.id });
    run('UPDATE invoices SET stripe_checkout_url = ?, stripe_session_id = ? WHERE id = ?', [session.url, session.id, invoice.id]);
    sendJson(res, 200, { url: session.url });
  } catch (e) { sendJson(res, 500, { error: e.message }); }
});

// ---- CONSTRUCTION JOBS ----
const JOB_STATUSES = ['inquiry', 'estimate_scheduled', 'quote_sent', 'accepted', 'scheduled', 'deposit_received', 'in_progress', 'complete', 'cancelled'];
const JOB_SELECT = `SELECT j.*, cr.name as crew_name FROM jobs j LEFT JOIN crews cr ON cr.id = j.crew_id`;
function nextJobNumber() {
  const d = new Date();
  const prefix = `JOB-${d.getFullYear()}-`;
  const rows = all('SELECT job_number FROM jobs WHERE job_number LIKE ?', [`${prefix}%`]);
  let max = 0;
  rows.forEach((r) => {
    const n = parseInt(r.job_number.slice(prefix.length), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
function jobDateRange(job) {
  if (!job.target_start_date) return null;
  const start = new Date(`${job.target_start_date}T00:00:00`);
  const days = Math.max(1, Math.ceil(Number(job.duration_days) || 1));
  const end = new Date(start);
  end.setDate(end.getDate() + days - 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}
function rangesOverlap(aStart, aEnd, bStart, bEnd) { return aStart <= bEnd && bStart <= aEnd; }

on('GET', '/api/jobs', async (req, res, params, query) => {
  if (!requireAuth(req, res)) return;
  const where = []; const args = [];
  if (query && query.status) { where.push('j.status = ?'); args.push(query.status); }
  if (query && query.crew_id) { where.push('j.crew_id = ?'); args.push(query.crew_id); }
  if (query && query.q) { where.push('(j.job_number LIKE ? OR j.customer_name LIKE ? OR j.site_address LIKE ? OR j.scope LIKE ?)'); const like = `%${query.q}%`; args.push(like, like, like, like); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  sendJson(res, 200, all(`${JOB_SELECT} ${clause} ORDER BY (j.target_start_date IS NULL), j.target_start_date, j.created_at DESC`, args));
});

on('GET', '/api/jobs/followups-due', async (req, res) => {
  if (!requireOffice(req, res)) return;
  sendJson(res, 200, all(`${JOB_SELECT} WHERE j.next_followup_date IS NOT NULL AND j.next_followup_date <= ? AND j.status NOT IN ('complete','cancelled') ORDER BY j.next_followup_date`, [todayStr()]));
});

on('GET', '/api/jobs/capacity', async (req, res, params, query) => {
  if (!requireOffice(req, res)) return;
  const start = (query && query.start) || todayStr();
  const end = (query && query.end) || start;
  const jobs = all(`${JOB_SELECT} WHERE j.crew_id IS NOT NULL AND j.status NOT IN ('cancelled') AND j.target_start_date IS NOT NULL ORDER BY j.target_start_date`);
  const crewBookings = [];
  jobs.forEach((j) => {
    const range = jobDateRange(j);
    if (range && rangesOverlap(range.start, range.end, start, end)) {
      crewBookings.push({ crew_id: j.crew_id, crew_name: j.crew_name, job_id: j.id, job_number: j.job_number, customer_name: j.customer_name, start: range.start, end: range.end, status: j.status });
    }
  });
  const equipRows = all(`SELECT je.*, e.name as equipment_name, j.job_number, j.customer_name, j.status as job_status FROM job_equipment je JOIN equipment e ON e.id = je.equipment_id JOIN jobs j ON j.id = je.job_id WHERE j.status != 'cancelled'`);
  const equipmentBookings = equipRows.filter((r) => r.start_date && r.end_date && rangesOverlap(r.start_date, r.end_date, start, end));
  sendJson(res, 200, { crewBookings, equipmentBookings });
});

on('GET', '/api/jobs/:id', async (req, res, params) => {
  if (!requireAuth(req, res)) return;
  const row = get(`${JOB_SELECT} WHERE j.id = ?`, [params.id]);
  if (!row) return sendJson(res, 404, { error: 'Job not found' });
  sendJson(res, 200, row);
});

on('POST', '/api/jobs', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  let customerName = b.customer_name || null;
  let customerPhone = b.customer_phone || null;
  if (b.customer_id) {
    const cust = get('SELECT * FROM customers WHERE id = ?', [b.customer_id]);
    if (cust) { customerName = customerName || cust.name; customerPhone = customerPhone || cust.phone; }
  }
  if (!customerName) return sendJson(res, 400, { error: 'Customer name is required' });
  const status = b.status && JOB_STATUSES.includes(b.status) ? b.status : 'inquiry';
  const jobNumber = b.job_number || nextJobNumber();
  const result = run(
    `INSERT INTO jobs (job_number, customer_id, customer_name, customer_phone, site_address, scope, price, target_start_date, duration_days, crew_id, status, permit_number, next_followup_date, followup_note, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [jobNumber, b.customer_id || null, customerName, customerPhone, b.site_address || null, b.scope || null,
     b.price !== undefined && b.price !== '' ? money(b.price) : null, b.target_start_date || null,
     b.duration_days !== undefined && b.duration_days !== '' ? Number(b.duration_days) : null,
     b.crew_id || null, status, b.permit_number || null, b.next_followup_date || null, b.followup_note || null, b.notes || null]
  );
  sendJson(res, 201, get(`${JOB_SELECT} WHERE j.id = ?`, [result.lastInsertRowid]));
});

on('PUT', '/api/jobs/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM jobs WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Job not found' });
  if (b.status !== undefined && !JOB_STATUSES.includes(b.status)) return sendJson(res, 400, { error: 'Invalid status' });
  const fields = ['customer_id', 'customer_name', 'customer_phone', 'site_address', 'scope', 'price', 'target_start_date', 'duration_days', 'crew_id', 'status', 'permit_number', 'next_followup_date', 'followup_note', 'notes'];
  const next = { ...existing };
  fields.forEach((f) => { if (b[f] !== undefined) next[f] = b[f] === '' ? null : b[f]; });
  if (next.price !== null && next.price !== undefined) next.price = money(next.price);
  if (next.duration_days !== null && next.duration_days !== undefined) next.duration_days = Number(next.duration_days);
  run(
    `UPDATE jobs SET customer_id = ?, customer_name = ?, customer_phone = ?, site_address = ?, scope = ?, price = ?, target_start_date = ?, duration_days = ?, crew_id = ?, status = ?, permit_number = ?, next_followup_date = ?, followup_note = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
    [next.customer_id, next.customer_name, next.customer_phone, next.site_address, next.scope, next.price, next.target_start_date, next.duration_days, next.crew_id, next.status, next.permit_number, next.next_followup_date, next.followup_note, next.notes, params.id]
  );
  sendJson(res, 200, get(`${JOB_SELECT} WHERE j.id = ?`, [params.id]));
});

on('DELETE', '/api/jobs/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const existing = get('SELECT * FROM jobs WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Job not found' });
  run('DELETE FROM job_checklist_items WHERE job_id = ?', [params.id]);
  run('DELETE FROM job_todos WHERE job_id = ?', [params.id]);
  run('DELETE FROM job_permits WHERE job_id = ?', [params.id]);
  run('DELETE FROM job_equipment WHERE job_id = ?', [params.id]);
  run('DELETE FROM jobs WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- JOB CHECKLIST ----
on('GET', '/api/job-checklist', async (req, res, params, query) => {
  if (!requireAuth(req, res)) return;
  if (!query || !query.job_id) return sendJson(res, 400, { error: 'job_id is required' });
  sendJson(res, 200, all('SELECT * FROM job_checklist_items WHERE job_id = ? ORDER BY sort_order, id', [query.job_id]));
});
on('POST', '/api/job-checklist', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.job_id || !b.label) return sendJson(res, 400, { error: 'job_id and label are required' });
  const maxOrder = get('SELECT MAX(sort_order) as m FROM job_checklist_items WHERE job_id = ?', [b.job_id]).m;
  const result = run('INSERT INTO job_checklist_items (job_id, label, sort_order) VALUES (?, ?, ?)', [b.job_id, b.label, (maxOrder || 0) + 1]);
  sendJson(res, 201, get('SELECT * FROM job_checklist_items WHERE id = ?', [result.lastInsertRowid]));
});
on('PUT', '/api/job-checklist/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM job_checklist_items WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Checklist item not found' });
  const label = b.label !== undefined ? b.label : existing.label;
  const done = b.done !== undefined ? (b.done ? 1 : 0) : existing.done;
  run('UPDATE job_checklist_items SET label = ?, done = ? WHERE id = ?', [label, done, params.id]);
  sendJson(res, 200, get('SELECT * FROM job_checklist_items WHERE id = ?', [params.id]));
});
on('DELETE', '/api/job-checklist/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  run('DELETE FROM job_checklist_items WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- JOB TO-DOS ----
on('GET', '/api/job-todos', async (req, res, params, query) => {
  if (!requireAuth(req, res)) return;
  const where = []; const args = [];
  if (query && query.job_id) { where.push('t.job_id = ?'); args.push(query.job_id); }
  if (query && query.category) { where.push('t.category = ?'); args.push(query.category); }
  if (query && query.open === '1') { where.push('t.done = 0'); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  sendJson(res, 200, all(`SELECT t.*, j.job_number, j.customer_name, j.status as job_status FROM job_todos t JOIN jobs j ON j.id = t.job_id ${clause} ORDER BY t.done, t.sort_order, t.id`, args));
});
on('POST', '/api/job-todos', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.job_id || !b.description) return sendJson(res, 400, { error: 'job_id and description are required' });
  const category = b.category === 'field' ? 'field' : 'office';
  const maxOrder = get('SELECT MAX(sort_order) as m FROM job_todos WHERE job_id = ?', [b.job_id]).m;
  const result = run('INSERT INTO job_todos (job_id, description, category, sort_order) VALUES (?, ?, ?, ?)', [b.job_id, b.description, category, (maxOrder || 0) + 1]);
  sendJson(res, 201, get('SELECT * FROM job_todos WHERE id = ?', [result.lastInsertRowid]));
});
on('PUT', '/api/job-todos/:id', async (req, res, params) => {
  if (!requireAuth(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM job_todos WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'To-do not found' });
  const description = b.description !== undefined ? b.description : existing.description;
  const category = b.category !== undefined ? (b.category === 'field' ? 'field' : 'office') : existing.category;
  const done = b.done !== undefined ? (b.done ? 1 : 0) : existing.done;
  run('UPDATE job_todos SET description = ?, category = ?, done = ? WHERE id = ?', [description, category, done, params.id]);
  sendJson(res, 200, get('SELECT * FROM job_todos WHERE id = ?', [params.id]));
});
on('DELETE', '/api/job-todos/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  run('DELETE FROM job_todos WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- JOB PERMITS ----
on('GET', '/api/job-permits', async (req, res, params, query) => {
  if (!requireAuth(req, res)) return;
  if (!query || !query.job_id) return sendJson(res, 400, { error: 'job_id is required' });
  sendJson(res, 200, all('SELECT id, job_id, permit_number, file_name, file_type, uploaded_at FROM job_permits WHERE job_id = ? ORDER BY uploaded_at DESC', [query.job_id]));
});
on('POST', '/api/job-permits', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.job_id) return sendJson(res, 400, { error: 'job_id is required' });
  let fileBuffer = null;
  if (b.file_base64) { try { fileBuffer = Buffer.from(b.file_base64, 'base64'); } catch (e) { return sendJson(res, 400, { error: 'Invalid file data' }); } }
  const result = run('INSERT INTO job_permits (job_id, permit_number, file_name, file_type, file_data) VALUES (?, ?, ?, ?, ?)', [b.job_id, b.permit_number || null, b.file_name || null, b.file_type || null, fileBuffer]);
  if (b.permit_number) run('UPDATE jobs SET permit_number = ? WHERE id = ?', [b.permit_number, b.job_id]);
  sendJson(res, 201, get('SELECT id, job_id, permit_number, file_name, file_type, uploaded_at FROM job_permits WHERE id = ?', [result.lastInsertRowid]));
});
on('GET', '/api/job-permits/:id/file', async (req, res, params) => {
  if (!requireAuth(req, res)) return;
  const row = get('SELECT * FROM job_permits WHERE id = ?', [params.id]);
  if (!row || !row.file_data) return sendJson(res, 404, { error: 'File not found' });
  res.writeHead(200, { 'Content-Type': row.file_type || 'application/octet-stream', 'Content-Length': row.file_data.length, 'Content-Disposition': `inline; filename="${(row.file_name || 'permit').replace(/"/g, '')}"` });
  res.end(row.file_data);
});
on('DELETE', '/api/job-permits/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  run('DELETE FROM job_permits WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- CREWS ----
on('GET', '/api/crews', async (req, res, params, query) => {
  if (!requireAuth(req, res)) return;
  sendJson(res, 200, query && query.all === '1' ? all('SELECT * FROM crews ORDER BY name') : all('SELECT * FROM crews WHERE active = 1 ORDER BY name'));
});
on('POST', '/api/crews', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.name) return sendJson(res, 400, { error: 'Name is required' });
  const result = run('INSERT INTO crews (name) VALUES (?)', [b.name]);
  sendJson(res, 201, get('SELECT * FROM crews WHERE id = ?', [result.lastInsertRowid]));
});
on('PUT', '/api/crews/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM crews WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Crew not found' });
  const name = b.name !== undefined ? b.name : existing.name;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : existing.active;
  run('UPDATE crews SET name = ?, active = ? WHERE id = ?', [name, active, params.id]);
  sendJson(res, 200, get('SELECT * FROM crews WHERE id = ?', [params.id]));
});
on('DELETE', '/api/crews/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const inUse = get('SELECT COUNT(*) as c FROM jobs WHERE crew_id = ?', [params.id]).c;
  if (inUse > 0) return sendJson(res, 400, { error: `Can't delete — ${inUse} job(s) use this crew. Mark it inactive instead.` });
  run('DELETE FROM crews WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- EQUIPMENT ----
on('GET', '/api/equipment', async (req, res, params, query) => {
  if (!requireAuth(req, res)) return;
  sendJson(res, 200, query && query.all === '1' ? all('SELECT * FROM equipment ORDER BY name') : all('SELECT * FROM equipment WHERE active = 1 ORDER BY name'));
});
on('POST', '/api/equipment', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.name) return sendJson(res, 400, { error: 'Name is required' });
  const result = run('INSERT INTO equipment (name, type) VALUES (?, ?)', [b.name, b.type || null]);
  sendJson(res, 201, get('SELECT * FROM equipment WHERE id = ?', [result.lastInsertRowid]));
});
on('PUT', '/api/equipment/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM equipment WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Equipment not found' });
  const name = b.name !== undefined ? b.name : existing.name;
  const type = b.type !== undefined ? b.type : existing.type;
  const active = b.active !== undefined ? (b.active ? 1 : 0) : existing.active;
  run('UPDATE equipment SET name = ?, type = ?, active = ? WHERE id = ?', [name, type, active, params.id]);
  sendJson(res, 200, get('SELECT * FROM equipment WHERE id = ?', [params.id]));
});
on('DELETE', '/api/equipment/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const inUse = get('SELECT COUNT(*) as c FROM job_equipment WHERE equipment_id = ?', [params.id]).c;
  if (inUse > 0) return sendJson(res, 400, { error: `Can't delete — ${inUse} job assignment(s) use this equipment. Mark it inactive instead.` });
  run('DELETE FROM equipment WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- JOB <-> EQUIPMENT ASSIGNMENTS ----
on('GET', '/api/job-equipment', async (req, res, params, query) => {
  if (!requireAuth(req, res)) return;
  if (!query || !query.job_id) return sendJson(res, 400, { error: 'job_id is required' });
  sendJson(res, 200, all(`SELECT je.*, e.name as equipment_name FROM job_equipment je JOIN equipment e ON e.id = je.equipment_id WHERE je.job_id = ? ORDER BY je.start_date`, [query.job_id]));
});
on('POST', '/api/job-equipment', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.job_id || !b.equipment_id) return sendJson(res, 400, { error: 'job_id and equipment_id are required' });
  const result = run('INSERT INTO job_equipment (job_id, equipment_id, start_date, end_date) VALUES (?, ?, ?, ?)', [b.job_id, b.equipment_id, b.start_date || null, b.end_date || null]);
  sendJson(res, 201, get('SELECT je.*, e.name as equipment_name FROM job_equipment je JOIN equipment e ON e.id = je.equipment_id WHERE je.id = ?', [result.lastInsertRowid]));
});
on('DELETE', '/api/job-equipment/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  run('DELETE FROM job_equipment WHERE id = ?', [params.id]);
  sendJson(res, 200, { ok: true });
});

// ---- BULK CSV IMPORT ----
on('POST', '/api/jobs/import', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.csv) return sendJson(res, 400, { error: 'csv is required' });
  let rows;
  try { rows = csvToObjects(b.csv); } catch (e) { return sendJson(res, 400, { error: 'Could not parse that file as CSV' }); }
  if (!rows.length) return sendJson(res, 400, { error: 'No rows found in that file' });
  const errors = []; const crewsCreated = new Set(); let imported = 0;
  rows.forEach((row, idx) => {
    const lineNum = idx + 2;
    const customerName = row.customer_name || row.customer || row.client || row.client_name;
    if (!customerName) { errors.push({ row: lineNum, reason: 'Missing customer name — row skipped' }); return; }
    const scope = row.scope || row.scope_of_work || row.description || row.job_description || null;
    const price = parseMoneyLoose(row.price || row.job_price || row.amount || row.contract_price);
    const startRaw = row.target_start_date || row.start_date || row.date;
    const targetStart = parseFlexibleDate(startRaw);
    if (startRaw && !targetStart) errors.push({ row: lineNum, reason: `Couldn't read date "${startRaw}" (use YYYY-MM-DD or MM/DD/YYYY) — job imported without a start date` });
    const durationRaw = row.duration_days || row.duration || row.days;
    const durationDays = durationRaw ? (Number(String(durationRaw).replace(/[^0-9.]/g, '')) || null) : null;
    const crewName = row.crew || row.crew_name;
    let crewId = null;
    if (crewName) {
      const existingCrew = get('SELECT id FROM crews WHERE LOWER(name) = LOWER(?)', [crewName]);
      if (existingCrew) { crewId = existingCrew.id; } else { crewId = run('INSERT INTO crews (name) VALUES (?)', [crewName]).lastInsertRowid; crewsCreated.add(crewName); }
    }
    let status = (row.status || '').toLowerCase().trim().replace(/\s+/g, '_');
    if (!JOB_STATUSES.includes(status)) status = 'inquiry';
    const jobNumber = nextJobNumber();
    run(
      `INSERT INTO jobs (job_number, customer_name, customer_phone, site_address, scope, price, target_start_date, duration_days, crew_id, status, permit_number, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [jobNumber, customerName, row.customer_phone || row.phone || null, row.site_address || row.address || null, scope, price, targetStart, durationDays, crewId, status, row.permit_number || row.permit || null, row.notes || null]
    );
    imported += 1;
  });
  sendJson(res, 200, { imported, crewsCreated: [...crewsCreated], errors });
});

on('POST', '/api/orders/import', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.csv) return sendJson(res, 400, { error: 'csv is required' });
  let rows;
  try { rows = csvToObjects(b.csv); } catch (e) { return sendJson(res, 400, { error: 'Could not parse that file as CSV' }); }
  if (!rows.length) return sendJson(res, 400, { error: 'No rows found in that file' });
  const errors = []; const customersCreated = new Set(); const materialsCreated = new Set(); let imported = 0;
  rows.forEach((row, idx) => {
    const lineNum = idx + 2;
    const customerName = row.customer_name || row.customer || row.client || row.client_name;
    const materialName = row.material_name || row.material;
    const dateRaw = row.order_date || row.date || row.delivery_date;
    const orderDate = parseFlexibleDate(dateRaw);
    const quantity = parseMoneyLoose(row.quantity || row.qty);
    if (!customerName) { errors.push({ row: lineNum, reason: 'Missing customer name — row skipped' }); return; }
    if (!materialName) { errors.push({ row: lineNum, reason: 'Missing material name — row skipped' }); return; }
    if (!orderDate) { errors.push({ row: lineNum, reason: `Missing or unreadable date "${dateRaw || ''}" (use YYYY-MM-DD or MM/DD/YYYY) — row skipped` }); return; }
    if (!quantity) { errors.push({ row: lineNum, reason: 'Missing or invalid quantity — row skipped' }); return; }
    let customer = get('SELECT * FROM customers WHERE LOWER(name) = LOWER(?)', [customerName]);
    if (!customer) {
      const cid = run('INSERT INTO customers (name, phone) VALUES (?, ?)', [customerName, row.customer_phone || row.phone || null]).lastInsertRowid;
      customer = get('SELECT * FROM customers WHERE id = ?', [cid]);
      customersCreated.add(customerName);
    }
    const priceGiven = parseMoneyLoose(row.price_per_unit || row.unit_price || row.price);
    let material = get('SELECT * FROM materials WHERE LOWER(name) = LOWER(?)', [materialName]);
    if (!material) {
      const mid = run('INSERT INTO materials (name, unit, default_price) VALUES (?, ?, ?)', [materialName, row.unit || 'yard', priceGiven || 0]).lastInsertRowid;
      material = get('SELECT * FROM materials WHERE id = ?', [mid]);
      materialsCreated.add(materialName);
    }
    const pricePerUnit = priceGiven !== null ? priceGiven : material.default_price;
    const deliveryFee = parseMoneyLoose(row.delivery_fee) || 0;
    const taxRate = parseMoneyLoose(row.sales_tax_rate) || 0;
    const totals = computeOrderTotals(quantity, pricePerUnit, deliveryFee, taxRate);
    const totalOverride = parseMoneyLoose(row.total_amount || row.total);
    let driverId = null;
    const driverName = row.driver_name || row.driver;
    if (driverName) { const driver = get('SELECT id FROM drivers WHERE LOWER(name) = LOWER(?)', [driverName]); if (driver) driverId = driver.id; }
    let status = (row.status || 'delivered').toLowerCase().trim().replace(/\s+/g, '_');
    if (!['new', 'scheduled', 'out_for_delivery', 'delivered', 'invoiced', 'cancelled'].includes(status)) status = 'delivered';
    const orderNumber = row.order_number || nextOrderNumberForDate(new Date(`${orderDate}T00:00:00`));
    const createdAt = `${orderDate} 12:00:00`;
    const result = run(
      `INSERT INTO orders (order_number, customer_id, material_id, quantity, unit, price_per_unit, delivery_address, delivery_fee, sales_tax_rate, sales_tax_amount, total_amount, notes, status, driver_id, scheduled_date, delivered_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [orderNumber, customer.id, material.id, quantity, row.unit || material.unit, pricePerUnit, row.delivery_address || row.address || '(historical import — no address on file)', deliveryFee, totals.salesTaxRate, totals.salesTaxAmount, totalOverride !== null ? totalOverride : totals.totalAmount, row.notes || null, status, driverId, status !== 'new' ? orderDate : null, (status === 'delivered' || status === 'invoiced') ? createdAt : null, createdAt, createdAt]
    );
    let delStatus = 'unscheduled';
    if (status === 'cancelled') delStatus = 'cancelled';
    else if (status === 'delivered' || status === 'invoiced') delStatus = 'delivered';
    else if (status === 'out_for_delivery' || status === 'scheduled') delStatus = status === 'out_for_delivery' ? 'out_for_delivery' : 'scheduled';
    run(
      `INSERT INTO deliveries (order_id, sequence, quantity, driver_id, scheduled_date, slot_index, status, delivered_at) VALUES (?, 1, ?, ?, ?, ?, ?, ?)`,
      [result.lastInsertRowid, quantity, driverId, delStatus !== 'unscheduled' ? orderDate : null, (delStatus === 'scheduled' || delStatus === 'out_for_delivery') ? 0 : null, delStatus, delStatus === 'delivered' ? createdAt : null]
    );
    imported += 1;
  });
  sendJson(res, 200, { imported, customersCreated: [...customersCreated], materialsCreated: [...materialsCreated], errors });
});

// ---- FINANCIAL REPORTING ----
const JOB_WON_STATUSES = ['accepted', 'scheduled', 'deposit_received', 'in_progress', 'complete'];
function lastNMonthKeys(n) {
  const out = []; const d = new Date(); d.setDate(1);
  for (let i = 0; i < n; i++) { out.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() - 1); }
  return out;
}
on('GET', '/api/financial/summary', async (req, res, params, query) => {
  if (!requireOffice(req, res)) return;
  const months = Math.min(24, Math.max(1, Number((query && query.months) || 12)));
  const monthKeys = lastNMonthKeys(months);
  const materialsByMonth = all(`SELECT strftime('%Y-%m', created_at) as month, SUM(total_amount) as revenue FROM orders WHERE status != 'cancelled' GROUP BY month`);
  const jobsByMonth = all(`SELECT strftime('%Y-%m', COALESCE(target_start_date, created_at)) as month, SUM(price) as revenue FROM jobs WHERE status != 'cancelled' AND price IS NOT NULL GROUP BY month`);
  const materialsMap = {}; materialsByMonth.forEach((r) => { materialsMap[r.month] = r.revenue || 0; });
  const jobsMap = {}; jobsByMonth.forEach((r) => { jobsMap[r.month] = r.revenue || 0; });
  const monthlyRevenue = monthKeys.map((month) => {
    const materials = money(materialsMap[month] || 0); const jobs = money(jobsMap[month] || 0);
    return { month, materials, jobs, total: money(materials + jobs) };
  });
  const revenueByMaterial = all(`SELECT m.name as material_name, SUM(o.total_amount) as revenue FROM orders o JOIN materials m ON m.id = o.material_id WHERE o.status != 'cancelled' GROUP BY o.material_id ORDER BY revenue DESC`)
    .map((r) => ({ material_name: r.material_name, revenue: money(r.revenue || 0) })).filter((r) => r.revenue > 0);
  const custFromOrders = all(`SELECT c.name as customer_name, SUM(o.total_amount) as revenue, COUNT(*) as order_count FROM orders o JOIN customers c ON c.id = o.customer_id WHERE o.status != 'cancelled' GROUP BY o.customer_id`);
  const custFromJobs = all(`SELECT customer_name, SUM(price) as revenue, COUNT(*) as job_count FROM jobs WHERE status != 'cancelled' AND price IS NOT NULL GROUP BY LOWER(customer_name)`);
  const custMap = {};
  custFromOrders.forEach((r) => { const key = (r.customer_name || '').toLowerCase(); custMap[key] = custMap[key] || { customer_name: r.customer_name, revenue: 0, order_count: 0, job_count: 0 }; custMap[key].revenue += r.revenue || 0; custMap[key].order_count += r.order_count || 0; });
  custFromJobs.forEach((r) => { const key = (r.customer_name || '').toLowerCase(); custMap[key] = custMap[key] || { customer_name: r.customer_name, revenue: 0, order_count: 0, job_count: 0 }; custMap[key].revenue += r.revenue || 0; custMap[key].job_count += r.job_count || 0; });
  const topCustomers = Object.values(custMap).map((c) => ({ ...c, revenue: money(c.revenue) })).filter((c) => c.revenue > 0).sort((a, b) => b.revenue - a.revenue).slice(0, 10);
  const invoiceRows = all(`SELECT status, SUM(total) as total, SUM(amount_paid) as paid, COUNT(*) as c FROM invoices GROUP BY status`);
  let paidInvoicesTotal = 0; let outstandingInvoices = 0; let voidTotal = 0; let draftTotal = 0;
  invoiceRows.forEach((r) => {
    if (r.status === 'paid') paidInvoicesTotal += r.total || 0;
    else if (r.status === 'sent' || r.status === 'partial') outstandingInvoices += (r.total || 0) - (r.paid || 0);
    else if (r.status === 'void') voidTotal += r.total || 0;
    else if (r.status === 'draft') draftTotal += r.total || 0;
  });
  const overdueCount = get(`SELECT COUNT(*) as c FROM invoices WHERE status IN ('sent','partial') AND due_date IS NOT NULL AND due_date < ?`, [todayStr()]).c;
  const orderAgg = get(`SELECT SUM(total_amount) as total, COUNT(*) as c, AVG(total_amount) as avg FROM orders WHERE status != 'cancelled'`);
  const jobsWonAgg = get(`SELECT SUM(price) as total FROM jobs WHERE status IN (${JOB_WON_STATUSES.map(() => '?').join(',')}) AND price IS NOT NULL`, JOB_WON_STATUSES);
  const jobsPipelineAgg = get(`SELECT SUM(price) as total FROM jobs WHERE status NOT IN ('complete','cancelled') AND price IS NOT NULL`);
  const materialsRevenueAllTime = money(orderAgg.total || 0);
  const jobsRevenueWon = money(jobsWonAgg.total || 0);
  sendJson(res, 200, {
    monthlyRevenue, revenueByMaterial, topCustomers,
    invoices: { paidInvoicesTotal: money(paidInvoicesTotal), outstandingInvoices: money(outstandingInvoices), voidTotal: money(voidTotal), draftTotal: money(draftTotal), overdueCount },
    stats: { materialsRevenueAllTime, jobsRevenueWon, jobsPipelineValue: money(jobsPipelineAgg.total || 0), combinedRevenue: money(materialsRevenueAllTime + jobsRevenueWon), orderCount: orderAgg.c || 0, avgOrderValue: money(orderAgg.avg || 0) },
  });
});

// ---- PUBLIC PAY-BY-LINK ----
on('GET', '/api/pay/:token', async (req, res, params) => {
  const invoice = get(`SELECT i.*, c.name as customer_name, c.billing_address as customer_address FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.pay_token = ?`, [params.token]);
  if (!invoice) return sendJson(res, 404, { error: 'Invoice not found' });
  const items = all('SELECT * FROM invoice_items WHERE invoice_id = ?', [invoice.id]);
  sendJson(res, 200, { ...invoice, items });
});
on('POST', '/api/pay/:token/checkout', async (req, res, params) => {
  const invoice = get(`SELECT i.*, c.name as customer_name FROM invoices i JOIN customers c ON c.id = i.customer_id WHERE i.pay_token = ?`, [params.token]);
  if (!invoice) return sendJson(res, 404, { error: 'Invoice not found' });
  if (invoice.status === 'paid') return sendJson(res, 400, { error: 'Invoice already paid' });
  if (!stripeConfigured()) return sendJson(res, 400, { error: 'Online payment is not enabled yet. Please contact us to pay by another method.' });
  const baseUrl = `${req.headers['x-forwarded-proto'] || 'https'}://${req.headers.host}`;
  try {
    const session = await createCheckoutSession({ invoiceNumber: invoice.invoice_number, amountCents: Math.round((invoice.total - invoice.amount_paid) * 100), customerName: invoice.customer_name, description: `Invoice ${invoice.invoice_number}`, successUrl: `${baseUrl}/pay/${invoice.pay_token}?paid=1`, cancelUrl: `${baseUrl}/pay/${invoice.pay_token}`, invoiceId: invoice.id });
    run('UPDATE invoices SET stripe_checkout_url = ?, stripe_session_id = ? WHERE id = ?', [session.url, session.id, invoice.id]);
    sendJson(res, 200, { url: session.url });
  } catch (e) { sendJson(res, 500, { error: e.message }); }
});

// ---- STRIPE WEBHOOK ----
async function handleStripeWebhook(rawBody, signature) {
  if (!verifyWebhookSignature(rawBody, signature)) return { status: 400, body: { error: 'Invalid signature' } };
  const event = JSON.parse(rawBody);
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const invoiceId = session.metadata && session.metadata.invoice_id;
    if (invoiceId) {
      const invoice = get('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
      if (invoice && invoice.status !== 'paid') {
        const amount = money((session.amount_total || 0) / 100);
        run('INSERT INTO payments (invoice_id, amount, method, reference) VALUES (?, ?, ?, ?)', [invoiceId, amount, 'stripe', session.id]);
        const newPaid = money(invoice.amount_paid + amount);
        const fullyPaid = newPaid >= invoice.total - 0.005;
        run(`UPDATE invoices SET amount_paid = ?, status = ?, paid_date = ? WHERE id = ?`, [newPaid, fullyPaid ? 'paid' : 'partial', fullyPaid ? todayStr() : invoice.paid_date, invoiceId]);
      }
    }
  }
  return { status: 200, body: { received: true } };
}

// ---------------------------------------------------------------------------
// Static frontend files (embedded — no filesystem reads needed)
// ---------------------------------------------------------------------------
const STATIC_FILES = {
  "admin.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Admin — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <h1>Admin</h1>\n  <p class=\"subtitle\">Manage materials, prices, drivers, the shop address, and delivery mileage pricing. Need to bring in a year's worth of jobs or historical sales? <a href=\"/import.html\">Import from CSV &rarr;</a></p>\n\n  <div class=\"panel\">\n    <h2>Shop Address (delivery estimator origin)</h2>\n    <div class=\"field-row\">\n      <div class=\"field\" style=\"flex:2;\">\n        <label>Shop Address</label>\n        <input id=\"shop_address\">\n      </div>\n      <div class=\"field\" style=\"flex:none; align-self:flex-end;\">\n        <button type=\"button\" id=\"save-shop-address\" style=\"margin-bottom:14px;\">Save</button>\n      </div>\n    </div>\n    <div id=\"shop-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Sales Tax</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:14px;\">Applied automatically to new orders — materials only, never the delivery fee.</p>\n    <div class=\"field-row\">\n      <div class=\"field\" style=\"flex:none; width:160px;\">\n        <label>Sales Tax Rate (%)</label>\n        <input type=\"number\" step=\"0.01\" min=\"0\" id=\"sales_tax_rate\">\n      </div>\n      <div class=\"field\" style=\"flex:none; align-self:flex-end;\">\n        <button type=\"button\" id=\"save-sales-tax\" style=\"margin-bottom:14px;\">Save</button>\n      </div>\n    </div>\n    <div id=\"tax-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Delivery Mileage Bands</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:14px;\">Miles are driving distance from the shop. Leave \"Max Miles\" blank for an open-ended top tier, and leave \"Fee\" blank if that range should require a manual quote instead of an auto-price.</p>\n    <div class=\"table-wrap\">\n      <table>\n        <thead><tr><th>Min Miles</th><th>Max Miles</th><th>Fee</th><th>Label</th><th></th></tr></thead>\n        <tbody id=\"bands-tbody\"></tbody>\n      </table>\n    </div>\n    <h2 style=\"margin-top:18px;\">Add Band</h2>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Min Miles</label><input type=\"number\" step=\"0.1\" id=\"nb_min\"></div>\n      <div class=\"field\"><label>Max Miles</label><input type=\"number\" step=\"0.1\" id=\"nb_max\" placeholder=\"blank = no limit\"></div>\n      <div class=\"field\"><label>Fee ($)</label><input type=\"number\" step=\"0.01\" id=\"nb_fee\" placeholder=\"blank = quote\"></div>\n      <div class=\"field\"><label>Label</label><input id=\"nb_label\" placeholder=\"e.g. 0–5 miles\"></div>\n    </div>\n    <button type=\"button\" id=\"add-band\">Add Band</button>\n    <div id=\"band-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>SMS Order Alerts</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:14px;\">Everyone active on this list gets a text the moment a new order is entered.</p>\n    <div id=\"sms-status\" style=\"margin-bottom:14px;\"></div>\n    <div class=\"table-wrap\">\n      <table>\n        <thead><tr><th>Name</th><th>Phone</th><th>Carrier</th><th>Active</th><th></th></tr></thead>\n        <tbody id=\"sms-tbody\"></tbody>\n      </table>\n    </div>\n    <h2 style=\"margin-top:18px;\">Add Recipient</h2>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Name</label><input id=\"ns_name\"></div>\n      <div class=\"field\"><label>Phone</label><input id=\"ns_phone\" placeholder=\"4015551234\"></div>\n      <div class=\"field\">\n        <label>Carrier</label>\n        <select id=\"ns_carrier\">\n          <option value=\"verizon\">Verizon</option>\n          <option value=\"att\">AT&amp;T</option>\n          <option value=\"tmobile\">T-Mobile</option>\n          <option value=\"sprint\">Sprint (legacy)</option>\n          <option value=\"uscellular\">US Cellular</option>\n          <option value=\"boost\">Boost Mobile</option>\n          <option value=\"cricket\">Cricket</option>\n          <option value=\"metro\">Metro by T-Mobile</option>\n          <option value=\"googlefi\">Google Fi</option>\n          <option value=\"visible\">Visible</option>\n          <option value=\"mint\">Mint Mobile</option>\n          <option value=\"straighttalk\">Straight Talk</option>\n          <option value=\"other\">Other (custom domain)</option>\n        </select>\n      </div>\n      <div class=\"field\"><label>Custom Domain (if \"Other\")</label><input id=\"ns_custom_domain\" placeholder=\"e.g. gateway.example.com\"></div>\n    </div>\n    <button type=\"button\" id=\"add-sms\">Add Recipient</button>\n    <div id=\"sms-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Materials</h2>\n    <div class=\"table-wrap\">\n      <table>\n        <thead><tr><th>Name</th><th>Unit</th><th>Price</th><th>Active</th><th></th></tr></thead>\n        <tbody id=\"materials-tbody\"></tbody>\n      </table>\n    </div>\n    <h2 style=\"margin-top:18px;\">Add Material</h2>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Name</label><input id=\"nm_name\"></div>\n      <div class=\"field\"><label>Unit</label><input id=\"nm_unit\" placeholder=\"yard, ton, load…\" value=\"yard\"></div>\n      <div class=\"field\"><label>Price ($)</label><input type=\"number\" step=\"0.01\" id=\"nm_price\"></div>\n    </div>\n    <button type=\"button\" id=\"add-material\">Add Material</button>\n    <div id=\"material-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Drivers</h2>\n    <div class=\"table-wrap\">\n      <table>\n        <thead><tr><th>Name</th><th>Phone</th><th>Truck</th><th>PIN</th><th>Active</th><th></th></tr></thead>\n        <tbody id=\"drivers-tbody\"></tbody>\n      </table>\n    </div>\n    <h2 style=\"margin-top:18px;\">Add Driver</h2>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Name</label><input id=\"nd_name\"></div>\n      <div class=\"field\"><label>Phone</label><input id=\"nd_phone\"></div>\n      <div class=\"field\"><label>Truck</label><input id=\"nd_truck\"></div>\n      <div class=\"field\"><label>PIN</label><input id=\"nd_pin\" placeholder=\"4 digits\"></div>\n    </div>\n    <button type=\"button\" id=\"add-driver\">Add Driver</button>\n    <div id=\"driver-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Crews</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:14px;\">Work crews you can assign construction jobs to.</p>\n    <div class=\"table-wrap\">\n      <table>\n        <thead><tr><th>Name</th><th>Active</th><th></th></tr></thead>\n        <tbody id=\"crews-tbody\"></tbody>\n      </table>\n    </div>\n    <h2 style=\"margin-top:18px;\">Add Crew</h2>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Name</label><input id=\"nc_name\" placeholder=\"e.g. Crew 1 — Dave\"></div>\n    </div>\n    <button type=\"button\" id=\"add-crew\">Add Crew</button>\n    <div id=\"crew-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Equipment</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:14px;\">Excavators, skid steers, and other equipment you assign to jobs.</p>\n    <div class=\"table-wrap\">\n      <table>\n        <thead><tr><th>Name</th><th>Type</th><th>Active</th><th></th></tr></thead>\n        <tbody id=\"equipment-tbody\"></tbody>\n      </table>\n    </div>\n    <h2 style=\"margin-top:18px;\">Add Equipment</h2>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Name</label><input id=\"ne_name\" placeholder=\"e.g. Excavator 1\"></div>\n      <div class=\"field\"><label>Type</label><input id=\"ne_type\" placeholder=\"e.g. excavator, skid steer…\"></div>\n    </div>\n    <button type=\"button\" id=\"add-equipment\">Add Equipment</button>\n    <div id=\"equipment-msg\"></div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  // ---- Shop address ----\n  async function loadSettings() {\n    const settings = await api('/api/settings');\n    document.getElementById('shop_address').value = settings.shop_address || '';\n    document.getElementById('sales_tax_rate').value = settings.sales_tax_rate !== undefined && settings.sales_tax_rate !== '' ? settings.sales_tax_rate : 7;\n  }\n  document.getElementById('save-shop-address').addEventListener('click', async () => {\n    const msg = document.getElementById('shop-msg');\n    try {\n      await api('/api/settings', { method: 'PUT', body: { shop_address: document.getElementById('shop_address').value } });\n      msg.innerHTML = '<div class=\"ok-msg\">Saved. Next delivery estimate will re-locate the shop.</div>';\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n  document.getElementById('save-sales-tax').addEventListener('click', async () => {\n    const msg = document.getElementById('tax-msg');\n    try {\n      await api('/api/settings', { method: 'PUT', body: { sales_tax_rate: document.getElementById('sales_tax_rate').value } });\n      msg.innerHTML = '<div class=\"ok-msg\">Saved. Applies to new orders going forward.</div>';\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  // ---- Mileage bands ----\n  async function loadBands() {\n    const bands = await api('/api/mileage-bands');\n    document.getElementById('bands-tbody').innerHTML = bands.map(b => `\n      <tr data-id=\"${b.id}\">\n        <td><input type=\"number\" step=\"0.1\" class=\"b-min\" value=\"${b.min_miles}\" style=\"width:80px;\"></td>\n        <td><input type=\"number\" step=\"0.1\" class=\"b-max\" value=\"${b.max_miles ?? ''}\" style=\"width:80px;\" placeholder=\"no limit\"></td>\n        <td><input type=\"number\" step=\"0.01\" class=\"b-fee\" value=\"${b.fee ?? ''}\" style=\"width:90px;\" placeholder=\"quote\"></td>\n        <td><input class=\"b-label\" value=\"${escapeHtml(b.label || '')}\" style=\"width:160px;\"></td>\n        <td style=\"white-space:nowrap;\">\n          <button type=\"button\" class=\"btn secondary small b-save\">Save</button>\n          <button type=\"button\" class=\"btn secondary small b-delete\">Delete</button>\n        </td>\n      </tr>\n    `).join('') || '<tr><td colspan=\"5\" class=\"empty\">No mileage bands yet.</td></tr>';\n\n    document.querySelectorAll('#bands-tbody tr[data-id]').forEach(tr => {\n      const id = tr.dataset.id;\n      tr.querySelector('.b-save')?.addEventListener('click', async () => {\n        try {\n          await api(`/api/mileage-bands/${id}`, { method: 'PUT', body: {\n            min_miles: tr.querySelector('.b-min').value,\n            max_miles: tr.querySelector('.b-max').value,\n            fee: tr.querySelector('.b-fee').value,\n            label: tr.querySelector('.b-label').value,\n          }});\n          document.getElementById('band-msg').innerHTML = '<div class=\"ok-msg\">Band updated.</div>';\n        } catch (err) {\n          document.getElementById('band-msg').innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n        }\n      });\n      tr.querySelector('.b-delete')?.addEventListener('click', async () => {\n        if (!confirm('Delete this mileage band?')) return;\n        await api(`/api/mileage-bands/${id}`, { method: 'DELETE' });\n        loadBands();\n      });\n    });\n  }\n  document.getElementById('add-band').addEventListener('click', async () => {\n    const msg = document.getElementById('band-msg');\n    try {\n      const min = document.getElementById('nb_min').value;\n      if (min === '') { msg.innerHTML = '<div class=\"error-msg\">Min miles is required.</div>'; return; }\n      await api('/api/mileage-bands', { method: 'POST', body: {\n        min_miles: min,\n        max_miles: document.getElementById('nb_max').value,\n        fee: document.getElementById('nb_fee').value,\n        label: document.getElementById('nb_label').value,\n      }});\n      document.getElementById('nb_min').value = '';\n      document.getElementById('nb_max').value = '';\n      document.getElementById('nb_fee').value = '';\n      document.getElementById('nb_label').value = '';\n      msg.innerHTML = '<div class=\"ok-msg\">Band added.</div>';\n      loadBands();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  // ---- SMS order alerts ----\n  const CARRIER_LABELS = { verizon: 'Verizon', att: 'AT&T', tmobile: 'T-Mobile', sprint: 'Sprint', uscellular: 'US Cellular',\n    boost: 'Boost', cricket: 'Cricket', metro: 'Metro', googlefi: 'Google Fi', visible: 'Visible', mint: 'Mint', straighttalk: 'Straight Talk', other: 'Other' };\n  const CARRIER_OPTIONS = Object.entries(CARRIER_LABELS).map(([v, l]) => `<option value=\"${v}\">${l}</option>`).join('');\n\n  async function loadSmsStatus() {\n    const status = await api('/api/sms-status');\n    if (!status.configured) {\n      document.getElementById('sms-status').innerHTML = '<span class=\"error-msg\">No SMS channel is connected yet. Add CLICKSEND_USERNAME / CLICKSEND_API_KEY (ClickSend) or TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER (Twilio) as variables on the Railway service. (Email-to-text is no longer an option — carriers shut those gateways down in 2025.)</span>';\n    } else if (status.channel === 'clicksend') {\n      document.getElementById('sms-status').innerHTML = '<span class=\"ok-msg\">ClickSend is connected — alerts will send.</span>';\n    } else if (status.channel === 'twilio') {\n      document.getElementById('sms-status').innerHTML = '<span class=\"ok-msg\">Twilio is connected — alerts will send.</span>';\n    } else {\n      document.getElementById('sms-status').innerHTML = '<span class=\"ok-msg\">Email-to-text is connected — alerts will send.</span>';\n    }\n  }\n  async function loadSmsRecipients() {\n    const recipients = await api('/api/sms-recipients');\n    document.getElementById('sms-tbody').innerHTML = recipients.map(r => `\n      <tr data-id=\"${r.id}\">\n        <td><input class=\"s-name\" value=\"${escapeHtml(r.name)}\" style=\"width:140px;\"></td>\n        <td><input class=\"s-phone\" value=\"${escapeHtml(r.phone)}\" style=\"width:130px;\"></td>\n        <td>\n          <select class=\"s-carrier\" style=\"width:120px;\">${CARRIER_OPTIONS}</select>\n          <input class=\"s-custom-domain\" placeholder=\"custom domain\" value=\"${escapeHtml(r.custom_gateway_domain || '')}\" style=\"width:130px; margin-top:4px; display:${r.carrier === 'other' ? 'block' : 'none'};\">\n        </td>\n        <td><input type=\"checkbox\" class=\"s-active\" ${r.active ? 'checked' : ''}></td>\n        <td style=\"white-space:nowrap;\">\n          <button type=\"button\" class=\"btn secondary small s-save\">Save</button>\n          <button type=\"button\" class=\"btn secondary small s-test\">Test</button>\n          <button type=\"button\" class=\"btn secondary small s-delete\">Delete</button>\n        </td>\n      </tr>\n    `).join('') || '<tr><td colspan=\"5\" class=\"empty\">No recipients yet.</td></tr>';\n\n    document.querySelectorAll('#sms-tbody tr[data-id]').forEach(tr => {\n      const id = tr.dataset.id;\n      const carrierSelect = tr.querySelector('.s-carrier');\n      const recipient = recipients.find(r => String(r.id) === id);\n      carrierSelect.value = recipient.carrier || 'verizon';\n      carrierSelect.addEventListener('change', () => {\n        tr.querySelector('.s-custom-domain').style.display = carrierSelect.value === 'other' ? 'block' : 'none';\n      });\n      tr.querySelector('.s-save').addEventListener('click', async () => {\n        try {\n          await api(`/api/sms-recipients/${id}`, { method: 'PUT', body: {\n            name: tr.querySelector('.s-name').value,\n            phone: tr.querySelector('.s-phone').value,\n            carrier: carrierSelect.value,\n            custom_gateway_domain: tr.querySelector('.s-custom-domain').value || null,\n            active: tr.querySelector('.s-active').checked,\n          }});\n          document.getElementById('sms-msg').innerHTML = '<div class=\"ok-msg\">Recipient updated.</div>';\n        } catch (err) {\n          document.getElementById('sms-msg').innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n        }\n      });\n      tr.querySelector('.s-test').addEventListener('click', async () => {\n        const msg = document.getElementById('sms-msg');\n        msg.innerHTML = '<span style=\"color:var(--ink-soft);\">Sending test…</span>';\n        try {\n          await api(`/api/sms-recipients/${id}/test`, { method: 'POST' });\n          msg.innerHTML = '<div class=\"ok-msg\">Test sent — check the phone in a minute or two.</div>';\n        } catch (err) {\n          msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n        }\n      });\n      tr.querySelector('.s-delete').addEventListener('click', async () => {\n        if (!confirm('Remove this recipient?')) return;\n        await api(`/api/sms-recipients/${id}`, { method: 'DELETE' });\n        loadSmsRecipients();\n      });\n    });\n  }\n  document.getElementById('ns_carrier').innerHTML = CARRIER_OPTIONS;\n  document.getElementById('ns_carrier').addEventListener('change', (e) => {\n    document.getElementById('ns_custom_domain').style.display = e.target.value === 'other' ? 'block' : 'none';\n  });\n  document.getElementById('ns_custom_domain').style.display = 'none';\n  document.getElementById('add-sms').addEventListener('click', async () => {\n    const msg = document.getElementById('sms-msg');\n    try {\n      const name = document.getElementById('ns_name').value.trim();\n      const phone = document.getElementById('ns_phone').value.trim();\n      if (!name || !phone) { msg.innerHTML = '<div class=\"error-msg\">Name and phone are required.</div>'; return; }\n      await api('/api/sms-recipients', { method: 'POST', body: {\n        name, phone,\n        carrier: document.getElementById('ns_carrier').value,\n        custom_gateway_domain: document.getElementById('ns_custom_domain').value || null,\n      }});\n      document.getElementById('ns_name').value = '';\n      document.getElementById('ns_phone').value = '';\n      msg.innerHTML = '<div class=\"ok-msg\">Recipient added.</div>';\n      loadSmsRecipients();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  // ---- Materials ----\n  async function loadMaterials() {\n    const materials = await api('/api/materials?all=1');\n    document.getElementById('materials-tbody').innerHTML = materials.map(m => `\n      <tr data-id=\"${m.id}\">\n        <td><input class=\"m-name\" value=\"${escapeHtml(m.name)}\" style=\"width:200px;\"></td>\n        <td><input class=\"m-unit\" value=\"${escapeHtml(m.unit)}\" style=\"width:80px;\"></td>\n        <td><input type=\"number\" step=\"0.01\" class=\"m-price\" value=\"${m.default_price}\" style=\"width:90px;\"></td>\n        <td><input type=\"checkbox\" class=\"m-active\" ${m.active ? 'checked' : ''}></td>\n        <td style=\"white-space:nowrap;\">\n          <button type=\"button\" class=\"btn secondary small m-save\">Save</button>\n          <button type=\"button\" class=\"btn secondary small m-delete\">Delete</button>\n        </td>\n      </tr>\n    `).join('') || '<tr><td colspan=\"5\" class=\"empty\">No materials yet.</td></tr>';\n\n    document.querySelectorAll('#materials-tbody tr[data-id]').forEach(tr => {\n      const id = tr.dataset.id;\n      tr.querySelector('.m-save').addEventListener('click', async () => {\n        try {\n          await api(`/api/materials/${id}`, { method: 'PUT', body: {\n            name: tr.querySelector('.m-name').value,\n            unit: tr.querySelector('.m-unit').value,\n            default_price: tr.querySelector('.m-price').value,\n            active: tr.querySelector('.m-active').checked,\n          }});\n          document.getElementById('material-msg').innerHTML = '<div class=\"ok-msg\">Material updated.</div>';\n        } catch (err) {\n          document.getElementById('material-msg').innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n        }\n      });\n      tr.querySelector('.m-delete').addEventListener('click', async () => {\n        if (!confirm('Delete this material?')) return;\n        try {\n          await api(`/api/materials/${id}`, { method: 'DELETE' });\n          loadMaterials();\n        } catch (err) {\n          document.getElementById('material-msg').innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n        }\n      });\n    });\n  }\n  document.getElementById('add-material').addEventListener('click', async () => {\n    const msg = document.getElementById('material-msg');\n    try {\n      const name = document.getElementById('nm_name').value.trim();\n      if (!name) { msg.innerHTML = '<div class=\"error-msg\">Name is required.</div>'; return; }\n      await api('/api/materials', { method: 'POST', body: {\n        name, unit: document.getElementById('nm_unit').value || 'yard', default_price: document.getElementById('nm_price').value,\n      }});\n      document.getElementById('nm_name').value = '';\n      document.getElementById('nm_price').value = '';\n      msg.innerHTML = '<div class=\"ok-msg\">Material added.</div>';\n      loadMaterials();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  // ---- Drivers ----\n  async function loadDrivers() {\n    const drivers = await api('/api/drivers');\n    document.getElementById('drivers-tbody').innerHTML = drivers.map(d => `\n      <tr data-id=\"${d.id}\">\n        <td><input class=\"d-name\" value=\"${escapeHtml(d.name)}\" style=\"width:160px;\"></td>\n        <td><input class=\"d-phone\" value=\"${escapeHtml(d.phone || '')}\" style=\"width:120px;\"></td>\n        <td><input class=\"d-truck\" value=\"${escapeHtml(d.truck_label || '')}\" style=\"width:180px;\"></td>\n        <td><input class=\"d-pin\" value=\"${escapeHtml(d.pin || '')}\" style=\"width:70px;\"></td>\n        <td><input type=\"checkbox\" class=\"d-active\" ${d.active ? 'checked' : ''}></td>\n        <td style=\"white-space:nowrap;\">\n          <button type=\"button\" class=\"btn secondary small d-save\">Save</button>\n          <button type=\"button\" class=\"btn secondary small d-delete\">Delete</button>\n        </td>\n      </tr>\n    `).join('') || '<tr><td colspan=\"6\" class=\"empty\">No drivers yet.</td></tr>';\n\n    document.querySelectorAll('#drivers-tbody tr[data-id]').forEach(tr => {\n      const id = tr.dataset.id;\n      tr.querySelector('.d-save').addEventListener('click', async () => {\n        try {\n          await api(`/api/drivers/${id}`, { method: 'PUT', body: {\n            name: tr.querySelector('.d-name').value,\n            phone: tr.querySelector('.d-phone').value,\n            truck_label: tr.querySelector('.d-truck').value,\n            pin: tr.querySelector('.d-pin').value,\n            active: tr.querySelector('.d-active').checked,\n          }});\n          document.getElementById('driver-msg').innerHTML = '<div class=\"ok-msg\">Driver updated.</div>';\n        } catch (err) {\n          document.getElementById('driver-msg').innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n        }\n      });\n      tr.querySelector('.d-delete').addEventListener('click', async () => {\n        if (!confirm('Delete this driver?')) return;\n        try {\n          await api(`/api/drivers/${id}`, { method: 'DELETE' });\n          loadDrivers();\n        } catch (err) {\n          document.getElementById('driver-msg').innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n        }\n      });\n    });\n  }\n  document.getElementById('add-driver').addEventListener('click', async () => {\n    const msg = document.getElementById('driver-msg');\n    try {\n      const name = document.getElementById('nd_name').value.trim();\n      const pin = document.getElementById('nd_pin').value.trim();\n      if (!name || !pin) { msg.innerHTML = '<div class=\"error-msg\">Name and PIN are required.</div>'; return; }\n      await api('/api/drivers', { method: 'POST', body: {\n        name, phone: document.getElementById('nd_phone').value, truck_label: document.getElementById('nd_truck').value, pin,\n      }});\n      document.getElementById('nd_name').value = '';\n      document.getElementById('nd_phone').value = '';\n      document.getElementById('nd_truck').value = '';\n      document.getElementById('nd_pin').value = '';\n      msg.innerHTML = '<div class=\"ok-msg\">Driver added.</div>';\n      loadDrivers();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  // ---- Crews ----\n  async function loadCrews() {\n    const crews = await api('/api/crews?all=1');\n    document.getElementById('crews-tbody').innerHTML = crews.map(c => `\n      <tr data-id=\"${c.id}\">\n        <td><input class=\"c-name\" value=\"${escapeHtml(c.name)}\" style=\"width:200px;\"></td>\n        <td><input type=\"checkbox\" class=\"c-active\" ${c.active ? 'checked' : ''}></td>\n        <td style=\"white-space:nowrap;\">\n          <button type=\"button\" class=\"btn secondary small c-save\">Save</button>\n          <button type=\"button\" class=\"btn secondary small c-delete\">Delete</button>\n        </td>\n      </tr>\n    `).join('') || '<tr><td colspan=\"3\" class=\"empty\">No crews yet.</td></tr>';\n\n    document.querySelectorAll('#crews-tbody tr[data-id]').forEach(tr => {\n      const id = tr.dataset.id;\n      tr.querySelector('.c-save').addEventListener('click', async () => {\n        try {\n          await api(`/api/crews/${id}`, { method: 'PUT', body: {\n            name: tr.querySelector('.c-name').value,\n            active: tr.querySelector('.c-active').checked,\n          }});\n          document.getElementById('crew-msg').innerHTML = '<div class=\"ok-msg\">Crew updated.</div>';\n        } catch (err) {\n          document.getElementById('crew-msg').innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n        }\n      });\n      tr.querySelector('.c-delete').addEventListener('click', async () => {\n        if (!confirm('Delete this crew?')) return;\n        try {\n          await api(`/api/crews/${id}`, { method: 'DELETE' });\n          loadCrews();\n        } catch (err) {\n          document.getElementById('crew-msg').innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n        }\n      });\n    });\n  }\n  document.getElementById('add-crew').addEventListener('click', async () => {\n    const msg = document.getElementById('crew-msg');\n    try {\n      const name = document.getElementById('nc_name').value.trim();\n      if (!name) { msg.innerHTML = '<div class=\"error-msg\">Name is required.</div>'; return; }\n      await api('/api/crews', { method: 'POST', body: { name } });\n      document.getElementById('nc_name').value = '';\n      msg.innerHTML = '<div class=\"ok-msg\">Crew added.</div>';\n      loadCrews();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  // ---- Equipment ----\n  async function loadEquipment() {\n    const equipment = await api('/api/equipment?all=1');\n    document.getElementById('equipment-tbody').innerHTML = equipment.map(e => `\n      <tr data-id=\"${e.id}\">\n        <td><input class=\"e-name\" value=\"${escapeHtml(e.name)}\" style=\"width:180px;\"></td>\n        <td><input class=\"e-type\" value=\"${escapeHtml(e.type || '')}\" style=\"width:140px;\"></td>\n        <td><input type=\"checkbox\" class=\"e-active\" ${e.active ? 'checked' : ''}></td>\n        <td style=\"white-space:nowrap;\">\n          <button type=\"button\" class=\"btn secondary small e-save\">Save</button>\n          <button type=\"button\" class=\"btn secondary small e-delete\">Delete</button>\n        </td>\n      </tr>\n    `).join('') || '<tr><td colspan=\"4\" class=\"empty\">No equipment yet.</td></tr>';\n\n    document.querySelectorAll('#equipment-tbody tr[data-id]').forEach(tr => {\n      const id = tr.dataset.id;\n      tr.querySelector('.e-save').addEventListener('click', async () => {\n        try {\n          await api(`/api/equipment/${id}`, { method: 'PUT', body: {\n            name: tr.querySelector('.e-name').value,\n            type: tr.querySelector('.e-type').value,\n            active: tr.querySelector('.e-active').checked,\n          }});\n          document.getElementById('equipment-msg').innerHTML = '<div class=\"ok-msg\">Equipment updated.</div>';\n        } catch (err) {\n          document.getElementById('equipment-msg').innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n        }\n      });\n      tr.querySelector('.e-delete').addEventListener('click', async () => {\n        if (!confirm('Delete this equipment?')) return;\n        try {\n          await api(`/api/equipment/${id}`, { method: 'DELETE' });\n          loadEquipment();\n        } catch (err) {\n          document.getElementById('equipment-msg').innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n        }\n      });\n    });\n  }\n  document.getElementById('add-equipment').addEventListener('click', async () => {\n    const msg = document.getElementById('equipment-msg');\n    try {\n      const name = document.getElementById('ne_name').value.trim();\n      if (!name) { msg.innerHTML = '<div class=\"error-msg\">Name is required.</div>'; return; }\n      await api('/api/equipment', { method: 'POST', body: { name, type: document.getElementById('ne_type').value } });\n      document.getElementById('ne_name').value = '';\n      document.getElementById('ne_type').value = '';\n      msg.innerHTML = '<div class=\"ok-msg\">Equipment added.</div>';\n      loadEquipment();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  loadSettings();\n  loadBands();\n  loadMaterials();\n  loadDrivers();\n  loadCrews();\n  loadEquipment();\n  loadSmsStatus();\n  loadSmsRecipients();\n})();\n</script>\n</body>\n</html>\n"
  },
  "css/style.css": {
    "encoding": "utf8",
    "content": ":root {\n  --bg: #eef3f9;\n  --panel: #ffffff;\n  --panel-raised: #eaf2fb;\n  --ink: #14212e;\n  --ink-soft: #57697d;\n  --line: #d7e2ee;\n  --brand: #146a94;\n  --brand-light: #1c8ccc;\n  --brand-dark: #0d4a68;\n  --brand-soft: rgba(28, 140, 204, 0.13);\n  --amber: #9a4a07;\n  --amber-soft: rgba(154, 74, 7, 0.13);\n  --red: #b91c1c;\n  --red-soft: rgba(185, 28, 28, 0.12);\n  --green: #15803d;\n  --green-soft: rgba(21, 128, 61, 0.12);\n  --purple: #6d28d9;\n  --purple-soft: rgba(109, 40, 217, 0.12);\n  --radius: 10px;\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n}\n\n* { box-sizing: border-box; }\n\nbody {\n  margin: 0;\n  background: var(--bg);\n  color: var(--ink);\n  font-family: inherit;\n  font-size: 15px;\n  line-height: 1.45;\n}\n\na { color: var(--brand); }\na:hover { color: var(--brand-dark); text-decoration: underline; }\n\n.topbar {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  background: var(--panel);\n  border-bottom: 2px solid var(--brand-light);\n  padding: 10px 20px;\n  position: sticky;\n  top: 0;\n  z-index: 10;\n  flex-wrap: wrap;\n  row-gap: 8px;\n  box-shadow: 0 2px 10px rgba(20, 33, 46, 0.08);\n}\n\n.topbar .brand {\n  font-weight: 700;\n  font-size: 16px;\n  letter-spacing: .02em;\n  color: var(--ink);\n  text-decoration: none;\n  display: flex;\n  align-items: center;\n  gap: 10px;\n  text-transform: uppercase;\n  white-space: nowrap;\n}\n\n.topbar .brand img {\n  height: 34px;\n  width: 34px;\n  display: block;\n  border-radius: 50%;\n  flex: none;\n}\n\n@media (max-width: 720px) {\n  .topbar { padding: 10px 14px; }\n  .topbar .brand { font-size: 13px; gap: 8px; }\n  .topbar .brand img { height: 28px; width: 28px; }\n  .topbar nav {\n    order: 3;\n    width: 100%;\n    flex-wrap: nowrap;\n    overflow-x: auto;\n    -webkit-overflow-scrolling: touch;\n    gap: 2px;\n    padding-bottom: 2px;\n  }\n  .topbar nav a { white-space: nowrap; padding: 7px 10px; font-size: 13px; }\n  .topbar .who { font-size: 12px; gap: 6px; }\n}\n\n.topbar nav { display: flex; gap: 4px; flex-wrap: wrap; }\n\n.topbar nav a {\n  text-decoration: none;\n  color: var(--ink-soft);\n  padding: 8px 12px;\n  border-radius: 8px;\n  font-size: 14px;\n  font-weight: 500;\n  transition: background .12s ease, color .12s ease;\n}\n\n.topbar nav a.active, .topbar nav a:hover { background: var(--brand-soft); color: var(--brand); }\n\n.topbar .who { font-size: 13px; color: var(--ink-soft); display: flex; align-items: center; gap: 10px; }\n\n.container {\n  max-width: 1100px;\n  margin: 0 auto;\n  padding: 24px 20px 60px;\n}\n\n.container.narrow { max-width: 640px; }\n\nh1 { font-size: 22px; margin: 0 0 4px; color: var(--ink); }\nh2 { font-size: 17px; margin: 0 0 12px; color: var(--ink); }\n.subtitle { color: var(--ink-soft); margin: 0 0 24px; font-size: 14px; }\n\n.panel {\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  padding: 18px 20px;\n  margin-bottom: 18px;\n  box-shadow: 0 1px 2px rgba(20, 33, 46, 0.05), 0 8px 24px -14px rgba(20, 33, 46, 0.14);\n}\n\n.grid { display: grid; gap: 16px; }\n.grid.cols-2 { grid-template-columns: 1fr 1fr; }\n.grid.cols-3 { grid-template-columns: repeat(3, 1fr); }\n.grid.cols-4 { grid-template-columns: repeat(4, 1fr); }\n@media (max-width: 760px) {\n  .grid.cols-2, .grid.cols-3, .grid.cols-4 { grid-template-columns: 1fr; }\n}\n\n.stat {\n  background: linear-gradient(180deg, var(--panel-raised) 0%, var(--panel) 60%);\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  padding: 16px 18px;\n  border-top: 2px solid var(--brand-light);\n  box-shadow: 0 1px 2px rgba(20, 33, 46, 0.05), 0 8px 24px -14px rgba(20, 33, 46, 0.14);\n  display: block;\n  text-decoration: none;\n  transition: transform .15s ease, box-shadow .15s ease, border-color .15s ease;\n}\n.stat .label { font-size: 12px; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .04em; }\n.stat .value { font-size: 26px; font-weight: 700; margin-top: 4px; color: var(--ink); }\n.stat.clickable { cursor: pointer; }\n.stat.clickable:hover {\n  transform: translateY(-2px);\n  border-color: var(--brand-light);\n  box-shadow: 0 4px 12px rgba(20, 33, 46, 0.10), 0 16px 32px -14px rgba(28, 140, 204, 0.4);\n}\n\ntable { width: 100%; border-collapse: collapse; font-size: 14px; }\nth, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }\nth { color: var(--ink-soft); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }\ntr:last-child td { border-bottom: none; }\ntr:hover td { background: rgba(20, 33, 46, 0.03); }\ntr.row-link { cursor: pointer; }\ntr.row-link:hover td { background: var(--brand-soft); }\n.table-wrap { overflow-x: auto; }\n\nlabel { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; color: var(--ink-soft); }\ninput, select, textarea {\n  width: 100%;\n  padding: 9px 11px;\n  border: 1px solid #c3d2e2;\n  border-radius: 8px;\n  font-size: 14px;\n  font-family: inherit;\n  background: var(--panel-raised);\n  color: var(--ink);\n}\ninput::placeholder, textarea::placeholder { color: #8798ab; }\ninput:focus, select:focus, textarea:focus { outline: 2px solid var(--brand); outline-offset: 1px; }\n.field { margin-bottom: 14px; }\n.field-row { display: flex; gap: 12px; }\n.field-row > .field { flex: 1; }\n\nbutton, .btn {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  background: var(--brand);\n  color: #fff;\n  border: none;\n  padding: 10px 16px;\n  border-radius: 8px;\n  font-size: 14px;\n  font-weight: 600;\n  cursor: pointer;\n  text-decoration: none;\n  transition: background .15s ease, transform .1s ease, box-shadow .15s ease;\n  box-shadow: 0 1px 2px rgba(20, 33, 46, 0.18);\n}\nbutton:hover, .btn:hover { background: var(--brand-dark); box-shadow: 0 2px 10px rgba(28, 140, 204, 0.35); }\nbutton:active, .btn:active { transform: translateY(1px); }\nbutton.secondary, .btn.secondary { background: var(--panel-raised); color: var(--ink); border: 1px solid #c3d2e2; box-shadow: none; }\nbutton.secondary:hover, .btn.secondary:hover { background: #dde9f5; box-shadow: none; }\nbutton.small, .btn.small { padding: 6px 10px; font-size: 13px; }\nbutton.danger, .btn.danger { background: #c0392b; box-shadow: 0 1px 2px rgba(0,0,0,0.3); }\nbutton.danger:hover, .btn.danger:hover { background: #a5281c; box-shadow: 0 2px 8px rgba(192, 57, 43, 0.35); }\nbutton:disabled { opacity: .5; cursor: not-allowed; }\n\n.badge {\n  display: inline-block;\n  padding: 3px 9px;\n  border-radius: 999px;\n  font-size: 11px;\n  font-weight: 700;\n  text-transform: uppercase;\n  letter-spacing: .03em;\n}\n.badge.new { background: var(--brand-soft); color: var(--brand); }\n.badge.unscheduled { background: var(--brand-soft); color: var(--brand); }\n.badge.scheduled { background: var(--amber-soft); color: var(--amber); }\n.badge.out_for_delivery { background: var(--amber-soft); color: var(--amber); }\n.badge.delivered { background: var(--green-soft); color: var(--green); }\n.badge.invoiced { background: var(--purple-soft); color: var(--purple); }\n.badge.cancelled { background: var(--red-soft); color: var(--red); }\n.badge.draft { background: rgba(20, 33, 46, 0.07); color: var(--ink-soft); }\n.badge.sent { background: var(--amber-soft); color: var(--amber); }\n.badge.paid { background: var(--green-soft); color: var(--green); }\n.badge.partial { background: var(--brand-soft); color: var(--brand); }\n.badge.void { background: var(--red-soft); color: var(--red); }\n.badge.inquiry { background: rgba(20, 33, 46, 0.07); color: var(--ink-soft); }\n.badge.estimate_scheduled { background: var(--brand-soft); color: var(--brand); }\n.badge.quote_sent { background: var(--amber-soft); color: var(--amber); }\n.badge.accepted { background: var(--purple-soft); color: var(--purple); }\n.badge.deposit_received { background: var(--purple-soft); color: var(--purple); }\n.badge.in_progress { background: var(--amber-soft); color: var(--amber); }\n.badge.complete { background: var(--green-soft); color: var(--green); }\n.badge.done { background: var(--green-soft); color: var(--green); }\n.badge.field { background: var(--amber-soft); color: var(--amber); }\n.badge.office { background: var(--brand-soft); color: var(--brand); }\n\n.error-msg { color: var(--red); font-size: 13px; margin: 8px 0; }\n.ok-msg { color: var(--green); font-size: 13px; margin: 8px 0; }\n.empty { color: var(--ink-soft); font-size: 14px; padding: 24px 0; text-align: center; }\n\n.login-card {\n  max-width: 380px;\n  margin: 8vh auto;\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-top: 4px solid var(--brand-light);\n  border-radius: 14px;\n  padding: 32px 28px;\n  box-shadow: 0 4px 24px rgba(20, 33, 46, 0.10);\n}\n.login-card .logo-wrap { display: flex; justify-content: center; margin-bottom: 8px; }\n.login-card .logo-wrap img { width: auto; height: 72px; max-width: 100%; border-radius: 10px; }\n.login-card h1 {\n  text-align: center;\n  text-transform: uppercase;\n  letter-spacing: .03em;\n  font-size: 20px;\n}\n.login-tabs { display: flex; gap: 8px; margin-bottom: 20px; }\n.login-tabs button { flex: 1; background: var(--panel-raised); color: var(--ink-soft); }\n.login-tabs button.active { background: var(--brand); color: #fff; }\n\n.job-card {\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  padding: 16px;\n  margin-bottom: 12px;\n  border-left: 3px solid var(--brand-light);\n}\n.job-card .job-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }\n.job-card .material { font-weight: 700; font-size: 16px; color: var(--ink); }\n.job-card .addr { color: var(--ink-soft); margin: 4px 0 10px; }\n.job-card .meta { font-size: 13px; color: var(--ink-soft); margin-bottom: 10px; }\n.job-card textarea { margin-bottom: 10px; }\n\n.checkbox-row { display: flex; align-items: center; gap: 8px; }\n.checkbox-row input { width: auto; }\n\n.print-invoice { background: #fff; color: #111; padding: 40px; max-width: 720px; margin: 0 auto; }\n.print-invoice h1 { font-size: 24px; color: #111; }\n.print-invoice h2 { color: #111; }\n.print-invoice .invoice-meta { display: flex; justify-content: space-between; margin: 20px 0; font-size: 14px; }\n.print-invoice table { margin-top: 10px; }\n.print-invoice th, .print-invoice td { border-bottom: 1px solid #ddd; color: #111; }\n.print-invoice th { color: #666; }\n.totals { margin-top: 16px; max-width: 320px; margin-left: auto; font-size: 14px; }\n.totals div { display: flex; justify-content: space-between; padding: 4px 0; }\n.totals .grand { font-weight: 700; font-size: 16px; border-top: 1px solid var(--line); margin-top: 6px; padding-top: 8px; }\n.print-invoice .totals { width: 260px; }\n.print-invoice .totals .grand { border-top: 1px solid #ddd; }\n@media print {\n  .topbar, .no-print { display: none !important; }\n  .container { padding: 0; }\n  body { background: #fff; }\n}\n\n.link-btn { background: none; border: none; color: var(--brand); cursor: pointer; padding: 0; font-size: 13px; font-weight: 600; }\n"
  },
  "customer-detail.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Customer — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container narrow\">\n  <p class=\"subtitle\"><a href=\"/customers.html\">&larr; Back to Customers</a></p>\n  <h1 id=\"cust-title\">Loading…</h1>\n\n  <div class=\"panel\">\n    <h2>Profile</h2>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Name</label><input id=\"f_name\"></div>\n      <div class=\"field\"><label>Phone</label><input id=\"f_phone\"></div>\n    </div>\n    <div class=\"field-row\">\n      <div class=\"field\" style=\"flex:2;\"><label>Email</label><input id=\"f_email\"></div>\n      <div class=\"field\" style=\"flex:2;\"><label>Billing Address</label><input id=\"f_address\"></div>\n    </div>\n    <div class=\"field\">\n      <label>Notes</label>\n      <textarea id=\"f_notes\" rows=\"2\"></textarea>\n    </div>\n    <button type=\"button\" id=\"save-customer\">Save</button>\n    <div id=\"save-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <div class=\"stat-grid\" style=\"display:grid; grid-template-columns: repeat(auto-fit,minmax(160px,1fr)); gap:12px;\">\n      <div class=\"stat-tile\" style=\"background:var(--panel-raised); border:1px solid var(--line); border-radius:var(--radius); padding:14px 16px;\">\n        <div style=\"font-size:12px; color:var(--ink-soft); text-transform:uppercase;\">Lifetime Revenue</div>\n        <div style=\"font-size:22px; font-weight:700; margin-top:4px;\" id=\"stat-revenue\"></div>\n      </div>\n      <div class=\"stat-tile\" style=\"background:var(--panel-raised); border:1px solid var(--line); border-radius:var(--radius); padding:14px 16px;\">\n        <div style=\"font-size:12px; color:var(--ink-soft); text-transform:uppercase;\">Orders</div>\n        <div style=\"font-size:22px; font-weight:700; margin-top:4px;\" id=\"stat-orders\"></div>\n      </div>\n      <div class=\"stat-tile\" style=\"background:var(--panel-raised); border:1px solid var(--line); border-radius:var(--radius); padding:14px 16px;\">\n        <div style=\"font-size:12px; color:var(--ink-soft); text-transform:uppercase;\">Jobs</div>\n        <div style=\"font-size:22px; font-weight:700; margin-top:4px;\" id=\"stat-jobs\"></div>\n      </div>\n    </div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Orders</h2>\n    <div class=\"table-wrap\">\n      <table>\n        <thead><tr><th>Order #</th><th>Date</th><th>Material</th><th>Qty</th><th>Status</th><th>Total</th></tr></thead>\n        <tbody id=\"orders-tbody\"></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"orders-empty\" style=\"display:none;\">No orders yet.</div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Jobs</h2>\n    <div class=\"table-wrap\">\n      <table>\n        <thead><tr><th>Job #</th><th>Scope</th><th>Target Start</th><th>Price</th><th>Status</th></tr></thead>\n        <tbody id=\"jobs-tbody\"></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"jobs-empty\" style=\"display:none;\">No jobs yet.</div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const custId = new URLSearchParams(window.location.search).get('id');\n  if (!custId) { document.getElementById('cust-title').textContent = 'No customer specified.'; return; }\n\n  const [customer, orders, jobs] = await Promise.all([\n    api(`/api/customers/${custId}`), api('/api/orders'), api('/api/jobs'),\n  ]);\n\n  document.getElementById('cust-title').textContent = customer.name;\n  document.getElementById('f_name').value = customer.name || '';\n  document.getElementById('f_phone').value = customer.phone || '';\n  document.getElementById('f_email').value = customer.email || '';\n  document.getElementById('f_address').value = customer.billing_address || '';\n  document.getElementById('f_notes').value = customer.notes || '';\n\n  const custOrders = orders.filter(o => o.customer_id === Number(custId));\n  const custJobs = jobs.filter(j => j.customer_id === Number(custId) || (j.customer_name || '').toLowerCase() === (customer.name || '').toLowerCase());\n  const activeOrders = custOrders.filter(o => o.status !== 'cancelled');\n  const activeJobs = custJobs.filter(j => j.status !== 'cancelled');\n  const revenue = activeOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0) + activeJobs.reduce((sum, j) => sum + (j.price || 0), 0);\n\n  document.getElementById('stat-revenue').textContent = fmtMoney(revenue);\n  document.getElementById('stat-orders').textContent = custOrders.length;\n  document.getElementById('stat-jobs').textContent = custJobs.length;\n\n  document.getElementById('orders-empty').style.display = custOrders.length ? 'none' : 'block';\n  document.getElementById('orders-tbody').innerHTML = custOrders\n    .slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))\n    .map(o => `\n      <tr class=\"row-link\" data-href=\"/order-detail.html?id=${o.id}\">\n        <td>${o.order_number}</td>\n        <td>${o.created_at ? fmtDate(o.created_at.slice(0, 10)) : '—'}</td>\n        <td>${escapeHtml(o.material_name)}</td>\n        <td>${o.quantity} ${o.unit}</td>\n        <td>${badge(o.status)}</td>\n        <td>${fmtMoney(o.total_amount || 0)}</td>\n      </tr>\n    `).join('');\n\n  document.getElementById('jobs-empty').style.display = custJobs.length ? 'none' : 'block';\n  document.getElementById('jobs-tbody').innerHTML = custJobs\n    .slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))\n    .map(j => `\n      <tr class=\"row-link\" data-href=\"/job-detail.html?id=${j.id}\">\n        <td>${j.job_number}</td>\n        <td>${escapeHtml(j.scope || '—')}</td>\n        <td>${j.target_start_date ? fmtDate(j.target_start_date) : '—'}</td>\n        <td>${j.price !== null && j.price !== undefined ? fmtMoney(j.price) : '—'}</td>\n        <td>${badge(j.status)}</td>\n      </tr>\n    `).join('');\n\n  document.querySelectorAll('tr.row-link').forEach(tr => {\n    tr.addEventListener('click', () => { window.location.href = tr.dataset.href; });\n  });\n\n  document.getElementById('save-customer').addEventListener('click', async () => {\n    const msg = document.getElementById('save-msg');\n    try {\n      await api(`/api/customers/${custId}`, { method: 'PUT', body: {\n        name: document.getElementById('f_name').value,\n        phone: document.getElementById('f_phone').value,\n        email: document.getElementById('f_email').value,\n        billing_address: document.getElementById('f_address').value,\n        notes: document.getElementById('f_notes').value,\n      }});\n      msg.innerHTML = '<div class=\"ok-msg\">Saved.</div>';\n      document.getElementById('cust-title').textContent = document.getElementById('f_name').value;\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n})();\n</script>\n</body>\n</html>\n"
  },
  "customers.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Customers — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n<style>\n  th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }\n  th.sortable .arrow { opacity: 0.4; font-size: 11px; margin-left: 3px; }\n  th.sortable.sorted .arrow { opacity: 1; }\n</style>\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <h1>Customers</h1>\n  <p class=\"subtitle\">Every customer on file — search, sort, and click through to their full order and job history.</p>\n\n  <div class=\"panel\">\n    <h2>Add a Customer</h2>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Name</label><input id=\"nc_name\" placeholder=\"required\"></div>\n      <div class=\"field\"><label>Phone</label><input id=\"nc_phone\"></div>\n      <div class=\"field\"><label>Email</label><input id=\"nc_email\"></div>\n    </div>\n    <div class=\"field-row\">\n      <div class=\"field\" style=\"flex:2;\"><label>Billing Address</label><input id=\"nc_address\"></div>\n    </div>\n    <button type=\"button\" id=\"add-customer\">Add Customer</button>\n    <div id=\"add-customer-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <div class=\"field-row\" style=\"align-items:flex-end; flex-wrap:wrap;\">\n      <div class=\"field\" style=\"flex:2; min-width:220px;\">\n        <label>Search</label>\n        <input id=\"search\" placeholder=\"Name, phone, email, address...\">\n      </div>\n      <div class=\"field\" style=\"flex:none;\">\n        <button type=\"button\" class=\"btn secondary\" id=\"clear-filters\">Clear</button>\n      </div>\n    </div>\n    <div id=\"result-count\" class=\"subtitle\" style=\"margin:6px 0 12px;\"></div>\n    <div class=\"table-wrap\">\n      <table id=\"customers-table\">\n        <thead>\n          <tr>\n            <th class=\"sortable\" data-key=\"name\">Name <span class=\"arrow\">▲</span></th>\n            <th>Phone</th>\n            <th>Email</th>\n            <th class=\"sortable\" data-key=\"order_count\">Orders <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"job_count\">Jobs <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"lifetime_revenue\">Lifetime Revenue <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"last_activity\">Last Activity <span class=\"arrow\">▲</span></th>\n          </tr>\n        </thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"empty-msg\" style=\"display:none;\">No customers match that search.</div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const [customers, orders, jobs] = await Promise.all([api('/api/customers'), api('/api/orders'), api('/api/jobs')]);\n\n  const rows = customers.map(c => {\n    const custOrders = orders.filter(o => o.customer_id === c.id && o.status !== 'cancelled');\n    const custJobs = jobs.filter(j => (j.customer_id === c.id || (j.customer_name || '').toLowerCase() === (c.name || '').toLowerCase()) && j.status !== 'cancelled');\n    const orderRevenue = custOrders.reduce((sum, o) => sum + (o.total_amount || 0), 0);\n    const jobRevenue = custJobs.reduce((sum, j) => sum + (j.price || 0), 0);\n    const dates = [...custOrders.map(o => o.created_at), ...custJobs.map(j => j.created_at)].filter(Boolean).sort();\n    return {\n      ...c,\n      order_count: custOrders.length,\n      job_count: custJobs.length,\n      lifetime_revenue: orderRevenue + jobRevenue,\n      last_activity: dates.length ? dates[dates.length - 1] : null,\n    };\n  });\n\n  let sortKey = 'name';\n  let sortDir = 1;\n\n  function applyAndRender() {\n    const q = document.getElementById('search').value.trim().toLowerCase();\n    let filtered = rows.filter(c => {\n      if (!q) return true;\n      const hay = [c.name, c.phone, c.email, c.billing_address].filter(Boolean).join(' ').toLowerCase();\n      return hay.includes(q);\n    });\n\n    filtered = filtered.slice().sort((a, b) => {\n      let av = a[sortKey], bv = b[sortKey];\n      if (av === null || av === undefined) av = '';\n      if (bv === null || bv === undefined) bv = '';\n      if (typeof av === 'string') av = av.toLowerCase();\n      if (typeof bv === 'string') bv = bv.toLowerCase();\n      if (av < bv) return -1 * sortDir;\n      if (av > bv) return 1 * sortDir;\n      return 0;\n    });\n\n    document.getElementById('result-count').textContent = `${filtered.length} customer${filtered.length === 1 ? '' : 's'}`;\n    document.getElementById('empty-msg').style.display = filtered.length ? 'none' : 'block';\n    document.querySelector('#customers-table tbody').innerHTML = filtered.map(c => `\n      <tr class=\"row-link\" data-href=\"/customer-detail.html?id=${c.id}\">\n        <td>${escapeHtml(c.name)}</td>\n        <td>${escapeHtml(c.phone || '—')}</td>\n        <td>${escapeHtml(c.email || '—')}</td>\n        <td>${c.order_count}</td>\n        <td>${c.job_count}</td>\n        <td>${fmtMoney(c.lifetime_revenue)}</td>\n        <td>${c.last_activity ? fmtDate(c.last_activity.slice(0, 10)) : '—'}</td>\n      </tr>\n    `).join('');\n    document.querySelectorAll('#customers-table tbody tr.row-link').forEach(tr => {\n      tr.addEventListener('click', () => { window.location.href = tr.dataset.href; });\n    });\n\n    document.querySelectorAll('th.sortable').forEach(th => {\n      th.classList.toggle('sorted', th.dataset.key === sortKey);\n      th.querySelector('.arrow').textContent = (th.dataset.key === sortKey && sortDir === -1) ? '▼' : '▲';\n    });\n  }\n\n  document.querySelectorAll('th.sortable').forEach(th => {\n    th.addEventListener('click', () => {\n      const key = th.dataset.key;\n      if (sortKey === key) { sortDir *= -1; } else { sortKey = key; sortDir = 1; }\n      applyAndRender();\n    });\n  });\n  document.getElementById('search').addEventListener('input', applyAndRender);\n  document.getElementById('clear-filters').addEventListener('click', () => {\n    document.getElementById('search').value = '';\n    applyAndRender();\n  });\n\n  document.getElementById('add-customer').addEventListener('click', async () => {\n    const msg = document.getElementById('add-customer-msg');\n    try {\n      const name = document.getElementById('nc_name').value.trim();\n      if (!name) { msg.innerHTML = '<div class=\"error-msg\">Name is required.</div>'; return; }\n      const c = await api('/api/customers', { method: 'POST', body: {\n        name, phone: document.getElementById('nc_phone').value, email: document.getElementById('nc_email').value,\n        billing_address: document.getElementById('nc_address').value,\n      }});\n      window.location.href = `/customer-detail.html?id=${c.id}`;\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  applyAndRender();\n})();\n</script>\n</body>\n</html>\n"
  },
  "dashboard.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Dashboard — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <h1>Dashboard</h1>\n  <p class=\"subtitle\" id=\"today-label\"></p>\n\n  <div class=\"grid cols-4\" id=\"stats\"></div>\n\n  <div class=\"panel\" style=\"margin-top:20px;\">\n    <h2>Today's Deliveries</h2>\n    <div class=\"table-wrap\">\n      <table id=\"today-table\">\n        <thead><tr><th>Order #</th><th>Customer</th><th>Material</th><th>Qty</th><th>Driver</th><th>Time</th><th>Status</th></tr></thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"today-empty\" style=\"display:none;\">Nothing scheduled for today yet.</div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  document.getElementById('today-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });\n\n  const data = await api('/api/dashboard/summary');\n  const c = data.counts, inv = data.invoiceCounts;\n  document.getElementById('stats').innerHTML = `\n    <a class=\"stat clickable\" href=\"/schedule.html\"><div class=\"label\">New Orders</div><div class=\"value\">${c.new_orders || 0}</div></a>\n    <a class=\"stat clickable\" href=\"/schedule.html\"><div class=\"label\">Scheduled</div><div class=\"value\">${c.scheduled_orders || 0}</div></a>\n    <a class=\"stat clickable\" href=\"/invoices.html\"><div class=\"label\">Delivered · Ready to Invoice</div><div class=\"value\">${c.delivered_orders || 0}</div></a>\n    <a class=\"stat clickable\" href=\"/invoices.html\"><div class=\"label\">Outstanding Invoices</div><div class=\"value\">${fmtMoney(inv.outstanding)}</div></a>\n  `;\n\n  const tbody = document.querySelector('#today-table tbody');\n  if (!data.todaysDeliveries.length) {\n    document.getElementById('today-empty').style.display = 'block';\n  } else {\n    tbody.innerHTML = data.todaysDeliveries.map(d => `\n      <tr class=\"row-link\" data-href=\"/order-detail.html?id=${d.order_id}\">\n        <td>${d.order_number}${d.total_deliveries > 1 ? ` (${d.sequence}/${d.total_deliveries})` : ''}</td>\n        <td>${d.customer_name}</td>\n        <td>${d.material_name}</td>\n        <td>${d.quantity} ${d.unit}</td>\n        <td>${d.driver_name || '—'}</td>\n        <td>${d.slot_time || '—'}</td>\n        <td>${badge(d.status)}</td>\n      </tr>\n    `).join('');\n    tbody.querySelectorAll('tr.row-link').forEach(tr => tr.addEventListener('click', () => { window.location.href = tr.dataset.href; }));\n  }\n})();\n</script>\n</body>\n</html>\n"
  },
  "driver.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>My Deliveries — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/driver.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container narrow\">\n  <h1>My Deliveries</h1>\n  <p class=\"subtitle\" id=\"date-label\"></p>\n\n  <div id=\"jobs\"></div>\n  <div class=\"empty\" id=\"empty-msg\" style=\"display:none;\">No deliveries assigned for today.</div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['driver']);\n  if (!me) return;\n\n  document.getElementById('date-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });\n\n  async function load() {\n    const jobs = await api('/api/driver/jobs');\n    const container = document.getElementById('jobs');\n    document.getElementById('empty-msg').style.display = jobs.length ? 'none' : 'block';\n    container.innerHTML = jobs.map(job => `\n      <div class=\"job-card\" data-id=\"${job.id}\">\n        <div class=\"job-top\">\n          <div>\n            <div class=\"material\">${job.material_name}${job.total_deliveries > 1 ? ` (load ${job.sequence} of ${job.total_deliveries})` : ''}</div>\n            <div class=\"addr\">${job.delivery_address}</div>\n          </div>\n          ${badge(job.status)}\n        </div>\n        <div class=\"meta\">\n          ${job.customer_name} · ${job.customer_phone || 'no phone on file'}<br>\n          Qty: ${job.quantity} ${job.unit} ${job.slot_time ? '· ' + job.slot_time : ''}\n          ${job.order_notes ? '<br>Note: ' + job.order_notes : ''}\n        </div>\n        ${job.status === 'delivered' ? `<div class=\"ok-msg\">Delivered</div>` : `\n          <textarea class=\"notes-input\" rows=\"2\" placeholder=\"Delivery notes (optional) — e.g. left at gate, signed by...\"></textarea>\n          <div style=\"display:flex; gap:8px;\">\n            ${job.status === 'scheduled' ? `<button type=\"button\" class=\"btn secondary start-btn\" style=\"flex:1;\">Start Delivery</button>` : ''}\n            <button type=\"button\" class=\"btn deliver-btn\" style=\"flex:1;\">Mark Delivered</button>\n          </div>\n        `}\n      </div>\n    `).join('');\n\n    container.querySelectorAll('.start-btn').forEach(btn => {\n      btn.addEventListener('click', async () => {\n        const id = btn.closest('.job-card').dataset.id;\n        await api(`/api/deliveries/${id}/start`, { method: 'POST' });\n        load();\n      });\n    });\n    container.querySelectorAll('.deliver-btn').forEach(btn => {\n      btn.addEventListener('click', async () => {\n        const card = btn.closest('.job-card');\n        const id = card.dataset.id;\n        const notes = card.querySelector('.notes-input').value;\n        btn.disabled = true;\n        await api(`/api/deliveries/${id}/deliver`, { method: 'POST', body: { driver_notes: notes || null } });\n        load();\n      });\n    });\n  }\n\n  await load();\n})();\n</script>\n</body>\n</html>\n"
  },
  "favicon.png": {
    "encoding": "base64",
    "content": "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"
  },
  "financial.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Financials — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n<style>\n  .viz-root {\n    --cat-1:#3987e5; --cat-2:#d95926; --cat-3:#199e70; --cat-4:#c98500;\n    --cat-5:#d55181; --cat-6:#008300; --cat-7:#9085e9; --cat-8:#e66767;\n    --cat-other:#6b7280;\n    --status-good:#15803d; --status-warning:#9a4a07; --status-critical:#b91c1c;\n  }\n  .stat-grid { display:grid; grid-template-columns: repeat(auto-fit,minmax(190px,1fr)); gap:12px; }\n  .stat-tile { background:var(--panel-raised); border:1px solid var(--line); border-radius:var(--radius); padding:14px 16px; }\n  .stat-tile .stat-label { font-size:12px; color:var(--ink-soft); text-transform:uppercase; letter-spacing:.04em; }\n  .stat-tile .stat-value { font-size:24px; font-weight:700; margin-top:4px; font-variant-numeric: tabular-nums; }\n  .legend { display:flex; gap:16px; margin: 2px 0 14px; font-size:12px; color:var(--ink-soft); flex-wrap:wrap; }\n  .legend .swatch { display:inline-block; width:10px; height:10px; border-radius:2px; margin-right:5px; vertical-align:-1px; }\n  .hbar-row { display:flex; align-items:center; gap:10px; margin-bottom:8px; }\n  .hbar-label { width:170px; flex:none; font-size:12px; color:var(--ink-soft); text-align:right; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }\n  .hbar-track { flex:1; background:var(--line); border-radius:4px; height:18px; position:relative; overflow:hidden; }\n  .hbar-fill { height:100%; border-radius:4px; }\n  .hbar-value { width:90px; flex:none; font-size:12px; color:var(--ink); font-variant-numeric: tabular-nums; }\n  .bar-tooltip { position:fixed; pointer-events:none; background:var(--panel-raised); border:1px solid var(--line); border-radius:6px; padding:6px 10px; font-size:12px; z-index:50; box-shadow:0 4px 16px rgba(20,33,46,.18); display:none; white-space:nowrap; }\n  #monthly-chart rect { cursor:pointer; }\n  .month-axis text { font-size:10px; fill:var(--ink-soft); }\n  .table-note { font-size:12px; color:var(--ink-soft); margin-top:6px; }\n</style>\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container viz-root\">\n  <h1>Financials</h1>\n  <p class=\"subtitle\">Revenue across materials and jobs, who your top customers are, and where invoices stand.</p>\n\n  <div class=\"panel\">\n    <div class=\"stat-grid\" id=\"stat-tiles\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Monthly Revenue</h2>\n    <div class=\"legend\">\n      <span><span class=\"swatch\" style=\"background:var(--cat-1);\"></span>Materials</span>\n      <span><span class=\"swatch\" style=\"background:var(--cat-2);\"></span>Jobs</span>\n    </div>\n    <svg id=\"monthly-chart\" viewBox=\"0 0 780 280\" style=\"width:100%; height:auto; display:block;\"></svg>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Revenue by Material</h2>\n    <div id=\"material-bars\"></div>\n    <div class=\"empty\" id=\"material-empty\" style=\"display:none;\">No material revenue yet.</div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Top Customers</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:10px;\">Combined materials + job revenue, all time.</p>\n    <div id=\"customer-bars\"></div>\n    <div class=\"empty\" id=\"customer-empty\" style=\"display:none;\">No customer revenue yet.</div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Invoices</h2>\n    <div class=\"stat-grid\">\n      <div class=\"stat-tile\"><div class=\"stat-label\">Paid</div><div class=\"stat-value\" style=\"color:var(--status-good);\" id=\"inv-paid\"></div></div>\n      <div class=\"stat-tile\"><div class=\"stat-label\">Outstanding</div><div class=\"stat-value\" style=\"color:var(--status-warning);\" id=\"inv-outstanding\"></div></div>\n      <div class=\"stat-tile\"><div class=\"stat-label\">Overdue Invoices</div><div class=\"stat-value\" style=\"color:var(--status-critical);\" id=\"inv-overdue\"></div></div>\n      <div class=\"stat-tile\"><div class=\"stat-label\">Draft</div><div class=\"stat-value\" id=\"inv-draft\"></div></div>\n    </div>\n  </div>\n</div>\n\n<div class=\"bar-tooltip\" id=\"tooltip\"></div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const data = await api('/api/financial/summary?months=12');\n  const tooltip = document.getElementById('tooltip');\n  function showTooltip(evt, html) {\n    tooltip.innerHTML = html;\n    tooltip.style.display = 'block';\n    tooltip.style.left = (evt.clientX + 14) + 'px';\n    tooltip.style.top = (evt.clientY + 14) + 'px';\n  }\n  function hideTooltip() { tooltip.style.display = 'none'; }\n\n  // ---- Stat tiles ----\n  const s = data.stats;\n  document.getElementById('stat-tiles').innerHTML = `\n    <div class=\"stat-tile\"><div class=\"stat-label\">Combined Revenue</div><div class=\"stat-value\">${fmtMoney(s.combinedRevenue)}</div></div>\n    <div class=\"stat-tile\"><div class=\"stat-label\">Materials Revenue</div><div class=\"stat-value\">${fmtMoney(s.materialsRevenueAllTime)}</div></div>\n    <div class=\"stat-tile\"><div class=\"stat-label\">Jobs Revenue (Won)</div><div class=\"stat-value\">${fmtMoney(s.jobsRevenueWon)}</div></div>\n    <div class=\"stat-tile\"><div class=\"stat-label\">Jobs Pipeline Value</div><div class=\"stat-value\">${fmtMoney(s.jobsPipelineValue)}</div></div>\n    <div class=\"stat-tile\"><div class=\"stat-label\">Orders (all time)</div><div class=\"stat-value\">${s.orderCount}</div></div>\n    <div class=\"stat-tile\"><div class=\"stat-label\">Avg Order Value</div><div class=\"stat-value\">${fmtMoney(s.avgOrderValue)}</div></div>\n  `;\n\n  // ---- Invoices ----\n  document.getElementById('inv-paid').textContent = fmtMoney(data.invoices.paidInvoicesTotal);\n  document.getElementById('inv-outstanding').textContent = fmtMoney(data.invoices.outstandingInvoices);\n  document.getElementById('inv-overdue').textContent = data.invoices.overdueCount;\n  document.getElementById('inv-draft').textContent = fmtMoney(data.invoices.draftTotal);\n\n  // ---- Monthly stacked bar chart (SVG) ----\n  (function drawMonthly() {\n    const rows = data.monthlyRevenue;\n    const svg = document.getElementById('monthly-chart');\n    const W = 780, H = 280, padL = 56, padB = 34, padT = 12, padR = 12;\n    const plotW = W - padL - padR, plotH = H - padT - padB;\n    const maxVal = Math.max(1, ...rows.map(r => r.total));\n    const niceMax = Math.pow(10, Math.floor(Math.log10(maxVal))) * Math.ceil(maxVal / Math.pow(10, Math.floor(Math.log10(maxVal))));\n    const gridSteps = 4;\n    const barSlot = plotW / rows.length;\n    const barW = Math.max(6, barSlot - 8);\n\n    let svgHtml = '';\n    // gridlines + y labels\n    for (let i = 0; i <= gridSteps; i++) {\n      const val = (niceMax / gridSteps) * i;\n      const y = padT + plotH - (val / niceMax) * plotH;\n      svgHtml += `<line x1=\"${padL}\" y1=\"${y}\" x2=\"${W - padR}\" y2=\"${y}\" stroke=\"var(--line)\" stroke-width=\"1\"/>`;\n      svgHtml += `<text x=\"${padL - 8}\" y=\"${y + 3}\" text-anchor=\"end\" font-size=\"10\" fill=\"var(--ink-soft)\">${val >= 1000 ? (val/1000).toFixed(0) + 'k' : val.toFixed(0)}</text>`;\n    }\n    // bars\n    rows.forEach((r, i) => {\n      const x = padL + i * barSlot + (barSlot - barW) / 2;\n      const materialsH = (r.materials / niceMax) * plotH;\n      const jobsH = (r.jobs / niceMax) * plotH;\n      const yMaterialsTop = padT + plotH - materialsH;\n      const yJobsTop = yMaterialsTop - jobsH;\n      if (r.materials > 0) svgHtml += `<rect class=\"mchart-seg\" data-month=\"${r.month}\" data-series=\"Materials\" data-value=\"${r.materials}\" x=\"${x}\" y=\"${yMaterialsTop}\" width=\"${barW}\" height=\"${materialsH}\" fill=\"var(--cat-1)\"/>`;\n      if (r.jobs > 0) svgHtml += `<rect class=\"mchart-seg\" data-month=\"${r.month}\" data-series=\"Jobs\" data-value=\"${r.jobs}\" x=\"${x}\" y=\"${yJobsTop}\" width=\"${barW}\" height=\"${jobsH}\" fill=\"var(--cat-2)\"/>`;\n      if (r.materials === 0 && r.jobs === 0) svgHtml += `<rect class=\"mchart-seg\" data-month=\"${r.month}\" data-series=\"No revenue\" data-value=\"0\" x=\"${x}\" y=\"${padT + plotH - 2}\" width=\"${barW}\" height=\"2\" fill=\"var(--line)\"/>`;\n      const label = new Date(`${r.month}-01T00:00:00`).toLocaleDateString(undefined, { month: 'short' });\n      svgHtml += `<text x=\"${x + barW / 2}\" y=\"${padT + plotH + 16}\" text-anchor=\"middle\" class=\"month-axis\" font-size=\"10\">${label}</text>`;\n    });\n    svg.innerHTML = svgHtml;\n    svg.querySelectorAll('.mchart-seg').forEach(el => {\n      el.addEventListener('mousemove', (e) => showTooltip(e, `<strong>${el.dataset.month}</strong><br>${el.dataset.series}: ${fmtMoney(el.dataset.value)}`));\n      el.addEventListener('mouseleave', hideTooltip);\n    });\n  })();\n\n  // ---- Revenue by material (horizontal bars, categorical palette) ----\n  (function drawMaterialBars() {\n    const rows = data.revenueByMaterial;\n    const el = document.getElementById('material-bars');\n    document.getElementById('material-empty').style.display = rows.length ? 'none' : 'block';\n    if (!rows.length) return;\n    const palette = ['var(--cat-1)','var(--cat-2)','var(--cat-3)','var(--cat-4)','var(--cat-5)','var(--cat-6)','var(--cat-7)','var(--cat-8)'];\n    const top = rows.slice(0, 8);\n    const other = rows.slice(8);\n    const display = [...top.map((r, i) => ({ ...r, color: palette[i] }))];\n    if (other.length) display.push({ material_name: `Other (${other.length})`, revenue: other.reduce((a, r) => a + r.revenue, 0), color: 'var(--cat-other)' });\n    const maxVal = Math.max(1, ...display.map(r => r.revenue));\n    el.innerHTML = display.map(r => `\n      <div class=\"hbar-row\">\n        <div class=\"hbar-label\">${escapeHtml(r.material_name)}</div>\n        <div class=\"hbar-track\"><div class=\"hbar-fill\" style=\"width:${(r.revenue / maxVal * 100).toFixed(1)}%; background:${r.color};\"></div></div>\n        <div class=\"hbar-value\">${fmtMoney(r.revenue)}</div>\n      </div>\n    `).join('');\n  })();\n\n  // ---- Top customers (horizontal bars, single hue) ----\n  (function drawCustomerBars() {\n    const rows = data.topCustomers;\n    const el = document.getElementById('customer-bars');\n    document.getElementById('customer-empty').style.display = rows.length ? 'none' : 'block';\n    if (!rows.length) return;\n    const maxVal = Math.max(1, ...rows.map(r => r.revenue));\n    el.innerHTML = rows.map(r => `\n      <div class=\"hbar-row\">\n        <div class=\"hbar-label\">${escapeHtml(r.customer_name)}</div>\n        <div class=\"hbar-track\"><div class=\"hbar-fill\" style=\"width:${(r.revenue / maxVal * 100).toFixed(1)}%; background:var(--cat-1);\"></div></div>\n        <div class=\"hbar-value\">${fmtMoney(r.revenue)}</div>\n      </div>\n    `).join('');\n  })();\n})();\n</script>\n</body>\n</html>\n"
  },
  "img/logo-large.png": {
    "encoding": "base64",
    "content": "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BqxwoG516qOnmudNVZ4LoYD0cuCzNwwjFouFQqFnn332+OOPZz3K5BU7FXOcOnXqfffdN23aNEQsKiriWNLvCIvRb0AbRJuamsrKyv7whz9cfvnlwDK0QEl77b/66qvf/va3L7/8clFRka4pk7UxIBp2orl65E/gh1fGkp5El4BnGpMDEICQhBKEupWTi2Y4IA1j7ay2KY/FVy+CYEAIk8gjQMzieUlKmUqllFJPPfXU+PHjWY8yeciOlR8mTpz4l7/85eOPPw4EAjnKlO1ksBjdGSGEUqqpqem4446777779t1337ReyfXQmI4ivbc99dRTN9xwQ319fRajSAkQEYSTjFcdeyGMviyRjEsUsL3OE3exZ7IH/t+sa4c8IsBgOOTEYM4rjTOec1ubRDgM5EF2w5p1Z6ZEIvHII4+cd955rEeZ/CQtSZVSzz///F/+8peFCxcWFxfnsOVKp4DF6H9gGEZbW5thGL///e+vu+46ROQlzyekjxwrV6686qqr3n333fLycr2gZOX6iEBOKlU99grvqPMT8RhKBNDees5kYnIJgUByCDEQKA1sXdYy+a/xJbMhGEQpILv+R20piMVijz322LnnnsuLM5O3pCVpW1vbQw899Le//U2HgQEHkv4XWIxuR+ck1dfXDxky5MEHHzz88MOJiIjYIOordDAGEd1xxx233347AEQikSwdZxGAQDmJivG/p4PGpRJtICWHjjI5Rx+GCFApV5jhELpyzku1055y4y1GMExZ16Oe5yWTyeeff37cuHGsR5l8Jh3d99VXX/3pT3967rnnAKCoqIi99l+HxShAe/GmlpaW888//9577y0uLuY1zrekTaTvv//+5Zdfvnr16vLy8mzpUQHKBRBdzr4l2X+knUhIgbxiMXmAQCJAUuQRSCMSKdqwqPmt+1vXfCaDUURU5AGI7ESRCiFc11VKvfbaa6NGjeJofiaf2THjftq0aTfeeOOcOXNKSkqyX986z2Exut01b1nWnXfeeckllwDnKjHtUaRbt2694oorXnvttYqKCsiOewUFeY40A5UX3JvodqBt6/hRVqRMHkFKoRWKuonU9EcaP3wRhGGIEFGKECgrklRKmUwmw+Hw1KlTBw4cyCs2k+ek65Latn3//ffffffdLS0tWa9vndf4XYwahtHQ0LDvvvs+8cQTQ4cOdV1XCMGueQZ2OJPceuutt912WzAY1FVmO/q6KITrJELFPcovuqe5tAc6KUCekEyeQaTQCFshc8m7NRPvcVtrzUCRp0iQrkXa4Ugp29raevfu/f7773ft2pX7hTL5T3pPWbp06a9//et33323uLjYNE02kYKfe2Gn23uMHTv2/fff10rUMAxe0RiNlFL3I77xxhtfeOGFUCjU2tqaheANUsowg8mGr5peuaUo1aqEkZN+jAzzbSBKcmKplrbBx3W94K/R7ge4sZhAmR0lCgCe5xUVFa1YseLCCy90HEeH+Gfn0gyza+iEBNd1BwwYMGnSpAceeMA0zebmZo4JBN+KUSEEETU2Nl577bWvv/56ly5dOEiU+TraTO667qmnnjp58uR99923oaEhK3oUZCgaW70o+dodUYOUtoxy+CiTV6CUiBRvaa7aN3rBvSWHHeMkmwEFoPbUd7gqdV23oqLi7bffvuGGG6SUbF5i8h9ENAxDmzl+/vOff/DBB8OHD6+treW2jn500+v6yZ7n/eUvf7n00ks5a575n+izSn19/fnnnz9p0qSqqqpsxPoIw4u3Vhz9Uzz+ykSyzQTDYz3K5B9InicDESlh2kO1H0wwpEXS8sARWSlEKqVsaGh4/vnnzzjjDLYpMJ0IPV1d17399tvvuusuRAyHw76tReo7MarTlYqKiiZMmHDccce5riulxGy5lpjOiw738TzvF7/4xT/+8Y/KysqObxyKAOA4bd1+9MfYYaeoWAsKztJg8hEE5ZGIhELq01cb3rwHAIRhkMrG2UlXgw4Ggx9//HGfPn04eJTpRCilEBER33///SuuuGLVqlXl5eX+zGry10trmmZTU9Nee+313nvvaSVqGAYrUea7oENIEfHBBx/805/+1NTU1HEG9XYDKCGiNCI1b98dXTcPA1EirpbM5B0ECIASKR5PqENPrz77FmGGle2AkP9XpbTjrk4UCAQaGxuvuOIK13U5eJTpROgdxHXdUaNGTZ8+fdy4cbW1teDLjo8++sLazXrAAQe89957Q4YMYYcO833RHTU8z/vd73730EMPJRIJbVnP+IXS7k0iJYV0U6mGV2+PxmpRWkjEPZmYvAKBCAQBoiAn3hzff0z1T+6Q4SJlp6QAAtHR8aOu65aWlk6ePPm+++7Th8YOvRzDZBAdRep5XteuXV9++eU//elP8Xjctm2/VSvzi5ve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Arrm6AEHHDBu3LgXXnihrKwsTyRpHolRKWVDQ8N1111XWVnJLZd2Df1u63BP27ZnzJjxyiuvTJ8+fd26da7rBgKBYDBYVlamq1qm+e5z0TRNy7L0eqGUqq+vf/fddydOnFhcXDxo0KBTTjnlpJNO6tevn/5hfoi7hhCCiH784x/ff//9GzZsyFxaPQgEz04kl043ex+c4ryNfEHH9AIBGIEQEDV++lpi3efFP7rO6D0smWwzQCCgJ3zoT0ZEpVwHK7pbXXvHv1qIVjhTBZ50zRbItRrLOS0tLa7rZvMmIKLeR0zT/G8mJ52QoP1sPn9AHYFeSq655prXX389fyJH86XOqDYIRSKROXPm7LnnnmwZ/b5oy6UWf1u2bHnhhRdefPHFxYsXO44TDocDgYBOjtkxcX73SS8WruvG43HbtisqKkaNGnX++eePGTNGP0EOt9gF9E276667fvvb32aw5igieK4XLK8quuSJmFUsyPVJoowiChum889rmr+cI4Nhyu+2qCikshMgZZcTrnF+cHoimTBICAJP5PWwMw4CEQgiLxAspnf/0vDB02aoxAOFtLs2YiFEPB7fb7/95syZowNjfKt4jj/++KVLl2azCnpajJaWlhYVFZWWlnbr1m2PPfbYa6+9evbs2a1bt6qqqh0fRzotgY2mGUTf0vHjx+dPWn2+qAQhRGNj43nnndetWze2qH0v0jJUSrl27dp//OMf//rXvzZs2BAOh6PRqDZhajri0ulJHI1GhRCO47z66quvv/76YYcddskll5x55pm6mRCfLr4X2jh67rnn/v3vf29tbdX75e5/rCIhTEzVbi1aPVcOGUsJBwQv7nkHKQ/NECh38xv37BFvKhp5frPjBJVAIH9VhwVEIABySAV7DpEyoEBnn+3uu6DdR21tbbFYrLi4OBOD7azU19dv3bo1myXQd/TIpfcmnV8bCoXKysq6devWv3//Aw444KCDDtp///3Lyso4LSHj6A3liiuumDRpUp74XPJFjHqeV1RUdPHFF/v5kLoLaOEupdy0adNf//rXZ555pqampqioqKqqqoME6H8jfX4tLS0FgHnz5s2cOfPBBx/85S9/efrpp2vLN/tcviO6W/0ee+wxfvz4Bx54oLKyMjM1R0EhoEte4suPQoPGxBANAoXCVzVHOwfkgkDLMre9+2hXENFRP03GbRDYYX1M8xNd+UAo18HqfaxoWSLRJoVEyEzLhiyvkPlJ2mOe5VuhN4Id/62tKk1NTTU1NXPmzHn66aeDweCee+45ePDg4cOHjxw5csiQIelMXL3x8W6yy+jI0aOOOmrYsGGffPJJPjRkyosThpSytbV19OjRAwcOZBPadyT9Qtq2/de//vWII464++67k8lkZWWlYRi6kmiuRqUjLioqKhYuXHj22WePHTt29uzZeu3IB3dAp0DH9V544YXFxcWZq76hPELLkKk1i4zGTWAEaHs6CJNvIBAQCBkKbZv8iJz9mhUqAi9firBkCwIAQCTlqKIuRlVPdJOIkCnzMCL6JEzlW6AcoU8CerNwXTdduNowjEgkUl5eXllZGQ6Ha2pqJk6ceO21144cOfLII4+8+eabP/vsM13dRe8mOZdQnRdtPPrZz37mOE4+yPp8kX2IeNFFFwFXfftuaG+FlPKjjz4aNWrU1Vdf3dzcXFVVJaV0XTcf7qFSynXdSCRSVlY2bdq0Y4899rrrrmtubtYjzPXoOgHaUz9w4MBRo0ZpT/3ufyaSEITKDDvNm1LrPrMM4QKK/A6g9DVECIQBo3bSA9aaj0WwBJQfz3KoPNcIyW77g3JYPhY2WqemO7OYpllSUqKLWy9YsODWW28dNWrUMccc8+ijj9bW1upWLCxJdw0d/XXyyScPGDAgkUjk3AiYezEqhIjFYkOGDDnmmGPYLPpd0AbRVCp1ww03/PCHP5w/f35VVZW2huaDDN0RvayUlJQEAoF77713+PDhU6dONQyD2suaMt+Cfprnn39+pj7QEwjgAngEwl46XXougnbTM3kKEUgwybOb37gvGttC0spUOnknAgE9IGvPfiRNAmBbvn8gIi1MASASiWi/3yeffPL//t//+8EPfvCb3/xm5cqVaUmab9tfnqPzScLh8BlnnJGphn+7Q+73ISFEIpH48Y9/bFmWNvjlekR5jeu6Usply5Ydc8wxd9xxRzAYLCoqykMZuiN6maiqqlqzZs3JJ59800036VMHu+y/HW0cPfbYYwcMGBCPx3d/sUA9SRQJK5hc/4Ws3yQMyVt7nqOIZCAU27I2Ne0JK2C2F9n00zqJSJ6HXXobgSIiB/j45Eu0t42IotFoZWVlXV3dPffcc+SRR15xxRUrVqzQYWDsdvteaLl19tlnV1VVOY6T28Hk+K1GRNu2q6urTz/9dADIuTbPZ7Q10TCMF1988eijj547d26XLl3o+1QJzS2u64ZCoUgkcuutt5500kmbN29ml/23o4OigsHg6aefnhkx2v4vlIbbVktfzUcjjIofQV6DAOC5ZjjQMG+SuXoeBcOoXJHHh8/Mg6A8D0orzZKuwCuG79Gq1DTNyspKx3EefvjhI4888je/+c22bdvY7fa90Cah3r17H3vssZkKBtv1weTw2gAghGhrazvmmGN69Oihw2lzO568Rb9dQohbbrnlvPPOS6VSxcXFOT/KfF900HqXLl0mT548atSoTz/9VEcX5Hpc+Yt+I84444yKiooMPm4EJMDUylmWcj002Dia3xABIgpwEvEZz4RUygND+ckwCoCoXCdUYpX3UJ5fiuMy3w4Rua4rhNDFRu65555hw4Y99thjuvYTbyvfi5/85Cc5V1+5F39CiLPOOgva9RbzdbRMd133ggsuuOmmm0pKSkzT7CwG0a/jOE55efnGjRvHjh375ptvsh79FvTJtU+fPkcddVRbW1umTq5ECs1Aav0y2bwepZmRz2Q6ElQKIFQUW/WpWDVHWmHd2t4/ICklgmaXHkTEkVxMmh0laU1NzWWXXfbDH/5w8eLFhmFw6a7vgtagI0eO3H///TPif9v1keTqwtDeBqN///4jR44kIi50/41oJRqLxcaPHz9hwoQuXboUwDvmum44HHZd96yzzpowYYJhGJ3OyptlzjjjzAw6ZglISmk316gNS6RpgWLLaL6DQAIQXCe24O0gOJQHdoRsQohARF16SRTEhnzmP9GS1LKsysrK999/f9SoUQ899JAQgjMT/ic60DYYDJ5yyim+FqOJROLEE08MhUKcuvSNaCXa0NBw8sknT5w4MYOdIXOO53mmaQaDwYsvvvixxx4zTTPP07ByhV4dxow5tlevXqlUMiOvCRIiCBc8teoziV7nPtn4BiIlAoHEitly60phBsFPNbkIhVKuLO8uLYv47MR8E1qS6uaWV1555dlnn11fX8+ZCf8TvcWcdtppGa1p/f2HkasLA4Aujf6jH/0IOHXpm9BKtK2tbfz48dOnTy8kJapRSiFicXHxFVdc8fjjjxuGwafYr6PTmEpLS4899ti2tlimHAgKSIpQ4qvPjbYGkBw22gkQCsgIuG2tzhcfGob01cFNECnlUVEVBkuAPA4bZf4baa/9Sy+9dPTRR3/22We8s3w76ZrWhxxySA5rPOXOJCtEPB4fMmTIAQccwOVFv462Edq2ffbZZ8+YMSMfKi90BPprFhcXX3755S+88ALHj34LP/rRqZnr2qeQlDDMVMMG2LpaGAHd8pvD8fIa9FARmDK5YqaRipFE4Zte9YgASmG4RBaVg+sBT1Tmv6NNpBUVFatWrTr++OPfeOMNto9+O9o1ffLJJzuO40cxmkwmx44dK6XkU8tO6OIUQohLLrlk4sSJuoBFrgfVURARIkaj0YsvvnjKlCl8iv06enU44ogj+vbtm0wmM7FYIAEigmvbzvrPpZRAikD6q2BQZ4NAKFCmtFJb1uK2NWiEFCrwxwGCAEEpZQXNkipSni++M7N7uK4bjUZt2z7rrLMeffRR3lm+Bb2nHH/88WVlZbkSGzkTo67rFhUVnXDCCcA++q+heyzddNNNOmOp4I90SindReO8885bunSplLKzZ2hlFu2pD4fDo0ePzlSMOSEIUigMZ918044TCgRA1qJ5jUAikkbKaXE3fGYJS2WsT3v+g0CkpIVFXfxWSYDZZXRmQjgcvvzyy++99162j/43tKe+b9++Bx98cK7SmHJkjxUikUgMGTJkwIAB7KPfCdd1DcN47rnnbrvttkL1zn8dpVQwGGxubj777LMbGhp0p7JcDyrvOOmkkzLlqUciD1AageSWtaJ5KxmWIJstTvmN0rGSUhnqq2WCbCQB/iiFgAACSIEwy6sRfKTBmd1Er5ZlZWXXXnvtHXfcwZFg/w3tqT/hhBNs2/aXGE2lUmPGjGEf/U54nmcYxueff37llVcWFxf7SpB5nldUVLR06dLLL79ci1FOrk+jV4ehQ4fuvffeyWRGcuoRgEBK1dZEW1ZIwwQC5D0+/yGFhpHculrEG1HoOkeF/9QIgJAIBYWLt09dhvluEBERVVZW3njjjQ8++CDr0W+kvWzLmNLSUtd1s1/dKDdiVPscx4wZA+3dURloj55sbW296KKLksmk7myW60FlFR11/tJLL9133326anGuR5QvaE99NBodPnx4IpHI1MkVEZTruesXSRAeSAQ+GeY9RGCYbvM2aNpMRggIEXzxmhACKU+WVAnTAp8tjMxuovVoaWnpL3/5yxdffJH16NfRnvp+/foNGTIkHo/7Qozq1KW+ffsOGTIEOGB0B3TS0u9+97sFCxYUFRX502bseV5ZWdlNN900d+5cNpzviD6ZHHfccRlcJogIpeFsXiydNiUk7/CdAkShUnGoXy+FAH+UgEcgQQKVgmAJCZPFKPN90baeSCRy8cUXf/TRR5zP9HU8zxNCjBw5MpVKZV+Y5UaMJhKJESNGBAKBnFiD8xOdtPTmm28+/PDDutlurkeUG3QvLtd1r7jiilgsBu0ijNEVRocNG1ZdXW3bdoZeHBKGmarZZDRtNaQA4pexE4AISilVv15sf1yF/9QIgBA8IgpGpBUiUlzdifm+KKUMwwCAc889d/369ZwpuxN6Txk9enQwGMz+ncmBGNVqY9SoUdm/dN6iD2319fXXXXddKBTyufzyPK+4uHju3Ll33nknrxdpEJGIunbtetBBB2XMU0+AUjqxJnfbajJN9FNTn86LTt/xGrYSEfmoAgKC8oxQ1AxGSLFNi9kVdIjgli1bLrjgglQqpd33uR5UvqD3lAMOOKB3794Zykz4PlfP5sUAABFt266urh46dCi0G3sY7aD/4x//uHr16lAoxPLLcZyKiooHHnhgwYIFrEfTaL/SyJEjHcfJ1EpBKMCzvY3LDJD+cPkWAIQonJZ6y0sCCL9k8xAiKEcE2ZvG7A6u65aVlb3//vs333wzR4LtSDoz4ZBDDslgZsJ3JOthAe1Fnbp27arNgVkeQB6iHfSzZs164oknysvLfeug3wkdW3z99dezEk2j35dhw4ZFIpFMraFISgnT2/yl4SQI+XDYGSBCKd3mekjGEH0Sc08ICOB5MiADIeA1gdkNHMeprKy89957uc3KTmg78ciRI7Mvz3JgGXUc58gjj4R2Mw+jjyO///3vdaGvXA8nX9AN2adOnfriiy8KIXi2QLsbZdCgQb17985UjDmBEoaVrNsoYvUouEl9JwEF2G3o2b4JnURCpRRI0wxGij0iQPRDsCzTcZimec011zQ1NekIqFwPJy/Qe8oPfvCDkpKSLNvFsi1GPc8LhULDhg0DLuoEAO35a6+88sqMGTOKi4tZcu2IUioUCv35z39ua2vj9QLazy2hUOjggw/OWEwPoRDSa6ujhk1kGpyn3DlAoZykSraBkP46PiCCsMT2Sv+++uZMJlFKRaPRZcuW/fGPfxRCsP9No/eUPn366ILW2fTUZ1WM6oDRbt26DRo0CLioU3veUjwev/POO4PBIIutnVBKhcPhJUuWPPbYY7xeaPQkGTZsmFIqQ8c5RCEolaAtK6QweA52AohQCC8Zo3gzCt/EjOpi94ieEUBQSH7fPpjdRGcmPProozNnzuTgUY22d5imefDBB2e5wFN2A1SFSCaTgwYNKikpydxW2onRZtF//vOfn3/+eSQSYbH1dXRbpgcffLChoUFX5c31iHKMXh0OPfTQaDSaETeKQoUECqRds9LkGdhJIARBZJCTq8YluYIAbRCE5IvGU0wHo7XXjTfeyDFyafQme/jhh2e51EC2LaOu6x522GHQ3jHWz+gSV7FY7MEHHwyHw3xDvhEiCgaDa9aseeKJJ7hhPbS7Ufbdd9+ePXtmpNqoICBQKKRTsw7dOGw/CvtL4nQ6EJAUeKlW4RuzKAAAEAGiEdhea9Vf353JPJ7nlZSUzJgx41//+hdnJmi0vePAAw/McuedrG45SqlAIHDIIYcAB4wC6KPYK6+8smTJEjaLfgu62MSTTz7Z0tLCxlGtyIPB4MCBAzMU04MEIKTh1tdgWx1JA4B80mGy84KInmc7zU0g/fRGECBiuLjIP9+Y6Wj0cnr33XfH43HeX6Bdm/Xt27d79+62bWfNU589Marz6KuqqgYMGAAcMAoghHBd9/HHHw8EAqxEvwUiCoVCK1eufPnll9k4Cu1ehUMOOSRTriUkImmoWAM2bpHC5Gqj+Q8BKFDtYRU+O9hvn56cTc9kAKVUJBJZtGjRM888o732uR5RjtGbbDgc3m+//VKpVNbshlkVo6lUau+99+YKo9AeLTpt2rRPP/00Go2ywPp2lFKWZT355JOO4/AxRr87Bx54YIaathEBogDPTbn16w30meO3s4IIylCOfwUZ+vabMxlGl215+OGHE4mElJKNo3pbOeCAA7LZsD2LqVJC2LY9ePBgNm5Bu554+umn+VZ8F/Thdf78+R9++CEfXrUc79+/f0VFRaZaMSEAEaiadSQAiYg3+rwHAZRyfLlt+tuSwWQavb8sWbLk3//+N+sTaNcnBxxwgGmaWZPm2TYyDRkyBNrTtXyLbv65Zs2aadOmFRUV8dT/LmgN+uyzz+Z6ILlHl1ytrq7ee++9M+VGIe2dqd0EKkW81+c9CESAgJIfFcPsPtr59thjj2mnZa6Hk2PSabLFxcVZM45m76Z7nhcOhwcOHAi+DxjV6vOll16qq6vL5smjU6NrFE+ZMmXTpk3sSdGV0fr375+xuAUiFEaqZbMVj5EwBPEBKW/RGwMRCO6YxTAZQRtHP/30048++oidb1p99ujRo1u3bhmp2fJdyJIo1NlLlZWV++yzD/g+lV5K6brum2++maGYP19ARJZlbd269a233gLf95LVWnzQoEEZmz8EYBiqtR5jDSAlIZdxzFsIAUBIAJEEgQCsRxlm9xFCOI7zzDPP5HoguUfHKgQCgX322acAxaht23vttVdFRYXPs5d0BvT8+fMXLVrEFZ2+F0RkmuYbb7wBAFLKXA8nl+g3qH///pkrxUAopJuIey3bhJCK5U3+oRAAUQpS5HltbQI8o7hMKY6qYJgMoBusTJ48efPmzex809tK//79C81Nry2jffv25ehgPcXfeuutRCLh83CF74uuNzF37tyVK1f6fCKlOwiXlJRkbrFAcm1o2iJRT0tfr8X5BSIKKQmVnbATCSNQXHLIsV3Pvw/6DPXsFKCvD2YMkxG0823Lli2TJk0C3zvfNP37989a7dXsiVGlVL9+/cD32UuGYTiOM3XqVPbRf1+0ZbShoWHy5Mng7yZeWn1WV1dXV1dnLKEekcjzmrYgV3fKGQoACbC96YBAlCSk5zluvAU8N9LzgIqTryq97FFj/B2J/sPjMiCJt0yGyQx6i3nttdeAnW/t9o6sCZUsiVEiMgxj3333BX8HjOqHumTJkmXLloVCIT/LqV1DLxZTp04Ff6fBpfsw9ezZM1NiVLe3UfVbUCmu4ZgLEEkCKEGAIEgYSK6baqVEW7C4quzIH1dc+ED4ggfUERclSromUm0qlZCKFD8ohskQOs167ty5q1at8rnzTW+vPXr0KC4uzlR3lW/H6OgLaPQz3nvvvcH3YlQIMX369La2tqqqKtd1cz2iToauTjx//vytW7dWV1f7Of5Yz6V99tknc256AhRua0PYS2QpZJ35DxQJFCAJwXFcdGIQLirqPyI06Cixzw/s0q4JT3mOh4lmiQQoOY6CYTKOaZp1dXXTpk3r06ePXmNzPaJcUlVV1bVr15UrVxqG0dE+7WzcaER0XbesrGyPPfYAf4tRPbM/+OADrui0a6Rz6j/99FPwt6de06dPn0xNJAICadgttZBsJcFaJ7ugECjJQzsZIzse7tKzbMxFZZc8GDj3DvugH7WGuzjxONk2ogcSlRDtfnyGYTIJEUkp2fmWTqjv3r274zhZuGI2LKM6e6m6urq8vDwLl8tbiEgIUVdXt2jRIvbR7zK6CNyHH3548skn53osuUQf6nr37p2xgw0BosBkCybjIlAOxGb7DoQQAZQgQUKg8lQqbpOyisqLBx5hDRxNvQ/1IuUpx6VUEqBVCgSBClEoAhCERHxUYJgOIO18q6+v93nxH20Y7tGjR3YS6rMkRl3X7d69uxDCz3ZvpZSU8vPPP9+2bRv3o99l9HFtzpw5+n7mejg5Q68O3bt3D4VCmUr8RCmdZJsXa8LyvZTn31W4o0EgBIlAnrJV0hVmINRzYGjASKP/cLeiV1KgslMQb0UEEAIAtfBEIkKA7TZRfjQMk3m0823z5s3z588fM2aMz3cZAOjVqxdkxaGdJTHqeV7Pnj3B36n0+rvPmTMnlUoVFxezGN01iCgQCKxevXrTpk09evTw7fEmnVBfVlbW0NCQCfsoASB4SsYbkHVoB4GIKJRyVSqOCqyK6mi/Q8yBY1SPQXawKOGmyE5KAImgfDmrGSbnCCFs2/7kk0/GjBnjZ8Wi6datW3Z2gywlMBFRjx49wN9iVGum+fPnZyEWuIDRCfX19fWLFi3q0aOHz+9kWVlZRUVFbW2tZVm7fysQwXMdt2mbEMIjrqa+myCAQkACBAAUAASeayvHtoLRaL9DzcHHGPsMdUu7x0kpOwmJNoEIKJC4GSvD5Azdp37u3Lng+7BRAOjRo4dlWVmwnWVDjOqI4G7duoGPs5d0wGg8Hl++fHnmuub4FB2FvGDBghNOOMG3YhQRdcW0rl27Ll68OBQK7f5nEiKCJ+yYC8jVnXaZ9laqSIiASCDRtVXS9iSGuvaI9B8pBxwN1X1tI5hyUpRsRUCJRFquAikUyCGhDJMjtPNt+fLlPg8b1d+6qqoqO6VGsyRGLcvac889wd9iFBHXrl27ZcuWjBix/IwWYYsWLQJ/n1x1PFPXrl0zVgeOAAASDdtMUB6HJe4qCAIQEJVQ6NpJdFOyuCow4KjQ/iNx70PdovK466KdIqcNEREFAKjtNxsBgJUow+QQ7XzbunXr8uXLjzjiCN+Gjeo9pbKysqSkJEORYN9GNsSo53mhUKiysjIL18pb9FP88ssvW1tby8rKuNXY7qCPNytXrkylUoFAwLcnVz2punXrlqk7gISEaNhxQ7lcanTX0OKSPNt2UtIIRLr3DwwYbew3TFX1TIHpOQ4kWhEECBSEhMgltBgm35BSJpPJJUuWHHHEET63HBUVFUWj0draWtM0O/RCHS5GdfZSUVFRWVkZ+NsyCgBffPFFdpoZFDb65Lply5YtW7b06tXLt2JUU1VVlcHlElG6bY2m64KPb+l3J60lEQBReqQ8O45KBUq7FO17hDXoGNF9UCpUFHNcSKYE2AKFEpIIEQgBCFiMMkyesnTpUvCxaNFfPBgMVlVV6ZZUndsyqus6lZeXFxcXd/S18hn9XFesWCGl9PlJa/fRbvrm5uZ169ZpMZrrEeUGPan22GOPzE0qBSi9eBN5DqIfPVPfFwIkYRjk2K5DTswMRKN9Dg0MHGX2HZoq2ytBpOwkxtsQEUR7JhOBFqDq/+o0MQyTRyilTNNcsWIF+D4STAhRWlqaBSNaltz0kUgkEAiAjw8ZWi6sXbuWey9lBF19Y/Xq1SNHjvT5/SwtLc2UGCUAQDCUYyo3aZhAHDj6X0EUgEiup1LNjoBg5d6R/keaA0d43fZLGZGEncREGyEJlODjzYxhOiPa+bZhw4Z4PB4Oh33rfNPbSnl5eSEkMOmmUlVVVdCusjv6inmInspNTU1bt25lMZpB1q5dm+sh5JJ0gHkGU+IQpZNotVMxMCOgPNaiO4MIKICUZyfAc2S0pLj/6MDA0aLPQXZRRdwR5CTAbhYoSRgGeYrd8AzTCTFNs7a2dtu2bb179/atGNV06dIlC3cgS5ZRHTDqWxGmH2RtbW1TU5M/8/Iyji6V9dVXX4GPze2akpKSUCjkOI4QYndfMQIUwraTUTsGQoJn+94ySgQoSCihEAHIAC/lOilDmpFu/a0Bw839hlNVn4QwlZ3CWBIREIHQJCAAz9terYlhmM6ErkfZ2tq6efNmLUZzPaLcoL94UVFRFu5ANiyjRBSNRjv6QvmMfpBbt26NxWKRSISLjO4+erHYsmUL+DimR6vwcDhsWVYqlcrQfSBJYHpOwvc6FAAUCkkIUqECSqVIxc2yLsV9hgYGjfJ6D3YDFXHHUXZSUEoIBIGwXXumO3b6dA9jmM6Orma9ceNG8LEdTVNSUpKFq2Spzqh20/v8iW7bts1xHJ+b8TKIYRh1dXU+r+4EAJFIJBwONzc3Z+CzkAiAyAPXFj69nWkQBZqErpfwko4RCIf2OSA8cKToN9wp7xkjIDuO8WZAIbQ5lGGYAkJHGG7evDnXA8kleletqKjIQuJ1lnrT+zyVXj/FLVu2cF2nTJFOqG9tbdW5cb4lGAwWFxdv3LgxI6U3ENFzbLutBYUgKnzraNp6+X/fFQUiKs/1EklACFT1LOv3AzloNOy5v21GPScOiRZCKQFISAXINeoZpiAhIu188zmRSCQL7scs9aYPh8PZuVA+U1tbm+shFBRCiNbW1qampsrKSn9aRvVXNgxD24Yz8IEKQAhSHrgJgMIPflAoRHvFAAFEwhTKcZwkuI4ZKYn2PSwwaKToc7hd1MX2XLJt8JoRBAqJQFqGckwowxQkOi1h27Zt4Pu0hFAo1NFFRoHFaHbQU7m5udm30Y0ZR6tP13VbW1tzPZZcou9DMBjMTGknBEJAAEN5jg9UliSPUAAIAaRcclMtwpDh6n3D+w+XA0a6Xfd2wHQcWySaAQxEoQU6AWj9SgVvN2YYHyOlbGlpAd+L0WAwmIU70OFiVB8vfJ7ApKmtrc3C8cI/CCFisVhjYyP4OBxZi1HLspRSmVgvCAFBkfDcwhdaiITCIzSTLQ4Js6yibO+jgoOOod5DUqHypOuJVAwoJYRBGJTkEfh1kjGM/9A5svX19eBjMaq/eDQasazMON++hWyIUcMwIpEI+P6JtrW1sWU0g+hOs01NTbkeSC7RC0RJSUlGSzQQuakCCxfVsaEKQQKgEAoQnSTZCRkoDux9cMnAo819h9vl3WOAZCch0YoAhJJQCnAA0EPBsaEM4ysQMRaLOY6jq4P7VsAEAkHTNGh7DkFHLYNZSmAyTTMLF8pb9CROJpNsGc0sRJRIJHI9ityTufcLdVki3B5JWThzVQkSIAwkAuUmkiaRqOoe2feIwMCjvB6DXSOSdGxIxVG/rbj90IjgEQgAYCXKML5CO3Vt27Zt2+cCxrIsKQ3bTkkpO06/ZMlN7/NnqcVo5ipBMttJi1GfS/xMxYzCdjWqYvG2AssSlwS2m7ITiWCwtGS/gwKDRou+h9kle8RcpZwUuq0CkJBfT4ZhtoOItm27rpvrgeQYRFEIMaOMhohc1/Wtnb8j0DfTcZxcDyT3ZO6Qg1qO2qlEQZXLQnSBAhU9Ko65MHjQWNWlb8owPTuJsVZENMB0BSkALCT1zTDM7qFzZFmMimxo0ayIUSllMBgEv8aM6lgT27ZbWloy0LCR+U9YjGYaAQSIspBiRgWA7XjBsVeJYFGbq8BJoG0LBBISADx0BRXOl2UYJiPoHNm0882HAkZ/5UAgYBgmUcdGxGXJMurDp8hkAaWUzxOYMk3hnpQQE2BCPIYIgCIdBEoAyEqUYRgmp7CbnunccBgu8x1BIODZwjAMk3/w0sx0bjJa0ohhGIZhmGyTDTHKUZIAQER8HzIOIhYVFeV6FAzDMExhojdun4caZuHbZ0OMKqWSyST4VZXqSWxZVjQazVCbHGY7uhNmrkfBMAzDFBpKqVAo5OctRmu2VMrOQi2gLLnp/SlDd0QIEQgE2KecQfSk8nkJW03G3y9+YRmG8TlEZFkWbzFKKaU6fEfIkpve87wsXChv0Vu7ZVm5HkihwZZRjW7ulaEPI0A0DLOQM+uZzgkhARACEBDx/GQ6GCIyTdMw/J7nTURZ2A46XIwiolIqlUp19IXyGS1Gg8Egu+kzCyKGQiHwfUBPBssyExCijBYVs3GUyR+QQBAIEgioAAEQuUcB05Ho3t2WZbEVybZTrut2dOGabIhR13Xj8Tj42Penv3gkEmE3fWYRQpSUlOR6FLlEq/CmpqZMrRQIAIDkb3HP5BtKkAIARQoIBCAJJCygtgxMPqKUCofDpmn6s+J9Gtu2Pc/T6rzjrpIly2hra2tHXyj/qays9K0c7wiUUsFgsKysLNcDySV6ibRtO0MrBemTkzQsnqlMfkBACjzlSQPDkbAUhp0gdBWC4DnKdBiI6HleRUVFR4uwfEZ/8VgslkqlOlqOZykYQmfT+xb9REtLS9lNn0GUUqZpRqNR8LGbXi+UyWQyQ5ZRBEBAIGEiB+UxuQBBEBCA/pciIdEKBgXKlm20enbLkg9j6xbKYISU3zuGMx2NUqq4uBh87NTVJBKJLNyBLIlR7ab3ORUVFbkeQuGgj63RaNTPllHtPHJdN3PHVgQAAnSkkf4tw2QTAo+ICIQUQWkZ0m011821l81oWD7TrVsHBMIKA0rksxLTwSilqqqqgMVoIpEFO1qWxGhLS0t2LpSf6Ke45557Sil9Pq0ziOd5paWl+uTqW8soAKRSqdbW1gxNLQJAROHJABJxz3Ymq5AiAhRSBCIBsEXjGvfLWanFHzZs/NKzY4YRkMEiAgTlcakHpqPRTqc999wz1wPJPfF4PAvpLtkQo0RUV1eXhQvlOV26dDEMg8VoRtAWwYqKCl3ayc9iNB6Px2KxjLjpCZBISdMKREvjnGzHdAy0PRMeYbs7HpE8DwWaYdMQRrwBv5jpLJ4aWz3fbq4FKYQZMsMRIiKlkHUokxWISAixxx575HoguUTLlYaGBp3A1KHX6nAxqp+oTmDyrWLQX3yPPfYIh8Oe5wkhWJLuJlqM6pVCKdXRVSfyE+2mj8Vitm1n5g4gCUUgTWFaCjhdmck8SBLQRRKEQKQEKWUEhRkJe0m5dam9bHrzF584W9eAl0IraoSLgIBIUXvNbV43meyg6zp1794dfCxdNE1NTVm4SjYso0II/WV8+0T1F6+qqiopKamvr/encsosukrDXnvtBT4Wo5rW1tZkMpkRo/v2uk6Ajgjwvs90BISeUKAIAJW0QlJKo2kTrZyTWPJBct1CL94mTGGYITcQRuURm+eZXKBzEiKRiHbT+1y6tLa2ZuEOZMMyKqWsra0F3z/R8vLy6urqrVu3WpbFltHdh4h69+6d61HkEj2L6urqkslkUVFRBiYVgSIwLUOZYSDWAUxmISByUZiGKcxAIBmDNbPtpR+0LJ9lN2wGQAiERCRKBB4BkCeIlE93DCb3uK7btWvX6upq8LF00dTW1mahvlU2LKNSyra2Ntu2tQjz53P1PE9K2bNnz3nz5vnzDmQWpZRlWXvvvTf4fqVoamrKWEAPAinXCpXIcJiU8vd9ZXYXQkAiAIFEijySlrSCUXJE3Tr3y+nxxTMSW1Z5TkKYYQiVIHigABQgKAFKESqUAB17IiJS+t3x+RrC7AQi2rbdvXt3fcj37fTQXzw77twsWUYbGhpaWloqKys7+nJ5iz5V9OvXz3Vd387sTKF9KMXFxdoy6tv7qSfV1q1bMxddjkjKQSuIXDmH2V0MBR4pT6BhBQLSMNrq1Ir3k4s+SK7+zG2rV4ZhmEHDLCFS8H9FQwkA1PZuLB2oRHWcj2VZUkoA8DwPAIQQvl1MmB3ROQl9+/YFAKWUniQ+RL8Ozc3NWSgElD3LaFNTk25B5Oe3vX///py9lBEcx+nWrVu3bt3Ax2JUs23btsx9GCpQRqSIZBCV4jqjzC5BQKQAyLBMIxJ042LjQmfZ9JYvPknVfKXIRStihItoO14OxkdkGEZDQ8Npp512xhlnjB07VntjAUCf6/wcg85A+1ll//33Bx8XGdVqLZVK1dTUFIIY1dn0yWSyrq6uT58+vn2uenXbb7/9uEP97iOEsG27T58+oVDIz9lLWoVv3rw5UyccRFCKzKIyMCxIJQB9emOZ7wLpbl07mtC1vJRSWMEgktmwkVbMii+ZFt+wTCVjYAREICpQISlP5cVBZ/r06VOnTu3evfuxxx57+umnjxgxQpeKIyK9sPj8oOtblFKBQGDgwIHge2NHa2trW1tbFmzDWcqmTyaTW7ZsycK18hY9offee+/q6uotW7ZwDtPugIiO4+iVws9iVH/xrVu3ZmqlIEKDPNcMkjCREnmhF5h8RRIQkkKQCog8hYhGKGAKmWjBFZ+mFr/fumqu3bQVUQorYISKPAAgRygkRASPIPebfFFRESI2NTU99dRT//znP/fff/9TTjnl1FNPHTRokH6ndFQVq1JfofeXLl269O/fH9qXWR+iLaP19fVNTU1ZKJGepQ5MSqnNmzeDjy3eOhmtuLi4b9++69atCwaDOkqJ2QV0IPJBBx0E/j626tjZmpqajK0UiEAQKKt2MvBZTCGzvQoYecID1zRNMxLwbFmz3Pni4/jSD5NbVtrKNsygEYoSAZBS2zPjkXTH2TxQogCgnVSGYZSXlxPR8uXLb7755vvvv//www8//fTTf/jDH3bt2lX/pOu6Qgjf6hJfoX3Tffr06dq1q58DC3es1hIKhQpBjGodtn79+ixcK5/xPM8wjIMOOujtt9/27fzefXRoeVlZ2eDBg8HHYlSvkk1NTXV1dZkSowikELxgGQARR4wy/w0ij4iENMyIISHUvM1bNiex+IPkms+9tmYwBQZCQQoooE5RKJSItGkgFApFIhHXdadOnfree+/16NHjuOOOGz9+/IgRIyzLAgCllA488+2y4wd0GNihhx6q9xrDyJLNLt/Qe8rGjRtTqVQkEulo81mW2oFKKb/66ivwscUb2mXT0KFDTdP0rYV499HH1r59+/bs2RN8PKO0GK2pqWlsbMyUGCUiYZiBksoE13XyPYSEJJCAkBCAAAEUKI9QorQs0zScNlw/11k8vXn5TLtuAwBBICQixUjkEXjbM5M60zRSSmlbaUlJCQA0NjY+/vjjEyZMGDhwoHbfDxgwQP8kZ98XMFqxDBs2DHxs7EizadOm7JiHsyRGTdPcuHGjPlNm4Yr5iX6cBx54YFVVVSwWy0J6WkGiQ5APOeQQwzB09dZcjyg3pI+t8Xi8qKgoM1lxRCRMFSlWPDN9j1RCIQB6BBJIAblKBoxQxCDPrN/gLf8wseyD5Prljp2SpsRgBACACJRHgAI6t2Fda820+37ZsmWfffbZfffdl3bfd+nSJf2TnH1fSOgKo127dj300EPBx8YOaFcs69atg6wEWGZPjG7durWpqamsrMy3QRg65XnPPfccMGDAjBkzMtMyx3/oI81RRx0FPg5BhvbvvnbtWsdxhBCZEKMIypWhIoiUK6WEL19SJo1CRHA8EgiEpmXIgBWv81Z/nFw8tXXlp05LE0lpGaYMFyO5/9mvq0DeyrT7PhwOR6NR13WnTJny7rvv9uzZc8yYMaeffvrw4cNN04R2k6qU0p9bWyEhhEgkEsOHD6+urvatVtHo775hw4bsBCpkKRjCMIzGxsatW7f6WYxCe9joiBEjpk6dmiEB4Tscx6msrBw6dCj4+9iqWb16dcY+C4GUEoEwBEtReUhAPn1NGdCmUJCmCBaF3VbYutxeOqP5iw9T29aA51AgguGoAM9TIDybCr0E2E7u+7q6uscee2zChAmDBg3S7vv99ttPr0Xsvu/s6FT60aNHQ/t+nesR5QZt9HEcR4vRwrGMSimbm5vXrl273377+dmapVeoo48+OhgMshLdBaSUsVhs6NChPXv29HNRJ2gX4qtXr85UvAcCeuTJkkoKhIEnp79ABCIEIgKlSBgyELEQRPMmtejtxJIP4l8t8mJNwgyhFUIMEiF6LgAqREAC8Et/BK01TdPU7vslS5bMnTv33nvvPeKII7T7Pt1lkLPvOymu65aUlBx77LHAxg6Aurq6bdu2ZSfLJUuqX582VqxYMXbsWD+LUT25DzrooL59+65atUrXbM/1oDoTOqBHH1v9LEbTx9Z169ZlbKVAQKXMaCUZFqRSxKYdH6GIFCiBZtAISivZjKs/Sy6bnvhittOwyRPSMC0RKQNSQDqcmPT0wE4eG7pr7OS+dxznvffee/vtt3v27Hn88ceffvrpw4YNS7vvOfu+EyGEaGtr+8EPfqCtZr7dX6A9QXbjxo3Nzc3ZKYuePRO0EGL58uVZu1x+ogtDBoPBo48+evHixdyN6fvium5xcfHxxx8P/s5z1CvFtm3bMttAgRTJsm6eFECKhED/Hht9AxERgTQxGAgqV9Sucb78uGXJh87mL8mOq0BUhIoN9EARKK6LvDPafS+ESLvvH3nkkaeeemrw4MHjxo0bN26crpoO7L7vJOiiTieffLIQws9FnaA9J2H16tXxeDw7ZdGzdK91DtPKlSsBwLfpzzty0kknPfzww6xEvxf62HrYYYcNGDBAx37kekQ5Q68Ua9asaWxszNSRhgBQoCjfQ8cA+tiBUcAgABECEpEiQiHNgGlIEauXX75vL57WsvZz1VqH0kQzCJFSQQrJAdJ1nZhvJm0oTbvvFy9ePHfu3HvuuefII48cP3788ccfz+77/Ef7bysqKsaNGwe+99HrLebLL79USmXnBJW9DkyWZa1du7ahoUG/rr49IOoIvyOOOGLfffdlT/33QgiRSqX42Ao7rBSpVCoajWbqQ4U0sbSa/BIB6BcQQCEI0vPGIxIoLTNgGm5CbF7sLn0/tmxWsvYrIButiAyXAJEChcoDAAIk3ZiL+V983X3/zjvvTJw4sVevXmn3vV612H2fhwghWlpaxo0b17t3bz/HgGn011++fHnWalBm1TJaW1u7bt06n4tRANCe+pNPPvlPf/oTe+q/I3xs3RH9+ixevDhz7xGS8kSwWJZ0Ic8VBVOehwEAAKHQAw8ESjMSRGHVr/dWzowvfT+x/gsvEReWKQMhwjAoRcqD/zyMsBL9vmj3PSJq931tbe3DDz+cdt+fcsop7L7PW8477zzwd9FAjbb4rFy5MjsBowCQvR1dCBGPx5cuXQq+f9JaSJ1xxhnFxcWu6+Z6OJ0D7aMfMWLEPvvsw8dW/fWXLVuWuewlBM81istVtIKUq+1oTOeHQCmPEGQgFCwKKRVc8ZF65fd1j11S89rdiZXzCUhGQ2hInUfPZ5DM4nme53nafR8OhxctWvS73/1u+PDhP/rRj55//vm6ujoppa5O6rouWyVyiBAiFosNGTLk2GOP9XnqEgDoqbhx48aNGzcGAoGCsoxCe4f6RYsWAYtRIZRSAwcOHD58+OTJk0tKSrIQHVwAENG5554L/s6jh/bspbq6ujVr1mTq2IoInlJWSaUKFAEfkDoZ2C4it/8CCQkUgQJhyVAg6NmidoX6Ynrbkg/trWs81xGWJcMRJCJC2L74IMJ2v3zuvkhh8nX3/aRJk956662ePXuOHTt2/PjTjzzy/9z3XDw/J+ha9xdccEEgEPBzYz+N3lOWL1/e1NSUsfZ+/4vsiVGllGmaCxcuBM5hapdTP/3pT999991cj6UToM3qAwcOPO6448D380dvV8uXL6+pqQmHw7u/Umwv0KM8s7KHMgLg2ICSnbOdBQIURICgEA1PuagUGoYZklIYLVtx6ZzYkunJdQvc1gYwg9IMGJYFikgp+o/aTIplaEezU/Z9bW3tgw8++MQTTw4ZcsCPfjTu5JNP7tevX7p4PncZzRqImEgk+vbte9ZZZ7FZFNrF6KJFi2zbzlp3nuyJUSIKBAKrVq2qr6+vqKjwedioDgo+4YQTBg0atGLFCk5j+na0GP3JT34SCoX42KpXigULFiSTyWg0upszB0ERCAKBoKBqbwVokPLQRGCnbedAkiJdoomUa1qGGbZSzfjVp6mlM1q+nGXXbQAACgRlpBQVECmfO6Zyzo7Z95WVlUqpzz//bM6cWXfdddfw4cNPP/30MWPGlJeX6x/m7PssIKVsa2u79NJLy8rKfJ4aq9Ha7PPPP89a9hJkWYxalrVt27YvvvjiyCOP1NadrF0939BBQqFQ6Pzzz7/66qs5jelbQMRUKtWjR49zzz2Xj63QvlLMnz9fh77s/ucRCkGOMiNYuZenPAGSlWgngYDIIyBpGGYwQMpsWOct/yS2dHpswwq029C0MBQBQKk8pZQCHxsA8g8i0jkDkUikqKjIcZyJEye++eabvXv3Pv74488444zDDz+cs+87mrRZ9IILLvC5LNHosompVGrp0qVZCxiFbCYwAYAQIplMzp8/H3wfNgrtxtFzzz13n332SSQSvMr8N6SULS0tP/nJT7p06ZK1mmd5i14pbNtZtGhxMJiBlUILFHQdGSkxSvckz1ECWYnmIQgAiASE2i+vPBcEmEEzHA2rWHDZFPelG+se/X81b90XX7dQCmWEitAIkvJAuQoEAOioUCbfUEppC2hJSUlZWdnWrVsfeuih448/fuTIkX/5y19Wr14thNCBpJ7nsdkis2iz6FVXXVVWVsb7C+xQ7n79+vWBQCBr8y2rYlSf7ebMmQP+bp+jQUSlVFlZ2c9+9rO2tjY+kH0juv/nHnvscfnll/s8tEOTXinWrVsbCAQzETCKhOQoZZVWekXl4LmsRPMTBYBE0hMeKccwZaioWGJ4yzKc/PfWRy6vee765s/f8hKtRigqrDAAKlJAHgLqSqMAkOUFn/leaPe953mWZVVUVASDwfnz5//6178eNmzY+PHjX3755cbGRillOqiUVenuo4u0HHzwwRdeeCGbRTV6Xi1cuLClpSWbNySrsRFKqWAwuHDhwlgsFolEWFsIIYjokksueeKJJ7Zu3Zq1gl6dCCllQ0PDlVde2a1bN44WhfbUt3nz5jU3N5eXl+9+HQYkQEDleVbVPp4VgWQMkCVL/kFKEHnCxFAghCCat9GqmbFF7ye/WuwmmqW0hBkFQUCKWKN0cnZy39u2/eabb77xxhv77LPPD3/4w9NPP/3www/XKyG773cTXb761ltv1R0vOQYM2g2Fs2fPzrIaybZlNBAIrF+/nquNatLG0WuuuYaNo18HEZPJZK9eva688ko+umj0TZg5cyZAZgIACQlICFDUrQ+B4DageQDRdnMmIBCRUkRkBEW4JAqp8OrZ6vVbmx+5sO7l2+LLZxN5RrgYLZPQReXy4ysk0u770tLSsrKyzZs3//Wvfx0zZsxRRx113333rVmzht33u4NhGA0NDWedddbxxx/Plo40UkrP8+bOnZvNgFHIvtdGShmLxWbNmgXt1mCfo+smXHDBBQcffHBbWxufzHZEStna2nrttddWVVX5vLZoGimlbdt6pVAqIysFERGYQbNLL49DpnIHAgIIHTaBgIIcIuWhIYPRUCAYrV9jzni87Ymr65++pm72605rvQxGMBRGaF9JuYN8gbKj+76ysjIYDM6bN++666474ogjzjjjjJdffrm5uZnd998XncGy55573nbbbWzpSKMnz7p161atWhUMBgtZjBKRYRiffPIJ+L6jo0YnRAeDwT/+8Y+O4/ArkUYI0draethhh/3sZz9jJarRK8WXX365evXKYDADAaMAAIBKuVZRiSjv5Xkut6XPFQQKwUMliIjAU1bUDBVHnObAknecF35b/+hlNW//LblxIZnSDJVIYREpUIoACLR+ZQoc7b4nokgkUllZadv266+/fvbZZ//gBz/45S9/OXPmTJ3dqA0cnuex7/FbQMS2tra77rqre/fuvL+k0XvKp59+2tDQYBhGIYtRpVQoFJo/f35jY6OOmMzyAPIQbRUfO3bs6aef3tjYyEXO0hDR7bffrp0FLNOhfaWYOXNmS0trpuYJogA3JSp7qWgX8Bwu/pMjiAhBEUiASHFIysjGhfj2Pa2P/L+65/7QvHiy59hWsISsIukJIttFXjn9y07u+02bNj3wwAPafX///fez+/5/YppmXV3dhRde+OMf/9h1XXbQp9H77IwZMyDr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veOOOzZv3qzL62byw9Ek140ceKwdKROex5lLDMMw/kEr0fXr1991110lJSV5K6XyV4wCgBAilUrdeOONbBllCpV0huPTTz9dVlaW4QxHRHKTgbI9zEHH244NmF+1PBiGYZgORRs7brzxxpqaGsuy8lZN5bUY1ZGj77777ksvvcTGUaYg0SVdb7jhBsdxMp/hiELZiciBY+yy7uC4AvPRO8MwDMN0BK7rSinfeeedF198sby8PN/KOe1IXotRaM+sv+mmmxobGzl4lCkwdI+xCRMmTJ06tUMcKK5jFFeZB51kuymJoPL+fWcYhmEygraJNjc3/+pXv8rbvKU0+b456W71K1asuO2224QQbBxlCgYdyrNt27Y//vGP0Wg083NbSJVKFg0c4VTtTY5NHCzKMAzjG3QM2J/+9Kdly5ZFIpH8zFtKk+9iFABc162oqHj44Ydnz55tGAbrUaYw0MfWP/zhDxs3bgwGgxnOWwJBnmdEiwOHnWZ7ntjeNyuvT8YMwzBMRtButxkzZjz44IMVFRX57KDXdAIxCgCIqJS69tprbdsGgDy3NjPM/0SvFO+9916H5C0BSEEqFYsOPsbec3+wk8BNXBmGYfxB2kF/5ZVX5mGzpW+kc4zS87yioqJZs2bdfffdnMnEdHbSK8W1115rmmZHXMJVSoZLQ4eNd1yXhSjDMIx/0F1Ufve73y1dujT/HfSaziFGAcDzvLKysjvvvHP+/PmGYXSKm8sw34heKf7whz988cUXHbJSCEnJePGQ0ak99yU7BdhpXnOGYRhmd3Bd1zCMV1555dFHH+0UDnpNp9mliEhK6TjOVVddlUqliIid9UxnxPM8wzDee++9Rx55pGNqbSB5biBaHhh2ZsLzBAIXumcYhvEDSinDML766qurr746s52lO5pOI0YBwPO84uLimTNn3n777eysZzojRCSEqK+vv+qqqzrIQY9CqFQ8cuhJTpc+0o4TIuctMQzDFDzaSOe67iWXXFJbW5vxfn4dSmcSowDgum55efk999wzY8YMzqxnOh2e5yHitddeu2rVqg45tiIqNxEo3TM49NSUrVsusVmUYRim8NF5sTfddNOUKVNKS0s7l0DqZGIUABARES+77LK6ujqdZZ/rETHMd0KH8jz99NPPPvtsRzjoBSGgQbZdNOzURHkvcB1AYLMowzBMwaP3l3//+9933313JwoVTdP5xKhSKhKJrFy58uqrrxZCsBhlOgU6VHTp0qXXXXddcXFxR8xbT6JyWoN77GsefKqdSiBn0TMMw/gAvb8sW7bs8ssvD4fDuR7OrtD5xCi0l8F/4YUX/vGPfxiG0elOAIzf0IE7sVjs4osvjsVime7MhgQAQAiALhSNODMeqRCey7VFGYZhCh7dzK+pqemcc85pbW21LKszGuk6pRgFAM/zSktLf/vb386aNYuDR5k8x3VdKeWvfvWr2bNnZ7YHPYIiEAKIhOElY5E+B4tBxzupOApWogzDMAUOtXPRRRctXry4qKiok8qhzipGdaUnz/MuvPDCmpoaKWVnPAowfsB1XdM0H3/88UceeaSqqspxnAx+OIFAcAQhERqGGR19YasRlqQ4b4lhGKbg0UlLv/71r1999dXOGCqaprOKUQDwPC8Siaxevfriiy/2PE8p1YmqGDA+QYfyzJ49+9prr82sTbQdRJCuITDRED3kZLf3UJFsATQUi1GGYZiCRictPfDAA/fee2+XLl06rxKFTi1GAcB13bKysjfffPP3v/89O+uZfEMpJaXcvHnzeeedp3/dAeclIhQilZIVewWP+knCTQGaCEoAOwoYhmEKFsdxDMN4+eWXf/Ob35SXl3d2/dO5xSgAuK5bVVV11113Pf3004ZhZNYHyjC7jNadqVTqvPPOW7duXYc1w1CAwvPcsqN/kirpCY4NSARAbBllGIYpUHT019SpUy+88EKdPt/ZPcOdXowCgFKqtLT0yiuvnDFjhmmandpSzRQGRKQb0P/85z9///33O6btJwAACqkSzUX9foAHjkvZcRSyI67CMAzD5AnaOz9v3rxzzjlHCNExPrdsUwhiVLdYRMRzzjln+fLl7K9nco4OFb3tttueeOKJjCct7QAqT4lQcXTMxTFhGoqnPcMwTCGjlejixYt/9KMfxWKxQCBQGNnbhSBGAUApFQwG6+vrzzzzzNraWk6uZ3KIDuWZMGHCTTfd1EHpjYQEIIRASsXLh5+Z7H4ApuLAZlGGYZjCRSvRL7/88qSTTmpoaAiHwwVjeisQMQoAnucVFxcvW7bszDPPjMVi3CmUyQk6lOftt9++4oorSkpKOsZ7QkIBIjipRLjnYGPY2Uk7iWgAJy0xDMMUKFqJrly58uSTT66pqYlEIgWjRKGQxCgAuK5bXl4+Y8aMn/70p1qJFkAgBdOJ0IvFrFmzfvKTnxiGIYTomBmIhCaRKw2z6PjLW60S00spFJy0xDAMU5Boh9uSJUvGjh27cePGoqKiAkuPKSgxCgCO41RVVb366quXXXaZ7lzPepTJDjpOdMmSJWeeeabruh3Wk40ACIXnpmJlw8619zkMk60kAgJcQp7qDMMwhYZ2uC1cuPCkk07atGlT4SlRKDwxCu169PHHH7/qqqt08CjrUaaj0Q0/V65ceeqpp9bX1weDwYw7UAgAQQEgCdNJxYt7HWSMPDuVTIIQBESASGwZZRiGKSi0TXTWrFknnHBCbW1tQSpRKEgxCgCu63bp0uWvf/3rr3/9a9ajTEejbaLr1q07+eSTN27cGI1GOyKURwARSAADPdsIRotOuKbNjIjtnT95ejMMwxQURKRtopMmTTrppJOam5vD4XBBKlEoVDEK7cXw7777bq1HiYj1KNMR6NbA69atO/HEE9etW1dcXNxBhZwIUIEw0FXJeOXoCxN7DcakjeyaZxiGKTiISCllGMazzz6rQ79CoVAhZSztRMGKUQDwPK9Lly533333b37zG44fZToC7Z3/6quvTjzxxFWrVhUXF7uui9gh7nJBJASmkrHIoNH0gx87iThKJOByTgzDMAWFzjeQUt5xxx0XXXSRZVmmaRawEgUAI9cD6FjSzUKVUnfffbd+wB2kFRi/kS60ccopp6xZs6akpKRDHShKGMpJBiv3LDrpqhZCAYoK+jDJMAzjQ7S3zbbtq6666tFHHy0vL9dW0lyPq2Mp/M1M20fvueeeK6+8UggB7WcOhtkdtBJdunTpCSecsHbt2o5WogAI4CF55Sf8Ol7aE50UYOG/vAzDML5Ce9u2bt16yimnPPzww5WVlT5x6vpiP9P5TA8++OAFF1ygO4YXtrmb6Wi0Ep09e/bYsWM3bdqkvfMdekUU6CZiFUdfmNp/hEq0SixwnwbDMIyvICKdCztr1qyjjz562rRpXbt2LdR0pa/jCzEK7f76CRMmjB8/vrW1VUrpn2fMZBatRN99913dkC0SiXTkXCIAEMJwEm3lA0YYI3+aTCZBCMWhJgzDMIWC53mIKKV88sknTzjhhA0bNpSVlXVQLmx+4hcxCu320bfeeuuEE07YvHmzYRisR5nvRfrk+uyzz55xxhm2bXd8eiMKkI7TGqjsGTjlVy0QNBUAKu78yTAMUxho13w8Hr/iiisuueQSACjgEk7/DR+JUQBwHKeysnLOnDnHHHPMwoULDcPw1cmD2R3S6Y1//vOfL7roIsMwLMvq8HgPRAdcQ0Qqf/TrWMkeph1zDIVKcn17hmGYzo5SShs4Fi1adMwxxzz88MPl5eX+jCT0lxgFANd1S0tLv/rqq+OPP37SpEmmabqu64foYGZ30KHGrutedtllN9xwQ0lJiS4W1kGXQwIALThRpJJlJ/6irc+RGE8oKYVnIIASbBllGIbpxOhtRUr5yCOPHHPMMQsWLKisrPQ8z5+CxHdiFABc141EIvF4/Mwzz/zb3/5mGAZwij3z33EcR0q5ZcuWk0466dFHH62srOzoHgq6yzyiSfGW8hE/pqGnQluLMvSfegqJLaMMwzCdFB3xJaXcvHnz2WeffcUVV7iuW6h9Pr8jfhSjAOB5nmVZwWDw6quv/vnPf27btrZ75XpcTH6R7samQzumTZtWVVWVBVM6AQoBXrwxOvBoc8zPYylHIACwAGUYhunc6MYoUspXXnll+PDhL7/8ckVFhT9d8zviUzEK7abQysrKhx56aOzYsevWreOUJmZH9AwxDOPpp5/WM6S8vDw7MwSF9BKJ0F6DQuN/20rC8pQnAYmbLTEMw3RWlFK6w+emTZsuuOCCc845p7a2Vm8r/nTN74h/xSi0272qqqo+/vjjkSNHvvPOO4Zh6OmS66ExOcZ1XSGE7oFx8cUXE1EHl3DSIBIJROUkZOkepaf/PhGoRNchAUACgE9KDMMwnQ8tNoQQQohnnnlm+PDhzz77bElJSSAQYBOYxtdiVKNTmhoaGk477bRbbrkFEdll72fS9Zu++OKLY4899m9/+1tZWVlWfCgEQCSkq1whg11PvyHWpS/ZSRCCtv8tu+kZhmE6GbqGqGEYCxcuPOWUUy688ML6+vqKigrP89jylYbFKACA67qBQCASifzxj3888cQT165dq132bDn3G+lonn/+85+jRo369NNPq6qqspPeiACAUigPCarGX9/S53CIJ0jyG8owDNMp0XuHlLKpqen3v//9qFGj3nnnnYqKCsuy2OC1E7zVbUd75ysrK6dMmXLUUUf961//MgwDEX0eU+wftBvFMIzGxsZLLrnkggsuSCQSWejz+X/XBwQgx0lVnniVO+gEN9FKEiVx2jzDMEwnQysKKSUATJgwYdiwYbfffjsAlJaWuq7LBtGvw2L0P3Bdt6ysrLm5+dxzz7300ksbGhqklL6t++Uf0m6UKVOmjBgx4oknnigrKzMMIwuueQQiXVIUJSVaq479mfuDs5KJZgOFbrXEM49hGKazoOvY6/DQKVOmHHPMMRdddNH69eurqqrYvPUtsBjdGV3Kp7S09PHHHx8+fPjEiROllIjIRvWCJF3vra2t7de//vW4cePWrl2btcrDBILIMBQBSjfRVn70T2n0z+x4m0CjPU6UYRiG6QSkZaiUcs6cOaeffvopp5wyc+bM8vLyYDDIgX/fDovRb0ALlMrKyvXr148fP/7yyy+vra3VdjK2rhcS6QjRqVOnjhgx4i9/+UsoFAqFQlk7eCAQCcczpGqLVQ07VYz5eSJhSwTFvnmGYZhOgnbKaxn62WefnX/++WPGjHnjjTcikUhRURErh+8Ci9H/iuu6wWCwqKjokUceGT58+EsvvSSl1In2fL7p7KTrvdXU1Fx55ZUnn3zy8uXLdWulrKwainTCEpBA0421lg07RY79bdxOARKBFMArF8MwTF6j7VZahgoh5s+ff/75548aNeq5557T/lVtK831MDsHLEa/jXRW0+bNm3/yk5+cccYZX375JSc2dWr08pGu93bkkUc+9NBDkUgkHA5nMRJD/P/27iQ2iiuNA/h7VdXVi7du29iAIw5GIcgmiQQoMMGRR8GRY0EGsUyAjJAiIQXlRIiiGUaZieaQQ06RyAWJHFBEWBQck8ghCiJYYGMGW6yJITheBi+0N8C9d7uW9+bwcKVjD4wB46rG/98B2e3CLqCp/vf33veVzAkh3JRVMxb2L33d/cb7MWZQQiRCOb0XVQEAwIHE64hYWJMkqbGx8a233qqqqjp48KCiKIFAQBxg92lmEoTR/08MfvL7/ceOHausrPz444+j0agsy3i2ZRbRLy8uHxcuXFi7du327dsHBwcLCwtn+E4HjEiEcIkqPHY3d2mNZ9OHCUOl3CQUGRQAwLlM07RiqKZpx44dW7NmTU1NzdGjRyVJys/PRzB4NAijUyKK7YFAQNO0jz766JVXXjly5Ih4OmI7SEaw+uWDweCuXbuqqqpOnjwZCARsuQGGTAxDkbREzL9yk2/T36NcpsxUMMQJAMCRrIgpy7Isy8FgcM+ePRUVFZs3b/7xxx+9Xm8gECCEoNH5kSl2n0AmEW3Xc+bM6ezs3LZt2xdffLF79+7KykoynnUkCeHeccS/muiX37dv32effdbX1+f3+/Py8mby/SsnVCImJ4RTmRCFx+OFq/6kvPG3sMFlZjCJEkLRPg8A4BxWF4F4ESGEnDt37tChQ/X19f39/R6Px+/3k/Fyqb2nmukQRh+OWOr1er0+n6+hoaGxsXHDhg0ffPDBiy++SBBJHcaKobquHzp06NNPP21ra8vOzi4sLDQMY4avHRJhJlUkTmTOjVSs8I9/kV7fGdeSMqeEiicMkigAgP0mZ9De3t76+vra2toLFy4kEomcnByxvwsZdLogjD4K8TTNy8vjnB85cuT48eObN2/euXPn4sWLCSKp3azRoWJf79GjR/fs2dPS0uLxeMQAUVtWUjiRZEIoZ5qWLHptO3ttRzypK0Ri2CcKAOAAkzPo6OhoQ0NDXV3dmTNnBgYGVFXNysryer2MMazITy+E0Ucn3hIFAgHTND///PPa2totW7a8++67ZWVlhBDGmLgprd2nOYuIS4ksy4qiGIZRV1e3d+/e5uZmRVHEvnK7Lh+cUEqpyQzOWPHanWbFtrFEUpK46GSy5ZQAAIBzLl44xIgV8ZIdDoebm5vr6+sbGhq6u7sJIWJJTbS6ohr6JCCMPi7xvCwoKNB1fe/evYcPH16/fv2OHTuWL19uHSBJEkUB7Emyor8sy/F4/Ouvv963b19ra6ssy36/38b2Rk4ooQalKtdTkqTM2fQPbekbejwiUZlRiWJgLQDAzOJpxKxGsZI5MDDQ3Nz8ww8/nD179ubNm4Zh+Hw+0ZmEUuiThjA6PQzDkCRJRNL9+/d/9dVX1dXV77zzTlVVlXinJQ7A2v30Eu9orUvJ8PDw4cOH9+/f39bWpqqqvTGUEEIIpZRxSWXJuCunsPDPH8YXVbBYgsgKJxxJFABgZlgVUDEGxyoPaZp2/fr1s2fPNjQ0XLx4MRgMcs59Pl9ubi4ZH6Rj64nPFgij08YaY5mfn88Y++abb+rr61euXPn222+vW7dO9NyJAh4KpY8vvRRKCPn5558PHDhQW1vb09Pj9XodM+yNS0TWE1FP0cLAln8l5pezeEKSmUkliiAKAPDEpJc/RSXIKlswxrq7/3Pp0sXGxqaWlvMdHR1idnh6HdQBLx+zC8Lo9BNPYlGWO3/+fFNT0yeffLJx48atW7eWl5eLY0RsRSp9WOn3TyKEJJPJEydOHDx48NSpU+Fw2NrWY/d1RCLEJJRSqmiJUPZzf8jb+M9IbjFJxiRZNoksccKxVRQAYJqkR09CiJU+rQMSiURXV9fly5dbW1svXbrS2dk5OnqXMe7xqF6v17oXtN2vHbMXzc/Pt/scnmbi/0MqlYrH436/v7Ky8s0336yurhZvvwha76dmwnI8IeTatWt1dXV1dXXXrl0jhOTk5CiKYpomd8baN6cuyjVzLF6wYoNrzftxyUV0E7eYsAvj3Ke49C93hW+0yB4f57hLBYDNKKWapp0+fXrp0qWif2gqv0tc4a3QyTm/X1knmUz29/f/8ssvV69e/emnn27cuHHr1q1IJEIIUVXV4/EoikLSOujBXqiMPlniWa6qqtfrNQzju+++q6+vLy0trampWb9+/csvv+xyucSRqJVOJloXxRYfsRwfDAZPnDhRV1d37ty5UCjk9XqtmcPO2V1OJcL0BCXynLXvsYqtsRShpkFkRpitaXRWP604phYAOJBVzkxPhFZNwfqAphGfTvg+yWRyeHi4t7e3o6Ojvb29vb29u7t7YGAgHA4bhqEoitvtVlVVVN/ET0QR1FFQGZ1RIlGJQqnH4ykrK6upqVmzZs2yZcvEuzQyvso/a1OpdWFK32M+MjJy+vTpb7/9trGxMRgMyrKcnZ2tKMoM31N+Kiilmq578grzN+wee261nogQiXEqy5wxW/Mg55w4o2w880Rl1PzyPVRGARxCVEabmprELWOmKJFIRCKR27dvDw8P9/f39/f337x5s7e3NxgMjoyMhMNhTdNEj7yqqi6XSzTLi9cUh6ybwf+EMGoDUepjjCUSiVQq5fP5ysvLV69eXV1dvXz5cp/PJw6z6oKzIZhaV4r0yax9fX2NjY3ff//9+fPn+/r6OOdZWVlut9u5b2opZYbun1eau+79eOFilhyVqCruOc8JoeKX334laeVK6ypJ0z6931cf/AhJ+5J4kHNCXap7/FZPsw7jJMslRw78dbT934onhyGMAthNhNHjx4+XlZXpum4YpmEYmqbF47FYLJZIJOLx+O3bt0OhUDgcHh4evnPnzt27d+/cuROJRCKRyNjYmMidlFJFUUTuVBRFLPdP2EIKzocwaiexydo0zUQiMTY25vF4Fi5cuGrVqldffXXFihULFiywjhTxa8JSRUabMGjDejyVSl2/fv3MmTOnTp26cuXK4OAgpdTn87ndbpKWWZ2LMym7gEs+rse4rFBOOOX38qc950MokTih3qxsKkk2nojNKNfu3tLHNCpxjDIAcIj0CUqmaRqGmUqlTNOwHiHja/RiIr2iKGLXlqjRiKrnhI2kkIkQRh1BpFLGWCqVSiaTkiQVFRUtWbKkoqJi1apVzz//fGFhYfrxolMns7Lp5EEb6V/q6upqbW1tampqaWnp6uqKxWKKovh8PrGnNgMyaBrGDInrnHooNznllEucptVCx/8comL6OJ8SPl5HHf/3Fwf8/qtcPMoY45xQ6/eQ+5RfH/wp+X3p1vZPp3La9/7qKXG5XFwy6ewN5ABOI/b6p+0F/W0lMP2lbXLfkm1nDE8GwqizWP8PdV1PJpO6rrvd7rlz55aXly9btuyll14qKytbsGDBhMZDa+ukQ+Jp+oXjft2O8Xi8s7PzypUrra2tly9f7uzsHB0d5Zx7PB63260oSgbv8qGEcIlTJnHKKJE4ty2Mjuew8QMy4V3LE3AvkXLKqUE5bsEK4BSTX6oy8poPjw1h1KGshQnGmKZpqVTKMAyXyxUIBEpLS8vLy1944YUlS5YsXLhw3rx5VvOTJT3Jpbcf3q8V8WFN6HZMn7Jxv0lVkUikr6+vvb29ra3t6tWrYtBGNBolhLjd7qdp0AYlhIjV+XvDnHBtdYJ7BVHKf8vuAADgBAijGcCqLIrb41obt91udyAQKCkpKS0tffbZZxctWlRaWlpSUlJUVGR1Qd2PCHwPteSRvnTy4DjLGAuFQgMDAz09PV1dXb/++mtHR0dPT8/Q0FA0GjVN0xq0IVrmRW7GG2IAAIBZCGE0w6QvxItsqmmaruuGYUiS5Ha7c3JyCgoK5s6dW1JSMn/+/Geeeaa4uLi4uLigoCA3Nzc3N9fr9aqq+pinYZrm2NhYIpEIhUKRSGRoaGhkZCQYDAaDwb6+vsHBwaGhoVAoFI/HdV2nlLpcLjFoQ6TPDF6CBwAAgGmFMJrZJmwSFR2IIpsahmE14IsbTrjd7tzc3KysLDErPicnx+v1ejweVVXz8vJUVaVU8nq949+ZGIaZSiUplSKRsOj3F/1VoVAoGo0mk8loNBqLxTRNSyaT6QPqrSkbVvQkmdaEBAAAADMDYfRpM3kx3RqiJKKq9YH1uNjrOZXvnD5iQ3TEWx9YPxoD3gAAAGDqcDvQp80DtoGK8WwTepim3sw0+RZt1s9y6Ah6AAAAcDyE0VkEE9oAAADAaWbp7QEBAAAAwAkQRgEAAADANgijAAAAAGAbhFEAAAAAsA3CKAAAAADYBmEUAAAAAGyDMAoAAAAAtkEYBQAAAADb/BfLhDL0jfHrtQAAAABJRU5ErkJggg=="
  },
  "img/logo.png": {
    "encoding": "base64",
    "content": "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"
  },
  "import.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Import Data — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n<style>\n  .error-list { max-height: 220px; overflow-y: auto; margin-top: 10px; }\n  .error-list div { padding: 4px 0; border-bottom: 1px solid var(--line); font-size: 13px; color: var(--ink-soft); }\n  .template-link { font-size: 13px; }\n</style>\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container narrow\">\n  <p class=\"subtitle\"><a href=\"/admin.html\">&larr; Back to Admin</a></p>\n  <h1>Import Data</h1>\n  <p class=\"subtitle\">This app doesn't read .xlsx directly — export your spreadsheet to CSV first (in Excel or Google Sheets: File → Save As / Download → CSV), then upload it here.</p>\n\n  <div class=\"panel\">\n    <h2>Import Jobs</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:10px;\">Bring in your jobs for the year. Column headers are matched loosely (case/spacing don't matter) — recognized columns: <code>customer_name, customer_phone, site_address, scope, price, target_start_date, duration_days, crew, status, permit_number, notes</code>. A crew name that doesn't exist yet is created automatically.</p>\n    <p class=\"template-link\"><a href=\"#\" id=\"download-jobs-template\">Download a blank CSV template</a></p>\n    <div class=\"field-row\" style=\"align-items:flex-end;\">\n      <div class=\"field\" style=\"flex:2;\"><label>CSV File</label><input type=\"file\" id=\"jobs-csv-file\" accept=\".csv,text/csv\"></div>\n      <div class=\"field\" style=\"flex:none;\"><button type=\"button\" id=\"import-jobs-btn\">Import</button></div>\n    </div>\n    <div id=\"jobs-import-result\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Import Historical Material Sales</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:10px;\">Bring in past material orders so they show up in your records and financial reports. Recognized columns: <code>customer_name, customer_phone, material_name, quantity, unit, price_per_unit, delivery_address, delivery_fee, sales_tax_rate, order_date, driver_name, status, notes</code>. A customer or material that doesn't exist yet is created automatically. <code>order_date</code> and <code>quantity</code> are required for every row.</p>\n    <p class=\"template-link\"><a href=\"#\" id=\"download-sales-template\">Download a blank CSV template</a></p>\n    <div class=\"field-row\" style=\"align-items:flex-end;\">\n      <div class=\"field\" style=\"flex:2;\"><label>CSV File</label><input type=\"file\" id=\"sales-csv-file\" accept=\".csv,text/csv\"></div>\n      <div class=\"field\" style=\"flex:none;\"><button type=\"button\" id=\"import-sales-btn\">Import</button></div>\n    </div>\n    <div id=\"sales-import-result\"></div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  function downloadCsv(filename, header) {\n    const blob = new Blob([header + '\\n'], { type: 'text/csv' });\n    const url = URL.createObjectURL(blob);\n    const a = document.createElement('a');\n    a.href = url; a.download = filename;\n    document.body.appendChild(a); a.click(); a.remove();\n    URL.revokeObjectURL(url);\n  }\n  document.getElementById('download-jobs-template').addEventListener('click', (e) => {\n    e.preventDefault();\n    downloadCsv('jobs-template.csv', 'customer_name,customer_phone,site_address,scope,price,target_start_date,duration_days,crew,status,permit_number,notes');\n  });\n  document.getElementById('download-sales-template').addEventListener('click', (e) => {\n    e.preventDefault();\n    downloadCsv('sales-template.csv', 'customer_name,customer_phone,material_name,quantity,unit,price_per_unit,delivery_address,delivery_fee,sales_tax_rate,order_date,driver_name,status,notes');\n  });\n\n  function readFileAsText(file) {\n    return new Promise((resolve, reject) => {\n      const reader = new FileReader();\n      reader.onload = () => resolve(String(reader.result));\n      reader.onerror = reject;\n      reader.readAsText(file);\n    });\n  }\n\n  function renderResult(el, res, noun) {\n    const parts = [`<div class=\"ok-msg\">Imported ${res.imported} ${noun}.</div>`];\n    if (res.crewsCreated && res.crewsCreated.length) parts.push(`<div class=\"subtitle\">New crews created: ${res.crewsCreated.map(escapeHtml).join(', ')}</div>`);\n    if (res.customersCreated && res.customersCreated.length) parts.push(`<div class=\"subtitle\">New customers created: ${res.customersCreated.length}</div>`);\n    if (res.materialsCreated && res.materialsCreated.length) parts.push(`<div class=\"subtitle\">New materials created: ${res.materialsCreated.map(escapeHtml).join(', ')}</div>`);\n    if (res.errors && res.errors.length) {\n      parts.push(`<div class=\"error-msg\" style=\"margin-top:8px;\">${res.errors.length} row(s) had issues:</div>`);\n      parts.push(`<div class=\"error-list\">${res.errors.map(e => `<div>Row ${e.row}: ${escapeHtml(e.reason)}</div>`).join('')}</div>`);\n    }\n    el.innerHTML = parts.join('');\n  }\n\n  document.getElementById('import-jobs-btn').addEventListener('click', async () => {\n    const el = document.getElementById('jobs-import-result');\n    const file = document.getElementById('jobs-csv-file').files[0];\n    if (!file) { el.innerHTML = '<div class=\"error-msg\">Choose a CSV file first.</div>'; return; }\n    el.innerHTML = '<div class=\"subtitle\">Importing…</div>';\n    try {\n      const csv = await readFileAsText(file);\n      const res = await api('/api/jobs/import', { method: 'POST', body: { csv } });\n      renderResult(el, res, 'job(s)');\n    } catch (err) {\n      el.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  document.getElementById('import-sales-btn').addEventListener('click', async () => {\n    const el = document.getElementById('sales-import-result');\n    const file = document.getElementById('sales-csv-file').files[0];\n    if (!file) { el.innerHTML = '<div class=\"error-msg\">Choose a CSV file first.</div>'; return; }\n    el.innerHTML = '<div class=\"subtitle\">Importing…</div>';\n    try {\n      const csv = await readFileAsText(file);\n      const res = await api('/api/orders/import', { method: 'POST', body: { csv } });\n      renderResult(el, res, 'order(s)');\n    } catch (err) {\n      el.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n})();\n</script>\n</body>\n</html>\n"
  },
  "index.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>OPD Development Corp — Log In</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"login-card\">\n  <div class=\"logo-wrap\"><img src=\"/img/logo-large.png\" alt=\"OPD Development Corp logo\"></div>\n  <h1>OPD Development Corp</h1>\n  <p class=\"subtitle\" style=\"text-align:center;\">Orders · Scheduling · Invoicing</p>\n\n  <div class=\"login-tabs\">\n    <button id=\"tab-office\" class=\"active\">Dispatch / Office</button>\n    <button id=\"tab-driver\">Driver</button>\n  </div>\n\n  <form id=\"office-form\">\n    <div class=\"field\">\n      <label>Office Password</label>\n      <input type=\"password\" id=\"office-password\" required autofocus>\n    </div>\n    <button type=\"submit\" style=\"width:100%;\">Log In</button>\n  </form>\n\n  <form id=\"driver-form\" style=\"display:none;\">\n    <div class=\"field\">\n      <label>Driver</label>\n      <select id=\"driver-select\" required></select>\n    </div>\n    <div class=\"field\">\n      <label>PIN</label>\n      <input type=\"password\" inputmode=\"numeric\" id=\"driver-pin\" required>\n    </div>\n    <button type=\"submit\" style=\"width:100%;\">Log In</button>\n  </form>\n\n  <div id=\"msg\"></div>\n</div>\n\n<script>\nconst tabOffice = document.getElementById('tab-office');\nconst tabDriver = document.getElementById('tab-driver');\nconst officeForm = document.getElementById('office-form');\nconst driverForm = document.getElementById('driver-form');\nconst msg = document.getElementById('msg');\n\ntabOffice.addEventListener('click', () => {\n  tabOffice.classList.add('active'); tabDriver.classList.remove('active');\n  officeForm.style.display = 'block'; driverForm.style.display = 'none';\n});\ntabDriver.addEventListener('click', async () => {\n  tabDriver.classList.add('active'); tabOffice.classList.remove('active');\n  driverForm.style.display = 'block'; officeForm.style.display = 'none';\n  await loadDrivers();\n});\n\nasync function loadDrivers() {\n  const sel = document.getElementById('driver-select');\n  if (sel.options.length) return;\n  try {\n    const res = await fetch('/api/drivers-public');\n    const drivers = await res.json();\n    sel.innerHTML = drivers.map(d => `<option value=\"${d.id}\">${d.name}</option>`).join('');\n  } catch (e) {\n    sel.innerHTML = '<option value=\"\">Could not load drivers</option>';\n  }\n}\n\nofficeForm.addEventListener('submit', async (e) => {\n  e.preventDefault();\n  msg.innerHTML = '';\n  const password = document.getElementById('office-password').value;\n  const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ role: 'office', password }) });\n  const data = await res.json();\n  if (res.ok) window.location.href = '/dashboard.html';\n  else msg.innerHTML = `<div class=\"error-msg\">${data.error}</div>`;\n});\n\ndriverForm.addEventListener('submit', async (e) => {\n  e.preventDefault();\n  msg.innerHTML = '';\n  const driverId = document.getElementById('driver-select').value;\n  const pin = document.getElementById('driver-pin').value;\n  const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ role: 'driver', driverId, pin }) });\n  const data = await res.json();\n  if (res.ok) window.location.href = '/driver.html';\n  else msg.innerHTML = `<div class=\"error-msg\">${data.error}</div>`;\n});\n</script>\n</body>\n</html>\n"
  },
  "invoice-detail.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Invoice — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar no-print\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <div class=\"panel no-print\" id=\"actions-panel\">\n    <h2>Actions</h2>\n    <div style=\"display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px;\">\n      <button type=\"button\" id=\"send-btn\" class=\"secondary\">Mark as Sent</button>\n      <button type=\"button\" id=\"copy-link-btn\" class=\"secondary\">Copy Customer Pay Link</button>\n      <button type=\"button\" id=\"print-btn\" class=\"secondary\">Print / Save PDF</button>\n      <button type=\"button\" id=\"delete-btn\" class=\"btn danger\">Delete Invoice</button>\n    </div>\n    <div class=\"grid cols-2\">\n      <div>\n        <h2>Record a Manual Payment</h2>\n        <div class=\"field-row\">\n          <div class=\"field\"><label>Amount ($)</label><input type=\"number\" step=\"0.01\" id=\"pay-amount\"></div>\n          <div class=\"field\"><label>Method</label>\n            <select id=\"pay-method\"><option value=\"cash\">Cash</option><option value=\"check\">Check</option><option value=\"ach\">ACH / Bank Transfer</option><option value=\"other\">Other</option></select>\n          </div>\n        </div>\n        <div class=\"field\"><label>Reference (check #, etc.)</label><input id=\"pay-reference\"></div>\n        <button type=\"button\" id=\"mark-paid-btn\">Record Payment</button>\n      </div>\n      <div>\n        <h2>Online Card Payment (Stripe)</h2>\n        <p class=\"subtitle\" style=\"margin-bottom:10px;\">Generates a secure Stripe Checkout link the customer can pay online. Requires <code>STRIPE_SECRET_KEY</code> to be set in <code>.env</code>.</p>\n        <button type=\"button\" id=\"stripe-link-btn\" class=\"secondary\">Generate Stripe Payment Link</button>\n        <div id=\"stripe-msg\" style=\"margin-top:8px;\"></div>\n      </div>\n    </div>\n    <div id=\"action-msg\"></div>\n  </div>\n\n  <div class=\"print-invoice panel\" id=\"invoice-body\">Loading…</div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const id = new URLSearchParams(window.location.search).get('id');\n  let invoice;\n\n  async function load() {\n    invoice = await api(`/api/invoices/${id}`);\n    render();\n  }\n\n  function render() {\n    document.getElementById('invoice-body').innerHTML = `\n      <div style=\"display:flex; justify-content:space-between; align-items:flex-start;\">\n        <div>\n          <h1>Invoice ${invoice.invoice_number}</h1>\n          <div>${badge(invoice.status)}</div>\n        </div>\n        <div style=\"text-align:right; font-size:14px;\">\n          <div><strong>OPD Development Corp</strong></div>\n          <div>Issued: ${fmtDate(invoice.issued_date)}</div>\n          <div>Due: ${invoice.due_date ? fmtDate(invoice.due_date) : 'Upon receipt'}</div>\n        </div>\n      </div>\n      <div class=\"invoice-meta\">\n        <div>\n          <strong>Bill To</strong><br>\n          ${invoice.customer_name}<br>\n          ${invoice.customer_address || ''}<br>\n          ${invoice.customer_phone || ''}\n        </div>\n      </div>\n      <table>\n        <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>\n        <tbody>\n          ${invoice.items.map(it => `<tr><td>${it.description}</td><td>${it.quantity} ${it.unit || ''}</td><td>${fmtMoney(it.unit_price)}</td><td>${fmtMoney(it.amount)}</td></tr>`).join('')}\n        </tbody>\n      </table>\n      <div class=\"totals\">\n        <div><span>Subtotal</span><span>${fmtMoney(invoice.subtotal)}</span></div>\n        <div><span>Tax (${invoice.tax_rate}%)</span><span>${fmtMoney(invoice.tax_amount)}</span></div>\n        <div class=\"grand\"><span>Total</span><span>${fmtMoney(invoice.total)}</span></div>\n        <div><span>Paid</span><span>${fmtMoney(invoice.amount_paid)}</span></div>\n        <div class=\"grand\"><span>Balance Due</span><span>${fmtMoney(invoice.total - invoice.amount_paid)}</span></div>\n      </div>\n      ${invoice.payments.length ? `\n        <h2 style=\"margin-top:24px;\">Payment History</h2>\n        <table>\n          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>\n          <tbody>${invoice.payments.map(p => `<tr><td>${fmtDate(p.paid_at)}</td><td>${fmtMoney(p.amount)}</td><td>${fmtStatus(p.method)}</td><td>${p.reference || '—'}</td></tr>`).join('')}</tbody>\n        </table>\n      ` : ''}\n      <p style=\"margin-top:24px; font-size:13px; color:var(--ink-soft);\">Thank you for your business.</p>\n    `;\n    document.getElementById('pay-amount').value = (invoice.total - invoice.amount_paid).toFixed(2);\n  }\n\n  document.getElementById('send-btn').addEventListener('click', async () => {\n    await api(`/api/invoices/${id}/send`, { method: 'POST' });\n    await load();\n  });\n\n  document.getElementById('copy-link-btn').addEventListener('click', async () => {\n    const url = `${window.location.origin}/pay/${invoice.pay_token}`;\n    try {\n      await navigator.clipboard.writeText(url);\n      document.getElementById('action-msg').innerHTML = `<div class=\"ok-msg\">Copied: ${url}</div>`;\n    } catch (e) {\n      document.getElementById('action-msg').innerHTML = `<div>Pay link: <a href=\"${url}\" target=\"_blank\">${url}</a></div>`;\n    }\n  });\n\n  document.getElementById('print-btn').addEventListener('click', () => window.print());\n\n  document.getElementById('delete-btn').addEventListener('click', async () => {\n    if (!confirm('Delete this invoice? Its orders will go back to \"delivered\" so they can be re-invoiced. This cannot be undone.')) return;\n    try {\n      await api(`/api/invoices/${id}`, { method: 'DELETE' });\n      window.location.href = '/invoices.html';\n    } catch (err) {\n      document.getElementById('action-msg').innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  document.getElementById('mark-paid-btn').addEventListener('click', async () => {\n    const msg = document.getElementById('action-msg');\n    msg.innerHTML = '';\n    try {\n      await api(`/api/invoices/${id}/mark-paid`, { method: 'POST', body: {\n        amount: Number(document.getElementById('pay-amount').value),\n        method: document.getElementById('pay-method').value,\n        reference: document.getElementById('pay-reference').value || null,\n      }});\n      msg.innerHTML = '<div class=\"ok-msg\">Payment recorded.</div>';\n      await load();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  document.getElementById('stripe-link-btn').addEventListener('click', async () => {\n    const el = document.getElementById('stripe-msg');\n    el.innerHTML = 'Generating…';\n    try {\n      const res = await api(`/api/invoices/${id}/checkout`, { method: 'POST' });\n      el.innerHTML = `<a href=\"${res.url}\" target=\"_blank\">${res.url}</a>`;\n    } catch (err) {\n      el.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  await load();\n})();\n</script>\n</body>\n</html>\n"
  },
  "invoices.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Invoicing — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <h1>Invoicing &amp; Payment</h1>\n  <p class=\"subtitle\">Turn delivered orders into an invoice, send it, and collect payment online or record cash/check/ACH.</p>\n\n  <div class=\"panel\">\n    <h2>Create an Invoice from Delivered Orders</h2>\n    <div class=\"field\" style=\"max-width:320px;\">\n      <label>Customer</label>\n      <select id=\"customer-filter\"><option value=\"\">— Select a customer —</option></select>\n    </div>\n    <div class=\"table-wrap\">\n      <table id=\"ready-table\">\n        <thead><tr><th></th><th>Order #</th><th>Delivered</th><th>Material</th><th>Qty</th><th>Amount</th></tr></thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"ready-empty\" style=\"display:none;\">No delivered, un-invoiced orders for this customer yet.</div>\n    <div class=\"field-row\" style=\"margin-top:14px; align-items:flex-end;\" id=\"invoice-controls\" style=\"display:none;\">\n      <div class=\"field\" style=\"max-width:160px;\"><label>Tax Rate (%)</label><input type=\"number\" id=\"tax-rate\" value=\"0\" step=\"0.01\"></div>\n      <div class=\"field\" style=\"max-width:200px;\"><label>Due Date</label><input type=\"date\" id=\"due-date\"></div>\n      <div class=\"field\" style=\"flex:2;\"><strong id=\"selected-total\"></strong></div>\n      <button type=\"button\" id=\"create-invoice-btn\">Create Invoice</button>\n    </div>\n    <div id=\"create-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>All Invoices</h2>\n    <div class=\"table-wrap\">\n      <table id=\"invoices-table\">\n        <thead><tr><th>Invoice #</th><th>Customer</th><th>Issued</th><th>Total</th><th>Paid</th><th>Status</th><th></th></tr></thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"invoices-empty\" style=\"display:none;\">No invoices yet.</div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const customers = await api('/api/customers');\n  document.getElementById('customer-filter').innerHTML += customers.map(c => `<option value=\"${c.id}\">${c.name}</option>`).join('');\n\n  async function loadReady() {\n    const custId = document.getElementById('customer-filter').value;\n    const controls = document.getElementById('invoice-controls');\n    const tbody = document.querySelector('#ready-table tbody');\n    if (!custId) { tbody.innerHTML = ''; document.getElementById('ready-empty').style.display = 'none'; controls.style.display = 'none'; return; }\n    const orders = await api(`/api/orders-ready-to-invoice?customer_id=${custId}`);\n    document.getElementById('ready-empty').style.display = orders.length ? 'none' : 'block';\n    controls.style.display = orders.length ? 'flex' : 'none';\n    tbody.innerHTML = orders.map(o => `\n      <tr>\n        <td><input type=\"checkbox\" class=\"ready-check\" value=\"${o.id}\" data-amount=\"${o.quantity * o.price_per_unit}\" checked></td>\n        <td><a href=\"/order-detail.html?id=${o.id}\">${o.order_number}</a></td>\n        <td>${o.delivered_at ? fmtDate(o.delivered_at) : '—'}</td>\n        <td>${o.material_name}</td>\n        <td>${o.quantity} ${o.unit}</td>\n        <td>${fmtMoney(o.quantity * o.price_per_unit)}</td>\n      </tr>\n    `).join('');\n    tbody.querySelectorAll('.ready-check').forEach(cb => cb.addEventListener('change', updateSelectedTotal));\n    updateSelectedTotal();\n  }\n\n  function updateSelectedTotal() {\n    const checked = [...document.querySelectorAll('.ready-check:checked')];\n    const subtotal = checked.reduce((s, cb) => s + Number(cb.dataset.amount), 0);\n    const taxRate = Number(document.getElementById('tax-rate').value) || 0;\n    const total = subtotal * (1 + taxRate / 100);\n    document.getElementById('selected-total').textContent = `${checked.length} order(s) selected — Subtotal ${fmtMoney(subtotal)}, Total w/ tax ${fmtMoney(total)}`;\n  }\n\n  document.getElementById('customer-filter').addEventListener('change', loadReady);\n  document.getElementById('tax-rate').addEventListener('input', updateSelectedTotal);\n\n  document.getElementById('create-invoice-btn').addEventListener('click', async () => {\n    const msg = document.getElementById('create-msg');\n    msg.innerHTML = '';\n    const orderIds = [...document.querySelectorAll('.ready-check:checked')].map(cb => Number(cb.value));\n    if (!orderIds.length) { msg.innerHTML = '<div class=\"error-msg\">Select at least one order.</div>'; return; }\n    try {\n      const invoice = await api('/api/invoices', { method: 'POST', body: {\n        order_ids: orderIds,\n        tax_rate: Number(document.getElementById('tax-rate').value) || 0,\n        due_date: document.getElementById('due-date').value || null,\n      }});\n      window.location.href = `/invoice-detail.html?id=${invoice.id}`;\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  async function loadInvoices() {\n    const invoices = await api('/api/invoices');\n    const tbody = document.querySelector('#invoices-table tbody');\n    document.getElementById('invoices-empty').style.display = invoices.length ? 'none' : 'block';\n    tbody.innerHTML = invoices.map(i => `\n      <tr>\n        <td><a href=\"/invoice-detail.html?id=${i.id}\">${i.invoice_number}</a></td>\n        <td>${i.customer_name}</td>\n        <td>${i.issued_date ? fmtDate(i.issued_date) : '—'}</td>\n        <td>${fmtMoney(i.total)}</td>\n        <td>${fmtMoney(i.amount_paid)}</td>\n        <td>${badge(i.status)}</td>\n        <td style=\"display:flex; gap:6px;\">\n          <a class=\"btn secondary small\" href=\"/invoice-detail.html?id=${i.id}\">Open</a>\n          <button type=\"button\" class=\"btn danger small delete-invoice-btn\" data-id=\"${i.id}\">Delete</button>\n        </td>\n      </tr>\n    `).join('');\n    tbody.querySelectorAll('.delete-invoice-btn').forEach(btn => btn.addEventListener('click', async () => {\n      if (!confirm('Delete this invoice? Its orders will go back to \"delivered\" so they can be re-invoiced. This cannot be undone.')) return;\n      try {\n        await api(`/api/invoices/${btn.dataset.id}`, { method: 'DELETE' });\n        await loadInvoices();\n        await loadReady();\n      } catch (err) {\n        alert(err.message);\n      }\n    }));\n  }\n\n  await loadReady();\n  await loadInvoices();\n})();\n</script>\n</body>\n</html>\n"
  },
  "job-detail.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Job — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n<style>\n  .checklist-row, .todo-row, .permit-row { display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--line); }\n  .checklist-row:last-child, .todo-row:last-child, .permit-row:last-child { border-bottom:none; }\n  .checklist-row.done label, .todo-row.done label { text-decoration:line-through; color:var(--ink-soft); }\n  .checklist-row label, .todo-row label { flex:1; margin:0; font-size:14px; font-weight:400; color:var(--ink); }\n  .checklist-row input[type=checkbox], .todo-row input[type=checkbox] { flex:none; width:16px; height:16px; }\n  .todo-cat-tabs { display:flex; gap:8px; margin-bottom:12px; }\n  .todo-cat-tabs button.active { background:var(--brand); color:#fff; }\n</style>\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container narrow\">\n  <p class=\"subtitle\"><a href=\"/jobs.html\">&larr; Back to Jobs</a></p>\n  <h1 id=\"job-title\">Loading…</h1>\n\n  <div class=\"panel\">\n    <h2>Job Details</h2>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Customer Name</label><input id=\"f_customer_name\"></div>\n      <div class=\"field\"><label>Customer Phone</label><input id=\"f_customer_phone\"></div>\n    </div>\n    <div class=\"field-row\">\n      <div class=\"field\" style=\"flex:2;\"><label>Site Address</label><input id=\"f_site_address\"></div>\n      <div class=\"field\"><label>Price ($)</label><input type=\"number\" step=\"0.01\" id=\"f_price\"></div>\n    </div>\n    <div class=\"field\">\n      <label>Scope of Work</label>\n      <textarea id=\"f_scope\" rows=\"2\"></textarea>\n    </div>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Target Start Date</label><input type=\"date\" id=\"f_start\"></div>\n      <div class=\"field\"><label>Duration (days)</label><input type=\"number\" step=\"0.5\" min=\"0.5\" id=\"f_duration\"></div>\n      <div class=\"field\"><label>Crew</label><select id=\"f_crew\"><option value=\"\">— Unassigned —</option></select></div>\n      <div class=\"field\"><label>Status</label><select id=\"f_status\"></select></div>\n    </div>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Permit Number</label><input id=\"f_permit_number\"></div>\n      <div class=\"field\"><label>Follow Up Date</label><input type=\"date\" id=\"f_followup_date\"></div>\n      <div class=\"field\" style=\"flex:2;\"><label>Follow-Up Note</label><input id=\"f_followup_note\" placeholder=\"e.g. call about start date\"></div>\n    </div>\n    <div class=\"field\">\n      <label>Notes</label>\n      <textarea id=\"f_notes\" rows=\"2\"></textarea>\n    </div>\n    <button type=\"button\" id=\"save-job\">Save</button>\n    <div id=\"save-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Equipment Assigned</h2>\n    <div class=\"table-wrap\">\n      <table id=\"equip-table\">\n        <thead><tr><th>Equipment</th><th>Start</th><th>End</th><th></th></tr></thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"field-row\" style=\"margin-top:10px;\">\n      <div class=\"field\"><label>Equipment</label><select id=\"new-equip\"></select></div>\n      <div class=\"field\"><label>Start</label><input type=\"date\" id=\"new-equip-start\"></div>\n      <div class=\"field\"><label>End</label><input type=\"date\" id=\"new-equip-end\"></div>\n      <div class=\"field\" style=\"flex:none; align-self:flex-end;\"><button type=\"button\" id=\"add-equip\">Assign</button></div>\n    </div>\n    <div id=\"equip-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Checklist</h2>\n    <div id=\"checklist-list\"></div>\n    <div class=\"field-row\" style=\"margin-top:10px;\">\n      <div class=\"field\" style=\"flex:2;\"><input id=\"new-checklist-item\" placeholder=\"Add a checklist item…\"></div>\n      <div class=\"field\" style=\"flex:none; align-self:flex-end;\"><button type=\"button\" id=\"add-checklist-item\">Add</button></div>\n    </div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>To-Do List</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:10px;\">Split between office tasks and field tasks — both can check things off.</p>\n    <div class=\"todo-cat-tabs\">\n      <button type=\"button\" class=\"btn secondary small active\" data-cat=\"office\">Office</button>\n      <button type=\"button\" class=\"btn secondary small\" data-cat=\"field\">Field</button>\n    </div>\n    <div id=\"todo-list\"></div>\n    <div class=\"field-row\" style=\"margin-top:10px;\">\n      <div class=\"field\" style=\"flex:2;\"><input id=\"new-todo\" placeholder=\"Add a to-do…\"></div>\n      <div class=\"field\" style=\"flex:none; align-self:flex-end;\"><button type=\"button\" id=\"add-todo\">Add</button></div>\n    </div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Permits</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:10px;\">Upload the permit PDF here once you have it. Permit # above stays in sync with the most recent upload.</p>\n    <div id=\"permit-list\"></div>\n    <div class=\"field-row\" style=\"margin-top:10px; align-items:flex-end;\">\n      <div class=\"field\"><label>Permit Number</label><input id=\"new-permit-number\"></div>\n      <div class=\"field\" style=\"flex:2;\"><label>File (PDF)</label><input type=\"file\" id=\"new-permit-file\" accept=\"application/pdf\"></div>\n      <div class=\"field\" style=\"flex:none;\"><button type=\"button\" id=\"add-permit\">Upload</button></div>\n    </div>\n    <div id=\"permit-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Delete Job</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:14px;\">Permanently removes this job, its checklist, to-dos, and permits. Can't be undone.</p>\n    <button type=\"button\" class=\"btn danger\" id=\"delete-job\">Delete This Job</button>\n    <div id=\"delete-msg\" style=\"margin-top:10px;\"></div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const jobId = new URLSearchParams(window.location.search).get('id');\n  if (!jobId) { document.getElementById('job-title').textContent = 'No job specified.'; return; }\n\n  const JOB_STATUSES = ['inquiry', 'estimate_scheduled', 'quote_sent', 'accepted', 'scheduled', 'deposit_received', 'in_progress', 'complete', 'cancelled'];\n  document.getElementById('f_status').innerHTML = JOB_STATUSES.map(s => `<option value=\"${s}\">${fmtStatus(s)}</option>`).join('');\n\n  const [crews, equipment] = await Promise.all([api('/api/crews'), api('/api/equipment')]);\n  document.getElementById('f_crew').innerHTML += crews.map(c => `<option value=\"${c.id}\">${escapeHtml(c.name)}</option>`).join('');\n  document.getElementById('new-equip').innerHTML = equipment.map(e => `<option value=\"${e.id}\">${escapeHtml(e.name)}</option>`).join('');\n\n  let job;\n  async function load() {\n    job = await api(`/api/jobs/${jobId}`);\n    document.getElementById('job-title').innerHTML = `${job.job_number} ${badge(job.status)}`;\n    document.getElementById('f_customer_name').value = job.customer_name || '';\n    document.getElementById('f_customer_phone').value = job.customer_phone || '';\n    document.getElementById('f_site_address').value = job.site_address || '';\n    document.getElementById('f_price').value = job.price ?? '';\n    document.getElementById('f_scope').value = job.scope || '';\n    document.getElementById('f_start').value = job.target_start_date || '';\n    document.getElementById('f_duration').value = job.duration_days ?? '';\n    document.getElementById('f_crew').value = job.crew_id || '';\n    document.getElementById('f_status').value = job.status;\n    document.getElementById('f_permit_number').value = job.permit_number || '';\n    document.getElementById('f_followup_date').value = job.next_followup_date || '';\n    document.getElementById('f_followup_note').value = job.followup_note || '';\n    document.getElementById('f_notes').value = job.notes || '';\n\n    await Promise.all([loadEquip(), loadChecklist(), loadTodos(), loadPermits()]);\n  }\n\n  document.getElementById('save-job').addEventListener('click', async () => {\n    const msg = document.getElementById('save-msg');\n    try {\n      await api(`/api/jobs/${jobId}`, { method: 'PUT', body: {\n        customer_name: document.getElementById('f_customer_name').value,\n        customer_phone: document.getElementById('f_customer_phone').value,\n        site_address: document.getElementById('f_site_address').value,\n        price: document.getElementById('f_price').value,\n        scope: document.getElementById('f_scope').value,\n        target_start_date: document.getElementById('f_start').value,\n        duration_days: document.getElementById('f_duration').value,\n        crew_id: document.getElementById('f_crew').value || null,\n        status: document.getElementById('f_status').value,\n        permit_number: document.getElementById('f_permit_number').value,\n        next_followup_date: document.getElementById('f_followup_date').value,\n        followup_note: document.getElementById('f_followup_note').value,\n        notes: document.getElementById('f_notes').value,\n      }});\n      msg.innerHTML = '<div class=\"ok-msg\">Saved.</div>';\n      load();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  // ---- Equipment assignments ----\n  async function loadEquip() {\n    const rows = await api(`/api/job-equipment?job_id=${jobId}`);\n    document.querySelector('#equip-table tbody').innerHTML = rows.map(r => `\n      <tr data-id=\"${r.id}\">\n        <td>${escapeHtml(r.equipment_name)}</td>\n        <td>${r.start_date ? fmtDate(r.start_date) : '—'}</td>\n        <td>${r.end_date ? fmtDate(r.end_date) : '—'}</td>\n        <td><button type=\"button\" class=\"btn secondary small remove-equip\">Remove</button></td>\n      </tr>\n    `).join('') || '<tr><td colspan=\"4\" class=\"empty\">No equipment assigned.</td></tr>';\n    document.querySelectorAll('#equip-table .remove-equip').forEach(btn => btn.addEventListener('click', async () => {\n      const id = btn.closest('tr').dataset.id;\n      await api(`/api/job-equipment/${id}`, { method: 'DELETE' });\n      loadEquip();\n    }));\n  }\n  document.getElementById('add-equip').addEventListener('click', async () => {\n    const msg = document.getElementById('equip-msg');\n    try {\n      await api('/api/job-equipment', { method: 'POST', body: {\n        job_id: jobId,\n        equipment_id: document.getElementById('new-equip').value,\n        start_date: document.getElementById('new-equip-start').value || null,\n        end_date: document.getElementById('new-equip-end').value || null,\n      }});\n      document.getElementById('new-equip-start').value = '';\n      document.getElementById('new-equip-end').value = '';\n      msg.innerHTML = '';\n      loadEquip();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  // ---- Checklist ----\n  async function loadChecklist() {\n    const items = await api(`/api/job-checklist?job_id=${jobId}`);\n    document.getElementById('checklist-list').innerHTML = items.map(it => `\n      <div class=\"checklist-row ${it.done ? 'done' : ''}\" data-id=\"${it.id}\">\n        <input type=\"checkbox\" class=\"cl-done\" ${it.done ? 'checked' : ''}>\n        <label>${escapeHtml(it.label)}</label>\n        <button type=\"button\" class=\"btn secondary small cl-delete\">Remove</button>\n      </div>\n    `).join('') || '<p class=\"subtitle\">No checklist items yet.</p>';\n    document.querySelectorAll('.checklist-row .cl-done').forEach(cb => cb.addEventListener('change', async () => {\n      const id = cb.closest('.checklist-row').dataset.id;\n      await api(`/api/job-checklist/${id}`, { method: 'PUT', body: { done: cb.checked } });\n      loadChecklist();\n    }));\n    document.querySelectorAll('.checklist-row .cl-delete').forEach(btn => btn.addEventListener('click', async () => {\n      const id = btn.closest('.checklist-row').dataset.id;\n      await api(`/api/job-checklist/${id}`, { method: 'DELETE' });\n      loadChecklist();\n    }));\n  }\n  document.getElementById('add-checklist-item').addEventListener('click', async () => {\n    const input = document.getElementById('new-checklist-item');\n    if (!input.value.trim()) return;\n    await api('/api/job-checklist', { method: 'POST', body: { job_id: jobId, label: input.value.trim() } });\n    input.value = '';\n    loadChecklist();\n  });\n\n  // ---- To-dos ----\n  let todoCat = 'office';\n  document.querySelectorAll('.todo-cat-tabs button').forEach(btn => btn.addEventListener('click', () => {\n    document.querySelectorAll('.todo-cat-tabs button').forEach(b => b.classList.remove('active'));\n    btn.classList.add('active');\n    todoCat = btn.dataset.cat;\n    loadTodos();\n  }));\n  async function loadTodos() {\n    const items = await api(`/api/job-todos?job_id=${jobId}&category=${todoCat}`);\n    document.getElementById('todo-list').innerHTML = items.map(it => `\n      <div class=\"todo-row ${it.done ? 'done' : ''}\" data-id=\"${it.id}\">\n        <input type=\"checkbox\" class=\"td-done\" ${it.done ? 'checked' : ''}>\n        <label>${escapeHtml(it.description)}</label>\n        <button type=\"button\" class=\"btn secondary small td-delete\">Remove</button>\n      </div>\n    `).join('') || `<p class=\"subtitle\">No ${todoCat} to-dos yet.</p>`;\n    document.querySelectorAll('.todo-row .td-done').forEach(cb => cb.addEventListener('change', async () => {\n      const id = cb.closest('.todo-row').dataset.id;\n      await api(`/api/job-todos/${id}`, { method: 'PUT', body: { done: cb.checked } });\n      loadTodos();\n    }));\n    document.querySelectorAll('.todo-row .td-delete').forEach(btn => btn.addEventListener('click', async () => {\n      const id = btn.closest('.todo-row').dataset.id;\n      await api(`/api/job-todos/${id}`, { method: 'DELETE' });\n      loadTodos();\n    }));\n  }\n  document.getElementById('add-todo').addEventListener('click', async () => {\n    const input = document.getElementById('new-todo');\n    if (!input.value.trim()) return;\n    await api('/api/job-todos', { method: 'POST', body: { job_id: jobId, description: input.value.trim(), category: todoCat } });\n    input.value = '';\n    loadTodos();\n  });\n\n  // ---- Permits ----\n  function fileToBase64(file) {\n    return new Promise((resolve, reject) => {\n      const reader = new FileReader();\n      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');\n      reader.onerror = reject;\n      reader.readAsDataURL(file);\n    });\n  }\n  async function loadPermits() {\n    const permits = await api(`/api/job-permits?job_id=${jobId}`);\n    document.getElementById('permit-list').innerHTML = permits.map(p => `\n      <div class=\"permit-row\" data-id=\"${p.id}\">\n        <label>${p.permit_number ? escapeHtml(p.permit_number) + ' — ' : ''}${escapeHtml(p.file_name || 'no file')} <span class=\"subtitle\">(${fmtDate(p.uploaded_at.slice(0,10))})</span></label>\n        ${p.file_name ? `<a class=\"btn secondary small\" href=\"/api/job-permits/${p.id}/file\" target=\"_blank\">View</a>` : ''}\n        <button type=\"button\" class=\"btn secondary small permit-delete\">Remove</button>\n      </div>\n    `).join('') || '<p class=\"subtitle\">No permits uploaded yet.</p>';\n    document.querySelectorAll('.permit-row .permit-delete').forEach(btn => btn.addEventListener('click', async () => {\n      const id = btn.closest('.permit-row').dataset.id;\n      await api(`/api/job-permits/${id}`, { method: 'DELETE' });\n      loadPermits();\n    }));\n  }\n  document.getElementById('add-permit').addEventListener('click', async () => {\n    const msg = document.getElementById('permit-msg');\n    const fileInput = document.getElementById('new-permit-file');\n    const permitNumber = document.getElementById('new-permit-number').value.trim();\n    const file = fileInput.files[0];\n    if (!permitNumber && !file) { msg.innerHTML = '<div class=\"error-msg\">Add a permit number or a file.</div>'; return; }\n    try {\n      const body = { job_id: jobId, permit_number: permitNumber || null };\n      if (file) {\n        body.file_name = file.name;\n        body.file_type = file.type || 'application/pdf';\n        body.file_base64 = await fileToBase64(file);\n      }\n      await api('/api/job-permits', { method: 'POST', body });\n      document.getElementById('new-permit-number').value = '';\n      fileInput.value = '';\n      msg.innerHTML = '<div class=\"ok-msg\">Uploaded.</div>';\n      loadPermits();\n      load();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  // ---- Delete job ----\n  document.getElementById('delete-job').addEventListener('click', async () => {\n    if (!confirm(`Permanently delete job ${job.job_number}? This can't be undone.`)) return;\n    const msg = document.getElementById('delete-msg');\n    try {\n      await api(`/api/jobs/${jobId}`, { method: 'DELETE' });\n      msg.innerHTML = '<div class=\"ok-msg\">Job deleted. Returning to Jobs…</div>';\n      setTimeout(() => { window.location.href = '/jobs.html'; }, 700);\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  await load();\n})();\n</script>\n</body>\n</html>\n"
  },
  "jobs.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Jobs — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n<style>\n  th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }\n  th.sortable .arrow { opacity: 0.4; font-size: 11px; margin-left: 3px; }\n  th.sortable.sorted .arrow { opacity: 1; }\n  .followup-row { display:flex; justify-content:space-between; gap:10px; padding:8px 0; border-bottom:1px solid var(--line); }\n  .followup-row:last-child { border-bottom:none; }\n</style>\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <h1>Construction Jobs</h1>\n  <p class=\"subtitle\">Every job you've taken on, where it stands, and what's already booked for your crews and equipment.</p>\n\n  <div class=\"panel\" id=\"followups-panel\" style=\"display:none;\">\n    <h2>Follow Up Today</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:10px;\">These jobs have a check-in date that's arrived.</p>\n    <div id=\"followups-list\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>What's Booked (next 30 days)</h2>\n    <div class=\"table-wrap\">\n      <table id=\"capacity-table\">\n        <thead><tr><th>Crew / Equipment</th><th>Job</th><th>Customer</th><th>Dates</th><th>Status</th></tr></thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"capacity-empty\" style=\"display:none;\">Nothing booked in the next 30 days.</div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Add a Job</h2>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Customer Name</label><input id=\"nj_customer_name\" placeholder=\"required\"></div>\n      <div class=\"field\"><label>Customer Phone</label><input id=\"nj_customer_phone\"></div>\n      <div class=\"field\"><label>Site Address</label><input id=\"nj_site_address\"></div>\n    </div>\n    <div class=\"field-row\">\n      <div class=\"field\" style=\"flex:2;\"><label>Scope of Work</label><input id=\"nj_scope\" placeholder=\"e.g. driveway excavation & grading\"></div>\n      <div class=\"field\"><label>Price ($)</label><input type=\"number\" step=\"0.01\" id=\"nj_price\"></div>\n    </div>\n    <div class=\"field-row\">\n      <div class=\"field\"><label>Target Start Date</label><input type=\"date\" id=\"nj_start\"></div>\n      <div class=\"field\"><label>Duration (days)</label><input type=\"number\" step=\"0.5\" min=\"0.5\" id=\"nj_duration\" value=\"1\"></div>\n      <div class=\"field\"><label>Crew</label><select id=\"nj_crew\"><option value=\"\">— Unassigned —</option></select></div>\n      <div class=\"field\"><label>Status</label><select id=\"nj_status\"></select></div>\n    </div>\n    <button type=\"button\" id=\"add-job\">Add Job</button>\n    <div id=\"add-job-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <div class=\"field-row\" style=\"align-items:flex-end; flex-wrap:wrap;\">\n      <div class=\"field\" style=\"flex:2; min-width:220px;\">\n        <label>Search</label>\n        <input id=\"search\" placeholder=\"Job #, customer, address, scope...\">\n      </div>\n      <div class=\"field\" style=\"max-width:200px;\">\n        <label>Status</label>\n        <select id=\"status-filter\"><option value=\"\">All statuses</option></select>\n      </div>\n      <div class=\"field\" style=\"max-width:200px;\">\n        <label>Crew</label>\n        <select id=\"crew-filter\"><option value=\"\">All crews</option></select>\n      </div>\n      <div class=\"field\" style=\"flex:none;\">\n        <button type=\"button\" class=\"btn secondary\" id=\"clear-filters\">Clear</button>\n      </div>\n    </div>\n    <div id=\"result-count\" class=\"subtitle\" style=\"margin:6px 0 12px;\"></div>\n    <div class=\"table-wrap\">\n      <table id=\"jobs-table\">\n        <thead>\n          <tr>\n            <th class=\"sortable\" data-key=\"job_number\">Job # <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"customer_name\">Customer <span class=\"arrow\">▲</span></th>\n            <th>Site Address</th>\n            <th class=\"sortable\" data-key=\"target_start_date\">Target Start <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"crew_name\">Crew <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"price\">Price <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"status\">Status <span class=\"arrow\">▲</span></th>\n          </tr>\n        </thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"jobs-empty\" style=\"display:none;\">No jobs match those filters.</div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const JOB_STATUSES = ['inquiry', 'estimate_scheduled', 'quote_sent', 'accepted', 'scheduled', 'deposit_received', 'in_progress', 'complete', 'cancelled'];\n  const statusOptionsHtml = JOB_STATUSES.map(s => `<option value=\"${s}\">${fmtStatus(s)}</option>`).join('');\n  document.getElementById('nj_status').innerHTML = statusOptionsHtml;\n  document.getElementById('status-filter').innerHTML += statusOptionsHtml;\n\n  const [jobs, crews] = await Promise.all([api('/api/jobs'), api('/api/crews')]);\n  const crewOptionsHtml = crews.map(c => `<option value=\"${c.id}\">${escapeHtml(c.name)}</option>`).join('');\n  document.getElementById('nj_crew').innerHTML += crewOptionsHtml;\n  document.getElementById('crew-filter').innerHTML += crews.map(c => `<option value=\"${c.id}\">${escapeHtml(c.name)}</option>`).join('');\n\n  // ---- Follow-ups ----\n  const followups = await api('/api/jobs/followups-due');\n  if (followups.length) {\n    document.getElementById('followups-panel').style.display = '';\n    document.getElementById('followups-list').innerHTML = followups.map(j => `\n      <div class=\"followup-row\">\n        <div><a href=\"/job-detail.html?id=${j.id}\">${j.job_number}</a> — ${escapeHtml(j.customer_name)}${j.followup_note ? ' — ' + escapeHtml(j.followup_note) : ''}</div>\n        <div>${badge(j.status)}</div>\n      </div>\n    `).join('');\n  }\n\n  // ---- Capacity / what's booked ----\n  const today = new Date();\n  const in30 = new Date(today); in30.setDate(in30.getDate() + 30);\n  const cap = await api(`/api/jobs/capacity?start=${today.toISOString().slice(0,10)}&end=${in30.toISOString().slice(0,10)}`);\n  const capRows = [\n    ...cap.crewBookings.map(b => ({ who: b.crew_name || 'Crew', job_id: b.job_id, job_number: b.job_number, customer_name: b.customer_name, start: b.start, end: b.end, status: b.status })),\n    ...cap.equipmentBookings.map(b => ({ who: b.equipment_name, job_id: b.job_id, job_number: b.job_number, customer_name: b.customer_name, start: b.start_date, end: b.end_date, status: b.job_status })),\n  ].sort((a, b) => (a.start || '').localeCompare(b.start || ''));\n  document.getElementById('capacity-empty').style.display = capRows.length ? 'none' : 'block';\n  document.querySelector('#capacity-table tbody').innerHTML = capRows.map(r => `\n    <tr>\n      <td>${escapeHtml(r.who)}</td>\n      <td><a href=\"/job-detail.html?id=${r.job_id || ''}\">${r.job_number}</a></td>\n      <td>${escapeHtml(r.customer_name)}</td>\n      <td>${fmtDate(r.start)}${r.end && r.end !== r.start ? ' – ' + fmtDate(r.end) : ''}</td>\n      <td>${badge(r.status)}</td>\n    </tr>\n  `).join('');\n\n  // ---- Add job ----\n  document.getElementById('add-job').addEventListener('click', async () => {\n    const msg = document.getElementById('add-job-msg');\n    try {\n      const customer_name = document.getElementById('nj_customer_name').value.trim();\n      if (!customer_name) { msg.innerHTML = '<div class=\"error-msg\">Customer name is required.</div>'; return; }\n      const job = await api('/api/jobs', { method: 'POST', body: {\n        customer_name,\n        customer_phone: document.getElementById('nj_customer_phone').value,\n        site_address: document.getElementById('nj_site_address').value,\n        scope: document.getElementById('nj_scope').value,\n        price: document.getElementById('nj_price').value,\n        target_start_date: document.getElementById('nj_start').value,\n        duration_days: document.getElementById('nj_duration').value,\n        crew_id: document.getElementById('nj_crew').value || null,\n        status: document.getElementById('nj_status').value,\n      }});\n      window.location.href = `/job-detail.html?id=${job.id}`;\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  // ---- List / filter / sort ----\n  let sortKey = 'target_start_date';\n  let sortDir = 1;\n\n  function applyAndRender() {\n    const q = document.getElementById('search').value.trim().toLowerCase();\n    const status = document.getElementById('status-filter').value;\n    const crewId = document.getElementById('crew-filter').value;\n\n    let rows = jobs.filter(j => {\n      if (status && j.status !== status) return false;\n      if (crewId && String(j.crew_id) !== crewId) return false;\n      if (q) {\n        const hay = [j.job_number, j.customer_name, j.site_address, j.scope].filter(Boolean).join(' ').toLowerCase();\n        if (!hay.includes(q)) return false;\n      }\n      return true;\n    });\n\n    rows = rows.slice().sort((a, b) => {\n      let av = a[sortKey], bv = b[sortKey];\n      if (av === null || av === undefined) av = '';\n      if (bv === null || bv === undefined) bv = '';\n      if (typeof av === 'string') av = av.toLowerCase();\n      if (typeof bv === 'string') bv = bv.toLowerCase();\n      if (av < bv) return -1 * sortDir;\n      if (av > bv) return 1 * sortDir;\n      return 0;\n    });\n\n    document.getElementById('result-count').textContent = `${rows.length} job${rows.length === 1 ? '' : 's'}`;\n    document.getElementById('jobs-empty').style.display = rows.length ? 'none' : 'block';\n    document.querySelector('#jobs-table tbody').innerHTML = rows.map(j => `\n      <tr class=\"row-link\" data-href=\"/job-detail.html?id=${j.id}\">\n        <td>${j.job_number}</td>\n        <td>${escapeHtml(j.customer_name)}</td>\n        <td>${escapeHtml(j.site_address || '—')}</td>\n        <td>${j.target_start_date ? fmtDate(j.target_start_date) : '—'}</td>\n        <td>${escapeHtml(j.crew_name || '—')}</td>\n        <td>${j.price !== null && j.price !== undefined ? fmtMoney(j.price) : '—'}</td>\n        <td>${badge(j.status)}</td>\n      </tr>\n    `).join('');\n    document.querySelectorAll('#jobs-table tbody tr.row-link').forEach(tr => {\n      tr.addEventListener('click', () => { window.location.href = tr.dataset.href; });\n    });\n\n    document.querySelectorAll('th.sortable').forEach(th => {\n      th.classList.toggle('sorted', th.dataset.key === sortKey);\n      th.querySelector('.arrow').textContent = (th.dataset.key === sortKey && sortDir === -1) ? '▼' : '▲';\n    });\n  }\n\n  document.querySelectorAll('th.sortable').forEach(th => {\n    th.addEventListener('click', () => {\n      const key = th.dataset.key;\n      if (sortKey === key) { sortDir *= -1; } else { sortKey = key; sortDir = 1; }\n      applyAndRender();\n    });\n  });\n\n  ['search'].forEach(id => document.getElementById(id).addEventListener('input', applyAndRender));\n  ['status-filter', 'crew-filter'].forEach(id => document.getElementById(id).addEventListener('change', applyAndRender));\n  document.getElementById('clear-filters').addEventListener('click', () => {\n    document.getElementById('search').value = '';\n    document.getElementById('status-filter').value = '';\n    document.getElementById('crew-filter').value = '';\n    applyAndRender();\n  });\n\n  applyAndRender();\n})();\n</script>\n</body>\n</html>\n"
  },
  "js/app.js": {
    "encoding": "utf8",
    "content": "async function api(path, opts = {}) {\n  const res = await fetch(path, {\n    method: opts.method || 'GET',\n    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,\n    body: opts.body ? JSON.stringify(opts.body) : undefined,\n  });\n  let data = null;\n  try { data = await res.json(); } catch (e) { /* no body */ }\n  if (!res.ok) {\n    const err = new Error((data && data.error) || `Request failed (${res.status})`);\n    err.status = res.status;\n    throw err;\n  }\n  return data;\n}\n\nfunction fmtMoney(n) {\n  return '$' + (Number(n) || 0).toFixed(2);\n}\n\n// Escapes text for safe use inside an HTML attribute or text node built via\n// template-literal string concatenation (this app doesn't use a templating\n// library, so this guards against values like a material name containing a\n// literal \" — e.g. 1/2\" Screened Loam — which would otherwise break out of\n// a value=\"...\" attribute and silently truncate on the next Save).\nfunction escapeHtml(s) {\n  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;').replace(/'/g, '&#39;');\n}\n\nfunction fmtDate(d) {\n  if (!d) return '—';\n  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);\n  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });\n}\n\nfunction fmtStatus(s) {\n  return (s || '').replace(/_/g, ' ').replace(/\\b\\w/g, (c) => c.toUpperCase());\n}\n\nfunction badge(status) {\n  return `<span class=\"badge ${status}\">${fmtStatus(status)}</span>`;\n}\n\nasync function requireSession(allowedRoles) {\n  try {\n    const me = await api('/api/me');\n    if (!me.loggedIn) { window.location.href = '/'; return null; }\n    if (allowedRoles && !allowedRoles.includes(me.role)) {\n      window.location.href = me.role === 'driver' ? '/driver.html' : '/dashboard.html';\n      return null;\n    }\n    renderTopbar(me);\n    return me;\n  } catch (e) {\n    window.location.href = '/';\n    return null;\n  }\n}\n\nfunction renderTopbar(me) {\n  const el = document.getElementById('topbar-who');\n  if (!el) return;\n  el.innerHTML = `<span>${me.name}</span> <button class=\"btn secondary small\" id=\"logout-btn\">Log out</button>`;\n  document.getElementById('logout-btn').addEventListener('click', async () => {\n    await api('/api/logout', { method: 'POST' });\n    window.location.href = '/';\n  });\n  const path = window.location.pathname;\n  document.querySelectorAll('.topbar nav a').forEach((a) => {\n    if (a.getAttribute('href') === path) a.classList.add('active');\n  });\n}\n"
  },
  "new-order.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>New Order — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container narrow\">\n  <h1>New Material Order</h1>\n  <p class=\"subtitle\">Take down the order now — you can assign a driver and delivery date right away, or leave it unscheduled for dispatch to sort out later.</p>\n\n  <div class=\"panel\">\n    <form id=\"order-form\">\n      <div class=\"field\">\n        <label>Order Date</label>\n        <div id=\"order-date-display\" style=\"padding:8px 0; color:var(--ink-soft);\"></div>\n      </div>\n      <div class=\"field\">\n        <label>Customer</label>\n        <select id=\"customer_id\"></select>\n      </div>\n      <button type=\"button\" class=\"btn secondary small\" id=\"new-customer-toggle\" style=\"margin:-8px 0 14px;\">+ Add a new customer</button>\n      <div id=\"new-customer-fields\" style=\"display:none;\">\n        <div class=\"field-row\">\n          <div class=\"field\"><label>New Customer Name</label><input id=\"nc_name\"></div>\n          <div class=\"field\"><label>Phone</label><input id=\"nc_phone\"></div>\n        </div>\n        <div class=\"field\"><label>Billing Address</label><input id=\"nc_address\"></div>\n      </div>\n\n      <div class=\"field-row\">\n        <div class=\"field\">\n          <label>Material</label>\n          <select id=\"material_id\" required></select>\n        </div>\n        <div class=\"field\">\n          <label>Quantity</label>\n          <input type=\"number\" step=\"0.25\" min=\"0.25\" id=\"quantity\" required>\n        </div>\n      </div>\n\n      <div class=\"field\">\n        <label>Price per unit ($)</label>\n        <input type=\"number\" step=\"0.01\" id=\"price_per_unit\">\n      </div>\n\n      <div class=\"field\">\n        <label>Delivery Address</label>\n        <div style=\"display:flex; gap:8px;\">\n          <input id=\"delivery_address\" required style=\"flex:1;\">\n          <button type=\"button\" class=\"btn secondary small\" id=\"estimate-btn\" style=\"flex:none;\">Estimate Delivery</button>\n        </div>\n        <div id=\"estimate-result\" style=\"margin-top:6px; font-size:13px;\"></div>\n      </div>\n\n      <div class=\"field-row\">\n        <div class=\"field\">\n          <label>Delivery Fee ($)</label>\n          <input type=\"number\" step=\"0.01\" id=\"delivery_fee\" placeholder=\"0.00\">\n          <input type=\"hidden\" id=\"distance_miles\">\n        </div>\n      </div>\n\n      <div class=\"field\">\n        <label>Delivery Timing</label>\n        <div style=\"display:flex; gap:18px; align-items:center; padding:8px 0;\">\n          <label style=\"display:flex; align-items:center; gap:6px; font-weight:400;\">\n            <input type=\"radio\" name=\"timing\" id=\"timing-asap\" value=\"asap\" checked> ASAP\n          </label>\n          <label style=\"display:flex; align-items:center; gap:6px; font-weight:400;\">\n            <input type=\"radio\" name=\"timing\" id=\"timing-date\" value=\"date\"> Requested Date\n          </label>\n          <input type=\"date\" id=\"requested_date\" style=\"display:none; flex:none;\">\n        </div>\n      </div>\n\n      <div class=\"field\">\n        <label>Notes</label>\n        <textarea id=\"notes\" rows=\"2\" placeholder=\"Gate code, site contact, access notes...\"></textarea>\n      </div>\n\n      <div class=\"panel\" id=\"total-panel\" style=\"background:var(--bg-soft, #f6f6f4); margin:16px 0;\">\n        <div class=\"grid cols-2\">\n          <div><label>Materials Subtotal</label><div id=\"total-materials\">$0.00</div></div>\n          <div><label id=\"total-tax-label\">Sales Tax</label><div id=\"total-tax\">$0.00</div></div>\n          <div><label>Delivery Fee</label><div id=\"total-delivery\">$0.00</div></div>\n          <div><label>Order Total</label><div id=\"total-grand\" style=\"font-size:18px; font-weight:700;\">$0.00</div></div>\n        </div>\n      </div>\n\n      <h2 style=\"margin-top:20px;\">Schedule now (optional)</h2>\n      <div class=\"field-row\">\n        <div class=\"field\">\n          <label>Assign Driver</label>\n          <select id=\"driver_id\"><option value=\"\">— Leave unassigned —</option></select>\n        </div>\n        <div class=\"field\">\n          <label>Delivery Date</label>\n          <input type=\"date\" id=\"scheduled_date\">\n        </div>\n        <div class=\"field\">\n          <label>Time</label>\n          <input id=\"scheduled_time\" placeholder=\"e.g. 9:00 AM\">\n        </div>\n      </div>\n\n      <div id=\"msg\"></div>\n      <button type=\"submit\" style=\"width:100%;\">Create Order</button>\n    </form>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const [customers, materials, drivers, settings] = await Promise.all([\n    api('/api/customers'), api('/api/materials'), api('/api/drivers'), api('/api/settings'),\n  ]);\n\n  const taxRatePercent = settings.sales_tax_rate !== undefined && settings.sales_tax_rate !== ''\n    ? Number(settings.sales_tax_rate) : 7;\n  document.getElementById('total-tax-label').textContent = `Sales Tax (${taxRatePercent}%, materials only)`;\n  document.getElementById('order-date-display').textContent = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });\n\n  function recalcTotal() {\n    const quantity = Number(document.getElementById('quantity').value) || 0;\n    const pricePerUnit = Number(document.getElementById('price_per_unit').value) || 0;\n    const deliveryFee = Number(document.getElementById('delivery_fee').value) || 0;\n    const materialCost = quantity * pricePerUnit;\n    const salesTax = materialCost * (taxRatePercent / 100);\n    const total = materialCost + salesTax + deliveryFee;\n    document.getElementById('total-materials').textContent = fmtMoney(materialCost);\n    document.getElementById('total-tax').textContent = fmtMoney(salesTax);\n    document.getElementById('total-delivery').textContent = fmtMoney(deliveryFee);\n    document.getElementById('total-grand').textContent = fmtMoney(total);\n  }\n  ['quantity', 'price_per_unit', 'delivery_fee'].forEach((id) => {\n    document.getElementById(id).addEventListener('input', recalcTotal);\n  });\n\n  const requestedDateInput = document.getElementById('requested_date');\n  document.querySelectorAll('input[name=\"timing\"]').forEach((el) => {\n    el.addEventListener('change', () => {\n      const isDate = document.getElementById('timing-date').checked;\n      requestedDateInput.style.display = isDate ? '' : 'none';\n      if (!isDate) requestedDateInput.value = '';\n    });\n  });\n\n  document.getElementById('customer_id').innerHTML =\n    '<option value=\"\">— Select customer —</option>' +\n    customers.map(c => `<option value=\"${c.id}\">${c.name}</option>`).join('');\n\n  const materialSelect = document.getElementById('material_id');\n  materialSelect.innerHTML = materials.map(m => `<option value=\"${m.id}\" data-price=\"${m.default_price}\" data-unit=\"${m.unit}\">${m.name} (${m.unit}, ${fmtMoney(m.default_price)})</option>`).join('');\n  materialSelect.addEventListener('change', () => {\n    const opt = materialSelect.selectedOptions[0];\n    document.getElementById('price_per_unit').value = opt.dataset.price;\n    recalcTotal();\n  });\n  if (materials.length) document.getElementById('price_per_unit').value = materials[0].default_price;\n\n  document.getElementById('driver_id').innerHTML += drivers.map(d => `<option value=\"${d.id}\">${d.name}${d.truck_label ? ' — ' + d.truck_label : ''}</option>`).join('');\n\n  // Prefill from a Quick Quote (quote.html \"Turn Into an Order\" link)\n  const qp = new URLSearchParams(window.location.search);\n  if (qp.get('material_id')) materialSelect.value = qp.get('material_id');\n  if (qp.get('price_per_unit')) document.getElementById('price_per_unit').value = qp.get('price_per_unit');\n  if (qp.get('quantity')) document.getElementById('quantity').value = qp.get('quantity');\n  if (qp.get('delivery_address')) document.getElementById('delivery_address').value = qp.get('delivery_address');\n  if (qp.get('distance_miles')) document.getElementById('distance_miles').value = qp.get('distance_miles');\n  if (qp.get('delivery_fee')) document.getElementById('delivery_fee').value = qp.get('delivery_fee');\n  recalcTotal();\n  if (qp.get('delivery_address')) {\n    document.getElementById('estimate-result').innerHTML = qp.get('delivery_fee')\n      ? '<span class=\"ok-msg\">Carried over from Quick Quote.</span>'\n      : '<span style=\"color:var(--ink-soft);\">Carried over from Quick Quote — click \"Estimate Delivery\" to price it, or enter manually.</span>';\n  }\n\n  document.getElementById('new-customer-toggle').addEventListener('click', () => {\n    const el = document.getElementById('new-customer-fields');\n    el.style.display = el.style.display === 'none' ? 'block' : 'none';\n  });\n\n  document.getElementById('estimate-btn').addEventListener('click', async () => {\n    const address = document.getElementById('delivery_address').value.trim();\n    const resultEl = document.getElementById('estimate-result');\n    if (!address) { resultEl.innerHTML = '<span class=\"error-msg\">Enter a delivery address first.</span>'; return; }\n    resultEl.innerHTML = '<span style=\"color:var(--ink-soft);\">Estimating…</span>';\n    try {\n      const est = await api('/api/estimate-distance', { method: 'POST', body: { address } });\n      document.getElementById('distance_miles').value = est.miles;\n      if (est.fee !== null && est.fee !== undefined) {\n        document.getElementById('delivery_fee').value = est.fee;\n        resultEl.innerHTML = `<span class=\"ok-msg\">${est.miles} mi from the shop — ${est.band_label}: ${fmtMoney(est.fee)}</span>`;\n      } else {\n        resultEl.innerHTML = `<span class=\"error-msg\">${est.miles} mi from the shop — ${est.band_label}</span>`;\n      }\n      recalcTotal();\n    } catch (err) {\n      resultEl.innerHTML = `<span class=\"error-msg\">${err.message}</span>`;\n    }\n  });\n\n  document.getElementById('order-form').addEventListener('submit', async (e) => {\n    e.preventDefault();\n    const msg = document.getElementById('msg');\n    msg.innerHTML = '';\n    try {\n      let customerId = document.getElementById('customer_id').value;\n      const ncName = document.getElementById('nc_name').value.trim();\n      if (ncName) {\n        const newCustomer = await api('/api/customers', { method: 'POST', body: {\n          name: ncName,\n          phone: document.getElementById('nc_phone').value,\n          billing_address: document.getElementById('nc_address').value,\n        }});\n        customerId = newCustomer.id;\n      }\n      if (!customerId) { msg.innerHTML = '<div class=\"error-msg\">Select or add a customer.</div>'; return; }\n      if (document.getElementById('timing-date').checked && !document.getElementById('requested_date').value) {\n        msg.innerHTML = '<div class=\"error-msg\">Pick a requested date, or switch to ASAP.</div>'; return;\n      }\n\n      const order = await api('/api/orders', { method: 'POST', body: {\n        customer_id: Number(customerId),\n        material_id: Number(document.getElementById('material_id').value),\n        quantity: Number(document.getElementById('quantity').value),\n        price_per_unit: Number(document.getElementById('price_per_unit').value),\n        delivery_address: document.getElementById('delivery_address').value,\n        distance_miles: document.getElementById('distance_miles').value || null,\n        delivery_fee: Number(document.getElementById('delivery_fee').value) || 0,\n        requested_date: document.getElementById('timing-date').checked ? (document.getElementById('requested_date').value || null) : null,\n        requested_window: document.getElementById('timing-asap').checked ? 'ASAP' : null,\n        notes: document.getElementById('notes').value || null,\n        driver_id: document.getElementById('driver_id').value || null,\n        scheduled_date: document.getElementById('scheduled_date').value || null,\n        scheduled_time: document.getElementById('scheduled_time').value || null,\n      }});\n      msg.innerHTML = `<div class=\"ok-msg\">Order ${order.order_number} created.</div>`;\n      setTimeout(() => { window.location.href = '/schedule.html'; }, 700);\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n})();\n</script>\n</body>\n</html>\n"
  },
  "order-detail.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Order — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container narrow\">\n  <p class=\"subtitle\"><a href=\"/schedule.html\">&larr; Back to Schedule</a></p>\n  <div id=\"order-head\">\n    <h1 id=\"order-title\">Loading…</h1>\n  </div>\n\n  <div class=\"panel\" id=\"order-info\"></div>\n\n  <div class=\"panel\">\n    <h2>Status</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:14px;\">These act on every truckload below at once — use the per-delivery controls if only some of them are done.</p>\n    <div id=\"status-actions\" style=\"margin-bottom:0; display:flex; gap:8px; flex-wrap:wrap;\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Deliveries</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:14px;\">Orders over 20 yards split into one truckload per 20 yards. Each one schedules automatically — reassign the driver or date here if needed.</p>\n    <div class=\"table-wrap\">\n      <table id=\"deliveries-table\">\n        <thead><tr><th>#</th><th>Qty</th><th>Driver</th><th>Date</th><th>Status</th><th></th></tr></thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div id=\"deliveries-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Square Invoice Tracking</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:14px;\">Use this if you invoiced this order through Square instead of the built-in invoicing above. It's just a record — nothing here talks to Square.</p>\n    <div class=\"checkbox-row\" style=\"margin-bottom:14px;\">\n      <input type=\"checkbox\" id=\"square_invoiced\">\n      <label style=\"margin:0;\">Invoiced on Square</label>\n    </div>\n    <div class=\"field-row\">\n      <div class=\"field\">\n        <label>Square Invoice #</label>\n        <input id=\"square_invoice_number\" placeholder=\"e.g. INV-1042\">\n      </div>\n      <div class=\"field\">\n        <label>Payment Status</label>\n        <select id=\"square_paid\">\n          <option value=\"0\">Unpaid</option>\n          <option value=\"1\">Paid</option>\n        </select>\n      </div>\n    </div>\n    <button type=\"button\" id=\"save-square\">Save</button>\n    <div id=\"square-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>Delete Order</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:14px;\">Permanently removes this order. Can't be undone. Orders already on an invoice can't be deleted this way — remove them from the invoice first.</p>\n    <button type=\"button\" class=\"btn danger\" id=\"delete-order\">Delete This Order</button>\n    <div id=\"delete-msg\" style=\"margin-top:10px;\"></div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const orderId = new URLSearchParams(window.location.search).get('id');\n  if (!orderId) { document.getElementById('order-title').textContent = 'No order specified.'; return; }\n\n  const drivers = await api('/api/drivers');\n  const driverOptionsHtml = '<option value=\"\">— Unassigned —</option>' + drivers.map(d => `<option value=\"${d.id}\">${d.name}${d.truck_label ? ' — ' + d.truck_label : ''}</option>`).join('');\n\n  let order;\n  async function load() {\n    order = await api(`/api/orders/${orderId}`);\n    document.getElementById('order-title').innerHTML = `${order.order_number} ${badge(order.status)}`;\n    document.getElementById('order-info').innerHTML = `\n      <div class=\"grid cols-2\">\n        <div><label>Customer</label><div>${order.customer_name}${order.customer_phone ? ' — ' + order.customer_phone : ''}</div></div>\n        <div><label>Material</label><div>${order.quantity} ${order.unit} ${order.material_name} @ ${fmtMoney(order.price_per_unit)}</div></div>\n        <div><label>Delivery Address</label><div>${order.delivery_address}</div></div>\n        <div><label>Delivery Fee</label><div>${order.delivery_fee ? fmtMoney(order.delivery_fee) + (order.distance_miles ? ` (${order.distance_miles} mi)` : '') : '—'}</div></div>\n        <div><label>Sales Tax${order.sales_tax_rate ? ` (${order.sales_tax_rate}%, materials only)` : ''}</label><div>${fmtMoney(order.sales_tax_amount || 0)}</div></div>\n        <div><label>Order Total</label><div style=\"font-weight:700;\">${fmtMoney(order.total_amount || 0)}</div></div>\n        <div><label>Order Date</label><div>${order.created_at ? fmtDate(order.created_at.slice(0, 10)) : '—'}</div></div>\n        <div><label>Requested</label><div>${order.requested_window === 'ASAP' ? 'ASAP' : (order.requested_date ? fmtDate(order.requested_date) + (order.requested_window ? ' · ' + order.requested_window : '') : '—')}</div></div>\n        <div><label>Notes</label><div>${order.notes || '—'}</div></div>\n      </div>\n    `;\n    document.getElementById('square_invoiced').checked = Boolean(order.square_invoiced);\n    document.getElementById('square_invoice_number').value = order.square_invoice_number || '';\n    document.getElementById('square_paid').value = order.square_paid ? '1' : '0';\n\n    const actions = document.getElementById('status-actions');\n    const buttons = [];\n    if (order.status !== 'cancelled' && order.status !== 'delivered' && order.status !== 'invoiced') {\n      if (order.status !== 'out_for_delivery') buttons.push(['out_for_delivery', 'Mark Out for Delivery', 'secondary']);\n      buttons.push(['delivered', 'Mark Delivered', '']);\n      buttons.push(['cancelled', 'Cancel Order', 'secondary']);\n    }\n    actions.innerHTML = buttons.map(([status, label, cls]) => `<button type=\"button\" class=\"btn ${cls}\" data-status=\"${status}\">${label}</button>`).join('') || '<span class=\"subtitle\">No further status changes available.</span>';\n    actions.querySelectorAll('button').forEach(btn => btn.addEventListener('click', async () => {\n      await api(`/api/orders/${orderId}`, { method: 'PUT', body: { status: btn.dataset.status } });\n      load();\n    }));\n\n    await loadDeliveries();\n  }\n\n  async function loadDeliveries() {\n    const deliveries = await api(`/api/deliveries?order_id=${orderId}`);\n    const msg = document.getElementById('deliveries-msg');\n    document.querySelector('#deliveries-table tbody').innerHTML = deliveries.map(d => `\n      <tr data-id=\"${d.id}\">\n        <td>${d.sequence}${deliveries.length > 1 ? ` of ${deliveries.length}` : ''}</td>\n        <td>${d.quantity} ${d.unit}</td>\n        <td><select class=\"d-driver\" ${d.status === 'delivered' ? 'disabled' : ''}>${driverOptionsHtml}</select></td>\n        <td><input type=\"date\" class=\"d-date\" value=\"${d.scheduled_date || ''}\" ${d.status === 'delivered' ? 'disabled' : ''}></td>\n        <td>${badge(d.status)}</td>\n        <td style=\"display:flex; gap:6px; flex-wrap:wrap;\">\n          ${d.status === 'delivered' ? '' : `<button type=\"button\" class=\"btn small save-delivery\">Save</button>`}\n          ${d.status === 'scheduled' ? `<button type=\"button\" class=\"btn secondary small start-delivery\">Start</button>` : ''}\n          ${d.status !== 'delivered' && d.status !== 'unscheduled' ? `<button type=\"button\" class=\"btn small deliver-delivery\">Deliver</button>` : ''}\n        </td>\n      </tr>\n    `).join('');\n    document.querySelectorAll('#deliveries-table .d-driver').forEach(sel => {\n      const tr = sel.closest('tr');\n      const d = deliveries.find(x => String(x.id) === tr.dataset.id);\n      sel.value = d.driver_id || '';\n    });\n    document.querySelectorAll('#deliveries-table .save-delivery').forEach(btn => btn.addEventListener('click', async () => {\n      const tr = btn.closest('tr');\n      const driverId = tr.querySelector('.d-driver').value;\n      const date = tr.querySelector('.d-date').value;\n      try {\n        if (!driverId || !date) {\n          await api(`/api/deliveries/${tr.dataset.id}`, { method: 'PUT', body: { unschedule: true } });\n        } else {\n          await api(`/api/deliveries/${tr.dataset.id}`, { method: 'PUT', body: { driver_id: Number(driverId), scheduled_date: date } });\n        }\n        msg.innerHTML = '<div class=\"ok-msg\">Saved.</div>';\n        await load();\n      } catch (err) {\n        msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n      }\n    }));\n    document.querySelectorAll('#deliveries-table .start-delivery').forEach(btn => btn.addEventListener('click', async () => {\n      const tr = btn.closest('tr');\n      await api(`/api/deliveries/${tr.dataset.id}/start`, { method: 'POST' });\n      await load();\n    }));\n    document.querySelectorAll('#deliveries-table .deliver-delivery').forEach(btn => btn.addEventListener('click', async () => {\n      const tr = btn.closest('tr');\n      await api(`/api/deliveries/${tr.dataset.id}/deliver`, { method: 'POST' });\n      await load();\n    }));\n  }\n\n  document.getElementById('save-square').addEventListener('click', async () => {\n    const msg = document.getElementById('square-msg');\n    try {\n      await api(`/api/orders/${orderId}`, { method: 'PUT', body: {\n        square_invoiced: document.getElementById('square_invoiced').checked,\n        square_invoice_number: document.getElementById('square_invoice_number').value || null,\n        square_paid: document.getElementById('square_paid').value === '1',\n      }});\n      msg.innerHTML = '<div class=\"ok-msg\">Saved.</div>';\n      load();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  document.getElementById('delete-order').addEventListener('click', async () => {\n    if (!confirm(`Permanently delete order ${order.order_number}? This can't be undone.`)) return;\n    const msg = document.getElementById('delete-msg');\n    try {\n      await api(`/api/orders/${orderId}`, { method: 'DELETE' });\n      msg.innerHTML = '<div class=\"ok-msg\">Order deleted. Returning to schedule…</div>';\n      setTimeout(() => { window.location.href = '/schedule.html'; }, 700);\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  await load();\n})();\n</script>\n</body>\n</html>\n"
  },
  "orders-database.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>All Orders — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n<style>\n  th.sortable { cursor: pointer; user-select: none; white-space: nowrap; }\n  th.sortable .arrow { opacity: 0.4; font-size: 11px; margin-left: 3px; }\n  th.sortable.sorted .arrow { opacity: 1; }\n</style>\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <h1>All Orders</h1>\n  <p class=\"subtitle\">Every order in one place — search, filter, and sort. Click a row to open it.</p>\n\n  <div class=\"panel\">\n    <div class=\"field-row\" style=\"align-items:flex-end; flex-wrap:wrap;\">\n      <div class=\"field\" style=\"flex:2; min-width:220px;\">\n        <label>Search</label>\n        <input id=\"search\" placeholder=\"Order #, customer, address, material...\">\n      </div>\n      <div class=\"field\" style=\"max-width:180px;\">\n        <label>Status</label>\n        <select id=\"status-filter\">\n          <option value=\"\">All statuses</option>\n          <option value=\"new\">New</option>\n          <option value=\"scheduled\">Scheduled</option>\n          <option value=\"out_for_delivery\">Out for Delivery</option>\n          <option value=\"delivered\">Delivered</option>\n          <option value=\"invoiced\">Invoiced</option>\n          <option value=\"cancelled\">Cancelled</option>\n        </select>\n      </div>\n      <div class=\"field\" style=\"max-width:200px;\">\n        <label>Customer</label>\n        <select id=\"customer-filter\"><option value=\"\">All customers</option></select>\n      </div>\n      <div class=\"field\" style=\"max-width:200px;\">\n        <label>Driver</label>\n        <select id=\"driver-filter\"><option value=\"\">All drivers</option></select>\n      </div>\n      <div class=\"field\" style=\"flex:none;\">\n        <button type=\"button\" class=\"btn secondary\" id=\"clear-filters\">Clear</button>\n      </div>\n    </div>\n    <div id=\"result-count\" class=\"subtitle\" style=\"margin:6px 0 12px;\"></div>\n    <div class=\"table-wrap\">\n      <table id=\"orders-table\">\n        <thead>\n          <tr>\n            <th class=\"sortable\" data-key=\"order_number\">Order # <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"created_at\">Date <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"customer_name\">Customer <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"material_name\">Material <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"quantity\">Qty <span class=\"arrow\">▲</span></th>\n            <th>Address</th>\n            <th class=\"sortable\" data-key=\"driver_name\">Driver <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"scheduled_date\">Scheduled <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"status\">Status <span class=\"arrow\">▲</span></th>\n            <th class=\"sortable\" data-key=\"total_amount\">Total <span class=\"arrow\">▲</span></th>\n          </tr>\n        </thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"empty-msg\" style=\"display:none;\">No orders match those filters.</div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const [orders, customers, drivers] = await Promise.all([\n    api('/api/orders'), api('/api/customers'), api('/api/drivers'),\n  ]);\n\n  document.getElementById('customer-filter').innerHTML += customers.map(c => `<option value=\"${c.name}\">${c.name}</option>`).join('');\n  document.getElementById('driver-filter').innerHTML += drivers.map(d => `<option value=\"${d.name}\">${d.name}</option>`).join('');\n\n  let sortKey = 'created_at';\n  let sortDir = -1; // newest first by default\n\n  function applyAndRender() {\n    const q = document.getElementById('search').value.trim().toLowerCase();\n    const status = document.getElementById('status-filter').value;\n    const customer = document.getElementById('customer-filter').value;\n    const driver = document.getElementById('driver-filter').value;\n\n    let rows = orders.filter(o => {\n      if (status && o.status !== status) return false;\n      if (customer && o.customer_name !== customer) return false;\n      if (driver && o.driver_name !== driver) return false;\n      if (q) {\n        const hay = [o.order_number, o.customer_name, o.delivery_address, o.material_name, o.notes]\n          .filter(Boolean).join(' ').toLowerCase();\n        if (!hay.includes(q)) return false;\n      }\n      return true;\n    });\n\n    rows = rows.slice().sort((a, b) => {\n      let av = a[sortKey], bv = b[sortKey];\n      if (av === null || av === undefined) av = '';\n      if (bv === null || bv === undefined) bv = '';\n      if (typeof av === 'string') av = av.toLowerCase();\n      if (typeof bv === 'string') bv = bv.toLowerCase();\n      if (av < bv) return -1 * sortDir;\n      if (av > bv) return 1 * sortDir;\n      return 0;\n    });\n\n    document.getElementById('result-count').textContent = `${rows.length} order${rows.length === 1 ? '' : 's'}`;\n    document.getElementById('empty-msg').style.display = rows.length ? 'none' : 'block';\n    document.querySelector('#orders-table tbody').innerHTML = rows.map(o => `\n      <tr class=\"row-link\" data-href=\"/order-detail.html?id=${o.id}\">\n        <td>${o.order_number}</td>\n        <td>${o.created_at ? fmtDate(o.created_at.slice(0, 10)) : '—'}</td>\n        <td>${o.customer_name}</td>\n        <td>${o.material_name}</td>\n        <td>${o.quantity} ${o.unit}</td>\n        <td>${o.delivery_address}</td>\n        <td>${o.driver_name || '—'}</td>\n        <td>${o.scheduled_date ? fmtDate(o.scheduled_date) : (o.requested_window === 'ASAP' ? 'ASAP' : '—')}</td>\n        <td>${badge(o.status)}</td>\n        <td>${fmtMoney(o.total_amount || 0)}</td>\n      </tr>\n    `).join('');\n    document.querySelectorAll('#orders-table tbody tr.row-link').forEach(tr => {\n      tr.addEventListener('click', () => { window.location.href = tr.dataset.href; });\n    });\n\n    document.querySelectorAll('th.sortable').forEach(th => {\n      th.classList.toggle('sorted', th.dataset.key === sortKey);\n      th.querySelector('.arrow').textContent = (th.dataset.key === sortKey && sortDir === -1) ? '▼' : '▲';\n    });\n  }\n\n  document.querySelectorAll('th.sortable').forEach(th => {\n    th.addEventListener('click', () => {\n      const key = th.dataset.key;\n      if (sortKey === key) { sortDir *= -1; } else { sortKey = key; sortDir = 1; }\n      applyAndRender();\n    });\n  });\n\n  ['search'].forEach(id => document.getElementById(id).addEventListener('input', applyAndRender));\n  ['status-filter', 'customer-filter', 'driver-filter'].forEach(id => document.getElementById(id).addEventListener('change', applyAndRender));\n  document.getElementById('clear-filters').addEventListener('click', () => {\n    document.getElementById('search').value = '';\n    document.getElementById('status-filter').value = '';\n    document.getElementById('customer-filter').value = '';\n    document.getElementById('driver-filter').value = '';\n    applyAndRender();\n  });\n\n  applyAndRender();\n})();\n</script>\n</body>\n</html>\n"
  },
  "pay.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Pay Your Invoice — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <span class=\"brand\"><img src=\"/img/logo.png\" alt=\"OPD\" style=\"height:34px;width:34px;border-radius:50%;\"> OPD Development Corp</span>\n</div>\n\n<div class=\"container narrow\">\n  <div class=\"panel\" id=\"content\">Loading invoice…</div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const token = window.location.pathname.split('/pay/')[1];\n  const params = new URLSearchParams(window.location.search);\n  const el = document.getElementById('content');\n\n  async function load() {\n    let invoice;\n    try {\n      invoice = await api(`/api/pay/${token}`);\n    } catch (e) {\n      el.innerHTML = '<h1>Invoice Not Found</h1><p>This payment link is invalid or has expired. Please contact us for a new link.</p>';\n      return;\n    }\n\n    const balance = invoice.total - invoice.amount_paid;\n    const paidBanner = invoice.status === 'paid'\n      ? '<div class=\"ok-msg\" style=\"font-size:16px; margin-bottom:16px;\">✅ This invoice is paid in full. Thank you!</div>'\n      : (params.get('paid') === '1' ? '<div class=\"ok-msg\" style=\"font-size:16px; margin-bottom:16px;\">Payment received — thank you! (This page may take a moment to update the balance.)</div>' : '');\n\n    el.innerHTML = `\n      <h1>Invoice ${invoice.invoice_number}</h1>\n      <p class=\"subtitle\">${invoice.customer_name}</p>\n      ${paidBanner}\n      <table>\n        <thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead>\n        <tbody>${invoice.items.map(it => `<tr><td>${it.description}</td><td>${it.quantity} ${it.unit || ''}</td><td>${fmtMoney(it.amount)}</td></tr>`).join('')}</tbody>\n      </table>\n      <div class=\"totals\" style=\"margin-top:14px;\">\n        <div><span>Subtotal</span><span>${fmtMoney(invoice.subtotal)}</span></div>\n        <div><span>Tax</span><span>${fmtMoney(invoice.tax_amount)}</span></div>\n        <div class=\"grand\"><span>Total</span><span>${fmtMoney(invoice.total)}</span></div>\n        <div><span>Paid</span><span>${fmtMoney(invoice.amount_paid)}</span></div>\n        <div class=\"grand\"><span>Balance Due</span><span>${fmtMoney(balance)}</span></div>\n      </div>\n      ${balance > 0 ? `\n        <button type=\"button\" id=\"pay-btn\" style=\"width:100%; margin-top:20px;\">Pay ${fmtMoney(balance)} Online</button>\n        <div id=\"pay-msg\" style=\"margin-top:10px;\"></div>\n        <p style=\"font-size:12px; color:var(--ink-soft); margin-top:14px;\">You'll be redirected to a secure Stripe checkout page to pay by card.</p>\n      ` : ''}\n    `;\n\n    const payBtn = document.getElementById('pay-btn');\n    if (payBtn) {\n      payBtn.addEventListener('click', async () => {\n        const msg = document.getElementById('pay-msg');\n        payBtn.disabled = true;\n        msg.innerHTML = 'Redirecting to secure checkout…';\n        try {\n          const res = await fetch(`/api/pay/${token}/checkout`, { method: 'POST' });\n          const data = await res.json();\n          if (!res.ok) throw new Error(data.error);\n          window.location.href = data.url;\n        } catch (e) {\n          msg.innerHTML = `<div class=\"error-msg\">${e.message}</div>`;\n          payBtn.disabled = false;\n        }\n      });\n    }\n  }\n\n  await load();\n})();\n</script>\n</body>\n</html>\n"
  },
  "quote.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Quick Quote — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container narrow\">\n  <h1>Quick Quote</h1>\n  <p class=\"subtitle\">For when someone just wants a price. Pick a material and quantity, drop in the delivery address, and get an instant estimate — no order gets created until you say so.</p>\n\n  <div class=\"panel\">\n    <div class=\"field-row\">\n      <div class=\"field\">\n        <label>Material</label>\n        <select id=\"material_id\" required></select>\n      </div>\n      <div class=\"field\">\n        <label>Quantity</label>\n        <input type=\"number\" step=\"0.25\" min=\"0.25\" id=\"quantity\" value=\"1\" required>\n      </div>\n    </div>\n\n    <div class=\"field\">\n      <label>Price per unit ($)</label>\n      <input type=\"number\" step=\"0.01\" id=\"price_per_unit\">\n    </div>\n\n    <div class=\"field\">\n      <label>Delivery Address</label>\n      <input id=\"delivery_address\" placeholder=\"Street, city, state\">\n    </div>\n\n    <button type=\"button\" id=\"get-quote\" style=\"width:100%; margin-top:6px;\">Get Estimate</button>\n    <div id=\"quote-msg\" style=\"margin-top:10px;\"></div>\n  </div>\n\n  <div class=\"panel\" id=\"result-panel\" style=\"display:none;\">\n    <h2>Estimate</h2>\n    <div class=\"grid cols-2\" id=\"result-grid\"></div>\n    <div style=\"margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;\">\n      <button type=\"button\" id=\"start-order\">Turn Into an Order</button>\n      <button type=\"button\" class=\"btn secondary\" id=\"new-quote\">Start a New Quote</button>\n    </div>\n    <p class=\"subtitle\" style=\"margin-top:10px;\">This is an estimate only — nothing is saved until you turn it into an order.</p>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const [materials, settings] = await Promise.all([api('/api/materials'), api('/api/settings')]);\n  const taxRatePercent = settings.sales_tax_rate !== undefined && settings.sales_tax_rate !== ''\n    ? Number(settings.sales_tax_rate) : 7;\n  const materialSelect = document.getElementById('material_id');\n  materialSelect.innerHTML = materials.map(m => `<option value=\"${m.id}\" data-price=\"${m.default_price}\">${escapeHtml(m.name)} (${escapeHtml(m.unit)}, ${fmtMoney(m.default_price)})</option>`).join('');\n  materialSelect.addEventListener('change', () => {\n    document.getElementById('price_per_unit').value = materialSelect.selectedOptions[0].dataset.price;\n  });\n  if (materials.length) document.getElementById('price_per_unit').value = materials[0].default_price;\n\n  function escapeHtml(s) {\n    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');\n  }\n\n  let lastEstimate = null;\n\n  document.getElementById('get-quote').addEventListener('click', async () => {\n    const msg = document.getElementById('quote-msg');\n    const resultPanel = document.getElementById('result-panel');\n    msg.innerHTML = '';\n    resultPanel.style.display = 'none';\n\n    const material = materials.find(m => String(m.id) === materialSelect.value);\n    if (!material) { msg.innerHTML = '<div class=\"error-msg\">Add a material in Admin first.</div>'; return; }\n    const quantity = Number(document.getElementById('quantity').value);\n    const pricePerUnit = Number(document.getElementById('price_per_unit').value);\n    const address = document.getElementById('delivery_address').value.trim();\n    if (!quantity || quantity <= 0) { msg.innerHTML = '<div class=\"error-msg\">Enter a valid quantity.</div>'; return; }\n\n    const materialCost = quantity * pricePerUnit;\n    let deliveryFee = 0;\n    let distanceMiles = null;\n    let deliveryNote = 'No delivery address entered — material cost only.';\n    let needsManualQuote = false;\n\n    if (address) {\n      msg.innerHTML = '<span style=\"color:var(--ink-soft);\">Estimating delivery…</span>';\n      try {\n        const est = await api('/api/estimate-distance', { method: 'POST', body: { address } });\n        distanceMiles = est.miles;\n        if (est.fee !== null && est.fee !== undefined) {\n          deliveryFee = est.fee;\n          deliveryNote = `${est.miles} mi from the shop — ${est.band_label}`;\n        } else {\n          needsManualQuote = true;\n          deliveryNote = `${est.miles} mi from the shop — ${est.band_label}`;\n        }\n      } catch (err) {\n        msg.innerHTML = `<div class=\"error-msg\">Couldn't estimate delivery: ${err.message}. Showing material cost only.</div>`;\n        needsManualQuote = true;\n        deliveryNote = \"Couldn't estimate — enter delivery fee manually.\";\n      }\n    }\n\n    const salesTax = materialCost * (taxRatePercent / 100);\n    const total = materialCost + salesTax + deliveryFee;\n    lastEstimate = {\n      material_id: material.id,\n      material_name: material.name,\n      unit: material.unit,\n      quantity, pricePerUnit, materialCost,\n      address, distanceMiles, deliveryFee, needsManualQuote,\n    };\n\n    document.getElementById('result-grid').innerHTML = `\n      <div><label>Material</label><div>${quantity} ${escapeHtml(material.unit)} ${escapeHtml(material.name)} @ ${fmtMoney(pricePerUnit)}</div></div>\n      <div><label>Material Cost</label><div>${fmtMoney(materialCost)}</div></div>\n      <div><label>Sales Tax (${taxRatePercent}%, materials only)</label><div>${fmtMoney(salesTax)}</div></div>\n      <div><label>Delivery</label><div>${deliveryNote}</div></div>\n      <div><label>Delivery Fee</label><div>${needsManualQuote ? 'Needs manual quote' : fmtMoney(deliveryFee)}</div></div>\n      <div><label>Estimated Total</label><div style=\"font-size:20px; font-weight:700;\">${needsManualQuote ? fmtMoney(materialCost + salesTax) + ' + delivery TBD' : fmtMoney(total)}</div></div>\n    `;\n    resultPanel.style.display = 'block';\n    if (!msg.innerHTML.includes('error-msg')) msg.innerHTML = '';\n  });\n\n  document.getElementById('new-quote').addEventListener('click', () => {\n    document.getElementById('result-panel').style.display = 'none';\n    document.getElementById('delivery_address').value = '';\n    document.getElementById('quote-msg').innerHTML = '';\n  });\n\n  document.getElementById('start-order').addEventListener('click', () => {\n    if (!lastEstimate) return;\n    const params = new URLSearchParams({\n      material_id: lastEstimate.material_id,\n      quantity: lastEstimate.quantity,\n      price_per_unit: lastEstimate.pricePerUnit,\n      delivery_address: lastEstimate.address || '',\n      distance_miles: lastEstimate.distanceMiles ?? '',\n      delivery_fee: lastEstimate.needsManualQuote ? '' : lastEstimate.deliveryFee,\n    });\n    window.location.href = `/new-order.html?${params.toString()}`;\n  });\n})();\n</script>\n</body>\n</html>\n"
  },
  "schedule.html": {
    "encoding": "utf8",
    "content": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Schedule — OPD Development Corp</title>\n<link rel=\"icon\" href=\"/favicon.png\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n<style>\n  .board-wrap { overflow-x: auto; }\n  .board { display: grid; border: 1px solid var(--line, #2a2f36); border-radius: 8px; overflow: hidden; min-width: 900px; }\n  .board-row { display: grid; grid-template-columns: 140px repeat(7, 1fr); }\n  .board-row + .board-row { border-top: 1px solid var(--line, #2a2f36); }\n  .board-cell { padding: 6px; min-height: 90px; border-left: 1px solid var(--line, #2a2f36); vertical-align: top; }\n  .board-cell:first-child { border-left: none; }\n  .board-head { font-weight: 600; padding: 8px 6px; background: var(--panel-raised); }\n  .board-head .sub { font-weight: 400; font-size: 11px; color: var(--ink-soft); }\n  .driver-cell { padding: 8px 6px; font-weight: 600; background: var(--panel-raised); border-left: none; display: flex; flex-direction: column; justify-content: center; }\n  .slot-badge { font-size: 11px; font-weight: 400; color: var(--ink-soft); }\n  .slot-badge.full { color: var(--red, #e5484d); font-weight: 600; }\n  .drop-target { transition: background 0.1s; }\n  .drop-target.drag-over { background: var(--brand-soft, rgba(108,182,255,0.15)); }\n  .delivery-card { background: var(--panel, #1a1e24); border: 1px solid var(--line, #2a2f36); border-radius: 6px; padding: 6px 8px; margin-bottom: 6px; font-size: 12px; cursor: grab; line-height: 1.4; }\n  .delivery-card:active { cursor: grabbing; }\n  .delivery-card.status-out_for_delivery { border-left: 3px solid var(--amber, #f5a623); }\n  .delivery-card.status-delivered { opacity: 0.55; border-left: 3px solid var(--green, #2fbf71); }\n  .delivery-card .order-num { font-weight: 700; }\n  .delivery-card .addr { color: var(--ink-soft); }\n  .unscheduled-panel { display: flex; gap: 8px; flex-wrap: wrap; min-height: 60px; padding: 10px; border: 1px dashed var(--line, #2a2f36); border-radius: 8px; }\n  .unscheduled-panel .delivery-card { width: 220px; margin-bottom: 0; }\n  .week-nav { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }\n</style>\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\"><img src=\"/img/logo.png\" alt=\"OPD\"> OPD Development Corp</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/quote.html\">Quote</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/orders-database.html\">All Orders</a>\n    <a href=\"/jobs.html\">Jobs</a>\n    <a href=\"/customers.html\">Customers</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n    <a href=\"/financial.html\">Financials</a>\n    <a href=\"/admin.html\">Admin</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <h1>Dispatch Schedule</h1>\n  <p class=\"subtitle\">Deliveries auto-schedule as orders come in (20 yards max per truckload, 9 one-hour slots per driver per day). Drag a block onto a different day or driver to move it — drop it in \"Unscheduled\" to pull it off the board.</p>\n\n  <div class=\"panel\">\n    <h2>Unscheduled</h2>\n    <p class=\"subtitle\" style=\"margin-bottom:10px;\">Nothing should normally sit here — it means no active driver had room, or someone dragged it off the board on purpose.</p>\n    <div class=\"unscheduled-panel drop-target\" id=\"unscheduled-panel\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <div class=\"week-nav\">\n      <button type=\"button\" class=\"btn secondary small\" id=\"prev-week\">&larr; Prev</button>\n      <strong id=\"week-label\"></strong>\n      <button type=\"button\" class=\"btn secondary small\" id=\"next-week\">Next &rarr;</button>\n      <button type=\"button\" class=\"btn secondary small\" id=\"this-week\">This Week</button>\n    </div>\n    <div class=\"board-wrap\">\n      <div class=\"board\" id=\"board\"></div>\n    </div>\n    <div class=\"empty\" id=\"no-drivers-msg\" style=\"display:none;\">No active drivers yet — add one in Admin before the board can auto-schedule anything.</div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const SLOTS_PER_DAY = 9;\n  const drivers = (await api('/api/drivers')).filter(d => d.active);\n  document.getElementById('no-drivers-msg').style.display = drivers.length ? 'none' : 'block';\n\n  let weekOffset = 0;\n  let draggedId = null;\n\n  function mondayOf(date) {\n    const d = new Date(date);\n    const day = d.getDay(); // 0 = Sun\n    const diff = day === 0 ? -6 : 1 - day;\n    d.setDate(d.getDate() + diff);\n    d.setHours(0, 0, 0, 0);\n    return d;\n  }\n  function isoDate(d) { return d.toISOString().slice(0, 10); }\n  function weekDates() {\n    const base = mondayOf(new Date());\n    base.setDate(base.getDate() + weekOffset * 7);\n    return Array.from({ length: 7 }, (_, i) => {\n      const d = new Date(base);\n      d.setDate(d.getDate() + i);\n      return d;\n    });\n  }\n\n  function cardHtml(d) {\n    const label = d.total_deliveries > 1 ? `${d.order_number} (${d.sequence}/${d.total_deliveries})` : d.order_number;\n    const req = d.requested_window === 'ASAP' ? '<span style=\"color:var(--amber);\">ASAP</span> · ' : '';\n    return `\n      <div class=\"delivery-card status-${d.status}\" draggable=\"${d.status !== 'delivered'}\" data-id=\"${d.id}\" data-order-id=\"${d.order_id}\">\n        <div class=\"order-num\">${label}${d.slot_time ? ' · ' + d.slot_time : ''}</div>\n        <div>${d.customer_name} — ${d.quantity} ${d.unit} ${d.material_name}</div>\n        <div class=\"addr\">${req}${d.delivery_address}</div>\n      </div>\n    `;\n  }\n\n  function wireCard(el) {\n    el.addEventListener('click', (e) => {\n      if (el.dataset.dragging === '1') return;\n      window.location.href = `/order-detail.html?id=${el.dataset.orderId}`;\n    });\n    el.addEventListener('dragstart', (e) => {\n      draggedId = el.dataset.id;\n      el.dataset.dragging = '1';\n      e.dataTransfer.setData('text/plain', el.dataset.id);\n      e.dataTransfer.effectAllowed = 'move';\n    });\n    el.addEventListener('dragend', () => { el.dataset.dragging = '0'; draggedId = null; });\n  }\n\n  function wireDropTarget(el, handler) {\n    el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('drag-over'); });\n    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));\n    el.addEventListener('drop', async (e) => {\n      e.preventDefault();\n      el.classList.remove('drag-over');\n      const id = e.dataTransfer.getData('text/plain') || draggedId;\n      if (!id) return;\n      try {\n        await handler(id);\n      } catch (err) {\n        alert(err.message);\n      }\n      await load();\n    });\n  }\n\n  async function load() {\n    const dates = weekDates();\n    document.getElementById('week-label').textContent =\n      `${dates[0].toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${dates[6].toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;\n\n    const start = isoDate(dates[0]);\n    const end = isoDate(dates[6]);\n    const deliveries = await api(`/api/deliveries?start=${start}&end=${end}`);\n    const unscheduled = deliveries.filter(d => d.status === 'unscheduled' || !d.scheduled_date);\n\n    const panel = document.getElementById('unscheduled-panel');\n    panel.innerHTML = unscheduled.length ? unscheduled.map(cardHtml).join('') : '<span class=\"subtitle\">Nothing unscheduled.</span>';\n    panel.querySelectorAll('.delivery-card').forEach(wireCard);\n    wireDropTarget(panel, (id) => api(`/api/deliveries/${id}`, { method: 'PUT', body: { unschedule: true } }));\n\n    const board = document.getElementById('board');\n    board.innerHTML = '';\n    board.style.gridTemplateRows = `auto repeat(${drivers.length}, 1fr)`;\n\n    const headerRow = document.createElement('div');\n    headerRow.className = 'board-row';\n    headerRow.innerHTML = '<div class=\"board-head\">Driver</div>' + dates.map(d => `\n      <div class=\"board-head\">${d.toLocaleDateString(undefined, { weekday: 'short' })}<br><span class=\"sub\">${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></div>\n    `).join('');\n    board.appendChild(headerRow);\n\n    drivers.forEach(driver => {\n      const row = document.createElement('div');\n      row.className = 'board-row';\n      const driverCell = document.createElement('div');\n      driverCell.className = 'driver-cell';\n      driverCell.innerHTML = `${driver.name}${driver.truck_label ? `<div class=\"sub\" style=\"font-weight:400;\">${driver.truck_label}</div>` : ''}`;\n      row.appendChild(driverCell);\n\n      dates.forEach(date => {\n        const dateStr = isoDate(date);\n        const cellDeliveries = deliveries\n          .filter(d => d.driver_id === driver.id && d.scheduled_date === dateStr)\n          .sort((a, b) => (a.slot_index ?? 99) - (b.slot_index ?? 99));\n        const usedCount = cellDeliveries.filter(d => d.status !== 'cancelled').length;\n        const cell = document.createElement('div');\n        cell.className = 'board-cell drop-target';\n        cell.dataset.driverId = driver.id;\n        cell.dataset.date = dateStr;\n        cell.innerHTML = `<div class=\"slot-badge${usedCount >= SLOTS_PER_DAY ? ' full' : ''}\">${usedCount}/${SLOTS_PER_DAY}</div>` +\n          cellDeliveries.map(cardHtml).join('');\n        row.appendChild(cell);\n      });\n      board.appendChild(row);\n    });\n\n    board.querySelectorAll('.delivery-card').forEach(wireCard);\n    board.querySelectorAll('.board-cell.drop-target').forEach(cell => {\n      wireDropTarget(cell, (id) => api(`/api/deliveries/${id}`, {\n        method: 'PUT',\n        body: { driver_id: Number(cell.dataset.driverId), scheduled_date: cell.dataset.date },\n      }));\n    });\n  }\n\n  document.getElementById('prev-week').addEventListener('click', () => { weekOffset--; load(); });\n  document.getElementById('next-week').addEventListener('click', () => { weekOffset++; load(); });\n  document.getElementById('this-week').addEventListener('click', () => { weekOffset = 0; load(); });\n\n  await load();\n})();\n</script>\n</body>\n</html>\n"
  }
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon' };

function serveStatic(res, pathname) {
  const key = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const file = STATIC_FILES[key];
  if (file === undefined) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const ext = path.extname(key);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(file.encoding === 'base64' ? Buffer.from(file.content, 'base64') : file.content);
}

async function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsed.pathname);
  const query = Object.fromEntries(parsed.searchParams);

  if (pathname === '/api/stripe/webhook' && req.method === 'POST') {
    try {
      const rawBody = await readRawBody(req);
      const result = await handleStripeWebhook(rawBody, req.headers['stripe-signature']);
      return sendJson(res, result.status, result.body);
    } catch (e) { return sendJson(res, 500, { error: e.message }); }
  }

  if (pathname.startsWith('/pay/') && req.method === 'GET') return serveStatic(res, '/pay.html');

  if (pathname.startsWith('/api/')) {
    for (const route of routes) {
      if (route.method !== req.method) continue;
      const match = route.regex.exec(pathname);
      if (!match) continue;
      const params = {};
      route.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
      try { await route.handler(req, res, params, query); }
      catch (e) { console.error(e); if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error' }); }
      return;
    }
    return sendJson(res, 404, { error: 'Not found' });
  }

  return serveStatic(res, pathname);
});

server.listen(PORT, () => { console.log(`OPD Development Corp running on port ${PORT}`); });
