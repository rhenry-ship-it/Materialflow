// ===========================================================================
// MaterialFlow — single-file build (for easy GitHub web-upload + Railway deploy)
// Zero npm dependencies: uses only Node's built-ins (http, node:sqlite, crypto, fetch).
// This file is generated from the multi-file source project — see the README
// in the original delivered zip if you want to work from the split-out version.
// ===========================================================================

const http = require('http');
const crypto = require('crypto');
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

// ---------------------------------------------------------------------------
// Database (embedded schema + helpers)
// ---------------------------------------------------------------------------
const SCHEMA_SQL = "-- MaterialFlow schema\n\nCREATE TABLE IF NOT EXISTS customers (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  phone TEXT,\n  email TEXT,\n  billing_address TEXT,\n  notes TEXT,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS drivers (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  phone TEXT,\n  truck_label TEXT,\n  pin TEXT NOT NULL,\n  active INTEGER NOT NULL DEFAULT 1,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS materials (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  name TEXT NOT NULL,\n  unit TEXT NOT NULL DEFAULT 'yard',\n  default_price REAL NOT NULL DEFAULT 0,\n  active INTEGER NOT NULL DEFAULT 1\n);\n\nCREATE TABLE IF NOT EXISTS orders (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  order_number TEXT NOT NULL UNIQUE,\n  customer_id INTEGER NOT NULL REFERENCES customers(id),\n  material_id INTEGER NOT NULL REFERENCES materials(id),\n  quantity REAL NOT NULL,\n  unit TEXT NOT NULL,\n  price_per_unit REAL NOT NULL DEFAULT 0,\n  delivery_address TEXT NOT NULL,\n  requested_date TEXT,\n  requested_window TEXT,\n  notes TEXT,\n  status TEXT NOT NULL DEFAULT 'new', -- new, scheduled, out_for_delivery, delivered, invoiced, cancelled\n  driver_id INTEGER REFERENCES drivers(id),\n  scheduled_date TEXT,\n  scheduled_time TEXT,\n  delivered_at TEXT,\n  driver_notes TEXT,\n  invoice_id INTEGER,\n  created_at TEXT NOT NULL DEFAULT (datetime('now')),\n  updated_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS invoices (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  invoice_number TEXT NOT NULL UNIQUE,\n  customer_id INTEGER NOT NULL REFERENCES customers(id),\n  status TEXT NOT NULL DEFAULT 'draft', -- draft, sent, paid, partial, void\n  subtotal REAL NOT NULL DEFAULT 0,\n  tax_rate REAL NOT NULL DEFAULT 0,\n  tax_amount REAL NOT NULL DEFAULT 0,\n  total REAL NOT NULL DEFAULT 0,\n  amount_paid REAL NOT NULL DEFAULT 0,\n  issued_date TEXT,\n  due_date TEXT,\n  paid_date TEXT,\n  notes TEXT,\n  pay_token TEXT UNIQUE,\n  stripe_checkout_url TEXT,\n  stripe_session_id TEXT,\n  created_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE TABLE IF NOT EXISTS invoice_items (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  invoice_id INTEGER NOT NULL REFERENCES invoices(id),\n  order_id INTEGER REFERENCES orders(id),\n  description TEXT NOT NULL,\n  quantity REAL NOT NULL,\n  unit TEXT,\n  unit_price REAL NOT NULL,\n  amount REAL NOT NULL\n);\n\nCREATE TABLE IF NOT EXISTS payments (\n  id INTEGER PRIMARY KEY AUTOINCREMENT,\n  invoice_id INTEGER NOT NULL REFERENCES invoices(id),\n  amount REAL NOT NULL,\n  method TEXT NOT NULL, -- stripe, cash, check, ach, other\n  reference TEXT,\n  paid_at TEXT NOT NULL DEFAULT (datetime('now'))\n);\n\nCREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);\nCREATE INDEX IF NOT EXISTS idx_orders_driver_date ON orders(driver_id, scheduled_date);\nCREATE INDEX IF NOT EXISTS idx_invoices_customer ON invoices(customer_id);\n";

const DB_PATH = path.join(__dirname, 'materialflow.db');
const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA foreign_keys = ON;');
db.exec(SCHEMA_SQL);

function run(sql, params = []) { return db.prepare(sql).run(...params); }
function get(sql, params = []) { return db.prepare(sql).get(...params); }
function all(sql, params = []) { return db.prepare(sql).all(...params); }

// ---------------------------------------------------------------------------
// Seed sample data on first boot (only if the database is empty)
// ---------------------------------------------------------------------------
(function seed() {
  if (get('SELECT COUNT(*) as c FROM materials').c > 0) return;
  const materials = [
    ['Screened Loam', 'yard', 38], ['3/4" Crushed Gravel', 'yard', 34],
    ['Crusher Run (Processed Gravel)', 'yard', 30], ['Bank Run Sand', 'yard', 26],
    ['Mason Sand', 'yard', 32], ['Topsoil (Unscreened)', 'yard', 24],
    ['Dark Mulch', 'yard', 40], ['Riprap Stone', 'ton', 55],
  ];
  materials.forEach(([name, unit, price]) => run('INSERT INTO materials (name, unit, default_price) VALUES (?, ?, ?)', [name, unit, price]));

  const drivers = [
    ['Mike Sullivan', '555-0101', 'Truck 1 (Tri-Axle)', '1111'],
    ['Dave Ortiz', '555-0102', 'Truck 2 (Tandem)', '2222'],
    ['Randy Cole', '555-0103', 'Truck 3 (Tri-Axle)', '3333'],
  ];
  drivers.forEach(([name, phone, truck, pin]) => run('INSERT INTO drivers (name, phone, truck_label, pin) VALUES (?, ?, ?, ?)', [name, phone, truck, pin]));

  const customers = [
    ['Henry Landscaping LLC', '555-0201', 'billing@henrylandscaping.com', '12 Birch Rd, Holton, MI'],
    ['Tom Baker (Residential)', '555-0202', 'tbaker@example.com', '48 Elm St, Holton, MI'],
    ['Riverside Builders', '555-0203', 'ap@riversidebuilders.com', '900 Industrial Pkwy, Holton, MI'],
  ];
  customers.forEach(([name, phone, email, addr]) => run('INSERT INTO customers (name, phone, email, billing_address) VALUES (?, ?, ?, ?)', [name, phone, email, addr]));

  const custRows = all('SELECT * FROM customers');
  const matRows = all('SELECT * FROM materials');
  const drvRows = all('SELECT * FROM drivers');
  const today = new Date().toISOString().slice(0, 10);
  const sample = [
    { customer: 0, material: 0, qty: 12, address: '12 Birch Rd, Holton, MI', status: 'new' },
    { customer: 1, material: 3, qty: 4, address: '48 Elm St, Holton, MI', status: 'scheduled', driver: 0, date: today },
    { customer: 2, material: 1, qty: 22, address: '900 Industrial Pkwy, Holton, MI', status: 'scheduled', driver: 1, date: today },
    { customer: 0, material: 6, qty: 8, address: '12 Birch Rd, Holton, MI', status: 'delivered', driver: 2, date: today },
    { customer: 1, material: 5, qty: 6, address: '48 Elm St, Holton, MI', status: 'delivered', driver: 0, date: today },
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
// Small helpers
// ---------------------------------------------------------------------------
function todayStr() { return new Date().toISOString().slice(0, 10); }
function money(n) { return Math.round((Number(n) || 0) * 100) / 100; }

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; if (data.length > 5_000_000) { req.destroy(); reject(new Error('Body too large')); } });
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
function nextOrderNumber() {
  const d = new Date();
  const prefix = `ORD-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const count = get('SELECT COUNT(*) as c FROM orders WHERE order_number LIKE ?', [`${prefix}%`]).c;
  return `${prefix}-${String(count + 1).padStart(3, '0')}`;
}
function nextInvoiceNumber() {
  const prefix = `INV-${new Date().getFullYear()}`;
  const count = get('SELECT COUNT(*) as c FROM invoices WHERE invoice_number LIKE ?', [`${prefix}%`]).c;
  return `${prefix}-${String(count + 1).padStart(4, '0')}`;
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
  const todaysDeliveries = all(`${ORDER_SELECT} WHERE o.scheduled_date = ? ORDER BY o.scheduled_time IS NULL, o.scheduled_time`, [todayStr()]);
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

// ---- MATERIALS ----
on('GET', '/api/materials', async (req, res) => { if (!requireAuth(req, res)) return; sendJson(res, 200, all('SELECT * FROM materials WHERE active = 1 ORDER BY name')); });
on('POST', '/api/materials', async (req, res) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  if (!b.name) return sendJson(res, 400, { error: 'Name is required' });
  const result = run('INSERT INTO materials (name, unit, default_price) VALUES (?, ?, ?)', [b.name, b.unit || 'yard', money(b.default_price)]);
  sendJson(res, 201, get('SELECT * FROM materials WHERE id = ?', [result.lastInsertRowid]));
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
  const status = b.driver_id && b.scheduled_date ? 'scheduled' : 'new';
  const result = run(
    `INSERT INTO orders (order_number, customer_id, material_id, quantity, unit, price_per_unit, delivery_address, requested_date, requested_window, notes, status, driver_id, scheduled_date, scheduled_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [orderNumber, b.customer_id, b.material_id, b.quantity, material.unit, pricePerUnit, b.delivery_address, b.requested_date || null, b.requested_window || null, b.notes || null, status, b.driver_id || null, b.scheduled_date || null, b.scheduled_time || null]
  );
  sendJson(res, 201, get(`${ORDER_SELECT} WHERE o.id = ?`, [result.lastInsertRowid]));
});
on('PUT', '/api/orders/:id', async (req, res, params) => {
  if (!requireOffice(req, res)) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM orders WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Order not found' });
  const fields = ['customer_id', 'material_id', 'quantity', 'unit', 'price_per_unit', 'delivery_address', 'requested_date', 'requested_window', 'notes', 'status', 'driver_id', 'scheduled_date', 'scheduled_time'];
  const updates = {};
  for (const f of fields) if (b[f] !== undefined) updates[f] = b[f];
  if ((updates.driver_id || existing.driver_id) && (updates.scheduled_date || existing.scheduled_date) && existing.status === 'new' && !updates.status) updates.status = 'scheduled';
  const setClause = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
  if (setClause) run(`UPDATE orders SET ${setClause}, updated_at = datetime('now') WHERE id = ?`, [...Object.values(updates), params.id]);
  sendJson(res, 200, get(`${ORDER_SELECT} WHERE o.id = ?`, [params.id]));
});
on('POST', '/api/orders/:id/deliver', async (req, res, params) => {
  const session = requireAuth(req, res); if (!session) return;
  const b = await readJsonBody(req);
  const existing = get('SELECT * FROM orders WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Order not found' });
  if (session.role === 'driver' && existing.driver_id !== session.driverId) return sendJson(res, 403, { error: 'Not your delivery' });
  run(`UPDATE orders SET status = 'delivered', delivered_at = datetime('now'), driver_notes = ?, updated_at = datetime('now') WHERE id = ?`, [b.driver_notes || null, params.id]);
  sendJson(res, 200, get(`${ORDER_SELECT} WHERE o.id = ?`, [params.id]));
});
on('POST', '/api/orders/:id/start', async (req, res, params) => {
  const session = requireAuth(req, res); if (!session) return;
  const existing = get('SELECT * FROM orders WHERE id = ?', [params.id]);
  if (!existing) return sendJson(res, 404, { error: 'Order not found' });
  if (session.role === 'driver' && existing.driver_id !== session.driverId) return sendJson(res, 403, { error: 'Not your delivery' });
  run(`UPDATE orders SET status = 'out_for_delivery', updated_at = datetime('now') WHERE id = ?`, [params.id]);
  sendJson(res, 200, get(`${ORDER_SELECT} WHERE o.id = ?`, [params.id]));
});

// ---- DRIVER JOBS ----
on('GET', '/api/driver/jobs', async (req, res, params, query) => {
  const session = requireAuth(req, res); if (!session) return;
  const driverId = session.role === 'driver' ? session.driverId : query.driver_id;
  if (!driverId) return sendJson(res, 400, { error: 'driver_id required' });
  const date = query.date || todayStr();
  sendJson(res, 200, all(`${ORDER_SELECT} WHERE o.driver_id = ? AND o.scheduled_date = ? AND o.status IN ('scheduled','out_for_delivery','delivered') ORDER BY o.scheduled_time IS NULL, o.scheduled_time`, [driverId, date]));
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
  const subtotal = money(orders.reduce((sum, o) => sum + o.quantity * o.price_per_unit, 0));
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
    run(`UPDATE orders SET status = 'invoiced', invoice_id = ?, updated_at = datetime('now') WHERE id = ?`, [invoiceId, o.id]);
  }
  sendJson(res, 201, get('SELECT * FROM invoices WHERE id = ?', [invoiceId]));
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
  "css/style.css": ":root {\n  --bg: #f5f6f5;\n  --panel: #ffffff;\n  --ink: #1f2a24;\n  --ink-soft: #5b6660;\n  --line: #e1e5e2;\n  --brand: #3f6b4e;\n  --brand-dark: #2c4d38;\n  --amber: #b3781c;\n  --red: #b3401c;\n  --blue: #2c5b8a;\n  --radius: 10px;\n  font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n}\n\n* { box-sizing: border-box; }\n\nbody {\n  margin: 0;\n  background: var(--bg);\n  color: var(--ink);\n  font-family: inherit;\n  font-size: 15px;\n  line-height: 1.45;\n}\n\na { color: var(--brand); }\n\n.topbar {\n  display: flex;\n  align-items: center;\n  justify-content: space-between;\n  background: var(--panel);\n  border-bottom: 1px solid var(--line);\n  padding: 12px 20px;\n  position: sticky;\n  top: 0;\n  z-index: 10;\n}\n\n.topbar .brand {\n  font-weight: 700;\n  font-size: 17px;\n  color: var(--brand-dark);\n  text-decoration: none;\n  display: flex;\n  align-items: center;\n  gap: 8px;\n}\n\n.topbar nav { display: flex; gap: 4px; flex-wrap: wrap; }\n\n.topbar nav a {\n  text-decoration: none;\n  color: var(--ink-soft);\n  padding: 8px 12px;\n  border-radius: 8px;\n  font-size: 14px;\n  font-weight: 500;\n}\n\n.topbar nav a.active, .topbar nav a:hover { background: #eef2ee; color: var(--brand-dark); }\n\n.topbar .who { font-size: 13px; color: var(--ink-soft); display: flex; align-items: center; gap: 10px; }\n\n.container {\n  max-width: 1100px;\n  margin: 0 auto;\n  padding: 24px 20px 60px;\n}\n\n.container.narrow { max-width: 640px; }\n\nh1 { font-size: 22px; margin: 0 0 4px; }\nh2 { font-size: 17px; margin: 0 0 12px; }\n.subtitle { color: var(--ink-soft); margin: 0 0 24px; font-size: 14px; }\n\n.panel {\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  padding: 18px 20px;\n  margin-bottom: 18px;\n}\n\n.grid { display: grid; gap: 16px; }\n.grid.cols-2 { grid-template-columns: 1fr 1fr; }\n.grid.cols-3 { grid-template-columns: repeat(3, 1fr); }\n.grid.cols-4 { grid-template-columns: repeat(4, 1fr); }\n@media (max-width: 760px) {\n  .grid.cols-2, .grid.cols-3, .grid.cols-4 { grid-template-columns: 1fr; }\n}\n\n.stat {\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  padding: 16px 18px;\n}\n.stat .label { font-size: 12px; color: var(--ink-soft); text-transform: uppercase; letter-spacing: .04em; }\n.stat .value { font-size: 26px; font-weight: 700; margin-top: 4px; }\n\ntable { width: 100%; border-collapse: collapse; font-size: 14px; }\nth, td { text-align: left; padding: 10px 8px; border-bottom: 1px solid var(--line); vertical-align: top; }\nth { color: var(--ink-soft); font-weight: 600; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }\ntr:last-child td { border-bottom: none; }\n.table-wrap { overflow-x: auto; }\n\nlabel { display: block; font-size: 13px; font-weight: 600; margin-bottom: 5px; color: var(--ink-soft); }\ninput, select, textarea {\n  width: 100%;\n  padding: 9px 11px;\n  border: 1px solid #cfd6d1;\n  border-radius: 8px;\n  font-size: 14px;\n  font-family: inherit;\n  background: #fff;\n  color: var(--ink);\n}\ninput:focus, select:focus, textarea:focus { outline: 2px solid var(--brand); outline-offset: 1px; }\n.field { margin-bottom: 14px; }\n.field-row { display: flex; gap: 12px; }\n.field-row > .field { flex: 1; }\n\nbutton, .btn {\n  display: inline-flex;\n  align-items: center;\n  gap: 6px;\n  background: var(--brand);\n  color: #fff;\n  border: none;\n  padding: 10px 16px;\n  border-radius: 8px;\n  font-size: 14px;\n  font-weight: 600;\n  cursor: pointer;\n  text-decoration: none;\n}\nbutton:hover, .btn:hover { background: var(--brand-dark); }\nbutton.secondary, .btn.secondary { background: #fff; color: var(--ink); border: 1px solid #cfd6d1; }\nbutton.secondary:hover, .btn.secondary:hover { background: #f1f3f1; }\nbutton.small, .btn.small { padding: 6px 10px; font-size: 13px; }\nbutton:disabled { opacity: .5; cursor: not-allowed; }\n\n.badge {\n  display: inline-block;\n  padding: 3px 9px;\n  border-radius: 999px;\n  font-size: 11px;\n  font-weight: 700;\n  text-transform: uppercase;\n  letter-spacing: .03em;\n}\n.badge.new { background: #e7ecf5; color: var(--blue); }\n.badge.scheduled { background: #fbeed7; color: var(--amber); }\n.badge.out_for_delivery { background: #fbeed7; color: var(--amber); }\n.badge.delivered { background: #e4f0e6; color: var(--brand-dark); }\n.badge.invoiced { background: #ece4f5; color: #6b3fa0; }\n.badge.cancelled { background: #f5e4e4; color: var(--red); }\n.badge.draft { background: #eef1ee; color: var(--ink-soft); }\n.badge.sent { background: #fbeed7; color: var(--amber); }\n.badge.paid { background: #e4f0e6; color: var(--brand-dark); }\n.badge.partial { background: #e7ecf5; color: var(--blue); }\n.badge.void { background: #f5e4e4; color: var(--red); }\n\n.error-msg { color: var(--red); font-size: 13px; margin: 8px 0; }\n.ok-msg { color: var(--brand-dark); font-size: 13px; margin: 8px 0; }\n.empty { color: var(--ink-soft); font-size: 14px; padding: 24px 0; text-align: center; }\n\n.login-card {\n  max-width: 380px;\n  margin: 10vh auto;\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-radius: 14px;\n  padding: 32px 28px;\n}\n.login-tabs { display: flex; gap: 8px; margin-bottom: 20px; }\n.login-tabs button { flex: 1; background: #eef2ee; color: var(--ink-soft); }\n.login-tabs button.active { background: var(--brand); color: #fff; }\n\n.job-card {\n  background: var(--panel);\n  border: 1px solid var(--line);\n  border-radius: var(--radius);\n  padding: 16px;\n  margin-bottom: 12px;\n}\n.job-card .job-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }\n.job-card .material { font-weight: 700; font-size: 16px; }\n.job-card .addr { color: var(--ink-soft); margin: 4px 0 10px; }\n.job-card .meta { font-size: 13px; color: var(--ink-soft); margin-bottom: 10px; }\n.job-card textarea { margin-bottom: 10px; }\n\n.checkbox-row { display: flex; align-items: center; gap: 8px; }\n.checkbox-row input { width: auto; }\n\n.print-invoice { background: #fff; padding: 40px; max-width: 720px; margin: 0 auto; }\n.print-invoice h1 { font-size: 24px; }\n.print-invoice .invoice-meta { display: flex; justify-content: space-between; margin: 20px 0; font-size: 14px; }\n.print-invoice table { margin-top: 10px; }\n.print-invoice .totals { margin-top: 16px; width: 260px; margin-left: auto; font-size: 14px; }\n.print-invoice .totals div { display: flex; justify-content: space-between; padding: 4px 0; }\n.print-invoice .totals .grand { font-weight: 700; font-size: 16px; border-top: 1px solid var(--line); margin-top: 6px; padding-top: 8px; }\n@media print {\n  .topbar, .no-print { display: none !important; }\n  .container { padding: 0; }\n}\n\n.link-btn { background: none; border: none; color: var(--brand); cursor: pointer; padding: 0; font-size: 13px; font-weight: 600; }\n",
  "dashboard.html": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Dashboard — MaterialFlow</title>\n<link rel=\"icon\" href=\"/favicon.svg\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\">🚛 MaterialFlow</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <h1>Dashboard</h1>\n  <p class=\"subtitle\" id=\"today-label\"></p>\n\n  <div class=\"grid cols-4\" id=\"stats\"></div>\n\n  <div class=\"panel\" style=\"margin-top:20px;\">\n    <h2>Today's Deliveries</h2>\n    <div class=\"table-wrap\">\n      <table id=\"today-table\">\n        <thead><tr><th>Order #</th><th>Customer</th><th>Material</th><th>Qty</th><th>Driver</th><th>Time</th><th>Status</th></tr></thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"today-empty\" style=\"display:none;\">Nothing scheduled for today yet.</div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  document.getElementById('today-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });\n\n  const data = await api('/api/dashboard/summary');\n  const c = data.counts, inv = data.invoiceCounts;\n  document.getElementById('stats').innerHTML = `\n    <div class=\"stat\"><div class=\"label\">New Orders</div><div class=\"value\">${c.new_orders || 0}</div></div>\n    <div class=\"stat\"><div class=\"label\">Scheduled</div><div class=\"value\">${c.scheduled_orders || 0}</div></div>\n    <div class=\"stat\"><div class=\"label\">Delivered · Ready to Invoice</div><div class=\"value\">${c.delivered_orders || 0}</div></div>\n    <div class=\"stat\"><div class=\"label\">Outstanding Invoices</div><div class=\"value\">${fmtMoney(inv.outstanding)}</div></div>\n  `;\n\n  const tbody = document.querySelector('#today-table tbody');\n  if (!data.todaysDeliveries.length) {\n    document.getElementById('today-empty').style.display = 'block';\n  } else {\n    tbody.innerHTML = data.todaysDeliveries.map(o => `\n      <tr>\n        <td>${o.order_number}</td>\n        <td>${o.customer_name}</td>\n        <td>${o.material_name}</td>\n        <td>${o.quantity} ${o.unit}</td>\n        <td>${o.driver_name || '—'}</td>\n        <td>${o.scheduled_time || '—'}</td>\n        <td>${badge(o.status)}</td>\n      </tr>\n    `).join('');\n  }\n})();\n</script>\n</body>\n</html>\n",
  "driver.html": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>My Deliveries — MaterialFlow</title>\n<link rel=\"icon\" href=\"/favicon.svg\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/driver.html\">🚛 MaterialFlow</a>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container narrow\">\n  <h1>My Deliveries</h1>\n  <p class=\"subtitle\" id=\"date-label\"></p>\n\n  <div id=\"jobs\"></div>\n  <div class=\"empty\" id=\"empty-msg\" style=\"display:none;\">No deliveries assigned for today.</div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['driver']);\n  if (!me) return;\n\n  document.getElementById('date-label').textContent = new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });\n\n  async function load() {\n    const jobs = await api('/api/driver/jobs');\n    const container = document.getElementById('jobs');\n    document.getElementById('empty-msg').style.display = jobs.length ? 'none' : 'block';\n    container.innerHTML = jobs.map(job => `\n      <div class=\"job-card\" data-id=\"${job.id}\">\n        <div class=\"job-top\">\n          <div>\n            <div class=\"material\">${job.material_name}</div>\n            <div class=\"addr\">${job.delivery_address}</div>\n          </div>\n          ${badge(job.status)}\n        </div>\n        <div class=\"meta\">\n          ${job.customer_name} · ${job.customer_phone || 'no phone on file'}<br>\n          Qty: ${job.quantity} ${job.unit} ${job.scheduled_time ? '· ' + job.scheduled_time : ''}\n          ${job.notes ? '<br>Note: ' + job.notes : ''}\n        </div>\n        ${job.status === 'delivered' ? `<div class=\"ok-msg\">Delivered${job.driver_notes ? ' — ' + job.driver_notes : ''}</div>` : `\n          <textarea class=\"notes-input\" rows=\"2\" placeholder=\"Delivery notes (optional) — e.g. left at gate, signed by...\"></textarea>\n          <div style=\"display:flex; gap:8px;\">\n            ${job.status === 'scheduled' ? `<button type=\"button\" class=\"btn secondary start-btn\" style=\"flex:1;\">Start Delivery</button>` : ''}\n            <button type=\"button\" class=\"btn deliver-btn\" style=\"flex:1;\">Mark Delivered</button>\n          </div>\n        `}\n      </div>\n    `).join('');\n\n    container.querySelectorAll('.start-btn').forEach(btn => {\n      btn.addEventListener('click', async () => {\n        const id = btn.closest('.job-card').dataset.id;\n        await api(`/api/orders/${id}/start`, { method: 'POST' });\n        load();\n      });\n    });\n    container.querySelectorAll('.deliver-btn').forEach(btn => {\n      btn.addEventListener('click', async () => {\n        const card = btn.closest('.job-card');\n        const id = card.dataset.id;\n        const notes = card.querySelector('.notes-input').value;\n        btn.disabled = true;\n        await api(`/api/orders/${id}/deliver`, { method: 'POST', body: { driver_notes: notes || null } });\n        load();\n      });\n    });\n  }\n\n  await load();\n})();\n</script>\n</body>\n</html>\n",
  "favicon.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 100 100\"><text y=\"75\" font-size=\"80\">🚛</text></svg>",
  "index.html": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>MaterialFlow — Log In</title>\n<link rel=\"icon\" href=\"/favicon.svg\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"login-card\">\n  <h1 style=\"text-align:center;\">🚛 MaterialFlow</h1>\n  <p class=\"subtitle\" style=\"text-align:center;\">Orders · Scheduling · Invoicing</p>\n\n  <div class=\"login-tabs\">\n    <button id=\"tab-office\" class=\"active\">Dispatch / Office</button>\n    <button id=\"tab-driver\">Driver</button>\n  </div>\n\n  <form id=\"office-form\">\n    <div class=\"field\">\n      <label>Office Password</label>\n      <input type=\"password\" id=\"office-password\" required autofocus>\n    </div>\n    <button type=\"submit\" style=\"width:100%;\">Log In</button>\n  </form>\n\n  <form id=\"driver-form\" style=\"display:none;\">\n    <div class=\"field\">\n      <label>Driver</label>\n      <select id=\"driver-select\" required></select>\n    </div>\n    <div class=\"field\">\n      <label>PIN</label>\n      <input type=\"password\" inputmode=\"numeric\" id=\"driver-pin\" required>\n    </div>\n    <button type=\"submit\" style=\"width:100%;\">Log In</button>\n  </form>\n\n  <div id=\"msg\"></div>\n</div>\n\n<script>\nconst tabOffice = document.getElementById('tab-office');\nconst tabDriver = document.getElementById('tab-driver');\nconst officeForm = document.getElementById('office-form');\nconst driverForm = document.getElementById('driver-form');\nconst msg = document.getElementById('msg');\n\ntabOffice.addEventListener('click', () => {\n  tabOffice.classList.add('active'); tabDriver.classList.remove('active');\n  officeForm.style.display = 'block'; driverForm.style.display = 'none';\n});\ntabDriver.addEventListener('click', async () => {\n  tabDriver.classList.add('active'); tabOffice.classList.remove('active');\n  driverForm.style.display = 'block'; officeForm.style.display = 'none';\n  await loadDrivers();\n});\n\nasync function loadDrivers() {\n  const sel = document.getElementById('driver-select');\n  if (sel.options.length) return;\n  try {\n    const res = await fetch('/api/drivers-public');\n    const drivers = await res.json();\n    sel.innerHTML = drivers.map(d => `<option value=\"${d.id}\">${d.name}</option>`).join('');\n  } catch (e) {\n    sel.innerHTML = '<option value=\"\">Could not load drivers</option>';\n  }\n}\n\nofficeForm.addEventListener('submit', async (e) => {\n  e.preventDefault();\n  msg.innerHTML = '';\n  const password = document.getElementById('office-password').value;\n  const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ role: 'office', password }) });\n  const data = await res.json();\n  if (res.ok) window.location.href = '/dashboard.html';\n  else msg.innerHTML = `<div class=\"error-msg\">${data.error}</div>`;\n});\n\ndriverForm.addEventListener('submit', async (e) => {\n  e.preventDefault();\n  msg.innerHTML = '';\n  const driverId = document.getElementById('driver-select').value;\n  const pin = document.getElementById('driver-pin').value;\n  const res = await fetch('/api/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ role: 'driver', driverId, pin }) });\n  const data = await res.json();\n  if (res.ok) window.location.href = '/driver.html';\n  else msg.innerHTML = `<div class=\"error-msg\">${data.error}</div>`;\n});\n</script>\n</body>\n</html>\n",
  "invoice-detail.html": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Invoice — MaterialFlow</title>\n<link rel=\"icon\" href=\"/favicon.svg\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar no-print\">\n  <a class=\"brand\" href=\"/dashboard.html\">🚛 MaterialFlow</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <div class=\"panel no-print\" id=\"actions-panel\">\n    <h2>Actions</h2>\n    <div style=\"display:flex; gap:10px; flex-wrap:wrap; margin-bottom:14px;\">\n      <button type=\"button\" id=\"send-btn\" class=\"secondary\">Mark as Sent</button>\n      <button type=\"button\" id=\"copy-link-btn\" class=\"secondary\">Copy Customer Pay Link</button>\n      <button type=\"button\" id=\"print-btn\" class=\"secondary\">Print / Save PDF</button>\n    </div>\n    <div class=\"grid cols-2\">\n      <div>\n        <h2>Record a Manual Payment</h2>\n        <div class=\"field-row\">\n          <div class=\"field\"><label>Amount ($)</label><input type=\"number\" step=\"0.01\" id=\"pay-amount\"></div>\n          <div class=\"field\"><label>Method</label>\n            <select id=\"pay-method\"><option value=\"cash\">Cash</option><option value=\"check\">Check</option><option value=\"ach\">ACH / Bank Transfer</option><option value=\"other\">Other</option></select>\n          </div>\n        </div>\n        <div class=\"field\"><label>Reference (check #, etc.)</label><input id=\"pay-reference\"></div>\n        <button type=\"button\" id=\"mark-paid-btn\">Record Payment</button>\n      </div>\n      <div>\n        <h2>Online Card Payment (Stripe)</h2>\n        <p class=\"subtitle\" style=\"margin-bottom:10px;\">Generates a secure Stripe Checkout link the customer can pay online. Requires <code>STRIPE_SECRET_KEY</code> to be set in <code>.env</code>.</p>\n        <button type=\"button\" id=\"stripe-link-btn\" class=\"secondary\">Generate Stripe Payment Link</button>\n        <div id=\"stripe-msg\" style=\"margin-top:8px;\"></div>\n      </div>\n    </div>\n    <div id=\"action-msg\"></div>\n  </div>\n\n  <div class=\"print-invoice panel\" id=\"invoice-body\">Loading…</div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const id = new URLSearchParams(window.location.search).get('id');\n  let invoice;\n\n  async function load() {\n    invoice = await api(`/api/invoices/${id}`);\n    render();\n  }\n\n  function render() {\n    document.getElementById('invoice-body').innerHTML = `\n      <div style=\"display:flex; justify-content:space-between; align-items:flex-start;\">\n        <div>\n          <h1>Invoice ${invoice.invoice_number}</h1>\n          <div>${badge(invoice.status)}</div>\n        </div>\n        <div style=\"text-align:right; font-size:14px;\">\n          <div><strong>MaterialFlow Aggregates</strong></div>\n          <div>Issued: ${fmtDate(invoice.issued_date)}</div>\n          <div>Due: ${invoice.due_date ? fmtDate(invoice.due_date) : 'Upon receipt'}</div>\n        </div>\n      </div>\n      <div class=\"invoice-meta\">\n        <div>\n          <strong>Bill To</strong><br>\n          ${invoice.customer_name}<br>\n          ${invoice.customer_address || ''}<br>\n          ${invoice.customer_phone || ''}\n        </div>\n      </div>\n      <table>\n        <thead><tr><th>Description</th><th>Qty</th><th>Unit Price</th><th>Amount</th></tr></thead>\n        <tbody>\n          ${invoice.items.map(it => `<tr><td>${it.description}</td><td>${it.quantity} ${it.unit || ''}</td><td>${fmtMoney(it.unit_price)}</td><td>${fmtMoney(it.amount)}</td></tr>`).join('')}\n        </tbody>\n      </table>\n      <div class=\"totals\">\n        <div><span>Subtotal</span><span>${fmtMoney(invoice.subtotal)}</span></div>\n        <div><span>Tax (${invoice.tax_rate}%)</span><span>${fmtMoney(invoice.tax_amount)}</span></div>\n        <div class=\"grand\"><span>Total</span><span>${fmtMoney(invoice.total)}</span></div>\n        <div><span>Paid</span><span>${fmtMoney(invoice.amount_paid)}</span></div>\n        <div class=\"grand\"><span>Balance Due</span><span>${fmtMoney(invoice.total - invoice.amount_paid)}</span></div>\n      </div>\n      ${invoice.payments.length ? `\n        <h2 style=\"margin-top:24px;\">Payment History</h2>\n        <table>\n          <thead><tr><th>Date</th><th>Amount</th><th>Method</th><th>Reference</th></tr></thead>\n          <tbody>${invoice.payments.map(p => `<tr><td>${fmtDate(p.paid_at)}</td><td>${fmtMoney(p.amount)}</td><td>${fmtStatus(p.method)}</td><td>${p.reference || '—'}</td></tr>`).join('')}</tbody>\n        </table>\n      ` : ''}\n      <p style=\"margin-top:24px; font-size:13px; color:var(--ink-soft);\">Thank you for your business.</p>\n    `;\n    document.getElementById('pay-amount').value = (invoice.total - invoice.amount_paid).toFixed(2);\n  }\n\n  document.getElementById('send-btn').addEventListener('click', async () => {\n    await api(`/api/invoices/${id}/send`, { method: 'POST' });\n    await load();\n  });\n\n  document.getElementById('copy-link-btn').addEventListener('click', async () => {\n    const url = `${window.location.origin}/pay/${invoice.pay_token}`;\n    try {\n      await navigator.clipboard.writeText(url);\n      document.getElementById('action-msg').innerHTML = `<div class=\"ok-msg\">Copied: ${url}</div>`;\n    } catch (e) {\n      document.getElementById('action-msg').innerHTML = `<div>Pay link: <a href=\"${url}\" target=\"_blank\">${url}</a></div>`;\n    }\n  });\n\n  document.getElementById('print-btn').addEventListener('click', () => window.print());\n\n  document.getElementById('mark-paid-btn').addEventListener('click', async () => {\n    const msg = document.getElementById('action-msg');\n    msg.innerHTML = '';\n    try {\n      await api(`/api/invoices/${id}/mark-paid`, { method: 'POST', body: {\n        amount: Number(document.getElementById('pay-amount').value),\n        method: document.getElementById('pay-method').value,\n        reference: document.getElementById('pay-reference').value || null,\n      }});\n      msg.innerHTML = '<div class=\"ok-msg\">Payment recorded.</div>';\n      await load();\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  document.getElementById('stripe-link-btn').addEventListener('click', async () => {\n    const el = document.getElementById('stripe-msg');\n    el.innerHTML = 'Generating…';\n    try {\n      const res = await api(`/api/invoices/${id}/checkout`, { method: 'POST' });\n      el.innerHTML = `<a href=\"${res.url}\" target=\"_blank\">${res.url}</a>`;\n    } catch (err) {\n      el.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  await load();\n})();\n</script>\n</body>\n</html>\n",
  "invoices.html": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Invoicing — MaterialFlow</title>\n<link rel=\"icon\" href=\"/favicon.svg\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\">🚛 MaterialFlow</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <h1>Invoicing &amp; Payment</h1>\n  <p class=\"subtitle\">Turn delivered orders into an invoice, send it, and collect payment online or record cash/check/ACH.</p>\n\n  <div class=\"panel\">\n    <h2>Create an Invoice from Delivered Orders</h2>\n    <div class=\"field\" style=\"max-width:320px;\">\n      <label>Customer</label>\n      <select id=\"customer-filter\"><option value=\"\">— Select a customer —</option></select>\n    </div>\n    <div class=\"table-wrap\">\n      <table id=\"ready-table\">\n        <thead><tr><th></th><th>Order #</th><th>Delivered</th><th>Material</th><th>Qty</th><th>Amount</th></tr></thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"ready-empty\" style=\"display:none;\">No delivered, un-invoiced orders for this customer yet.</div>\n    <div class=\"field-row\" style=\"margin-top:14px; align-items:flex-end;\" id=\"invoice-controls\" style=\"display:none;\">\n      <div class=\"field\" style=\"max-width:160px;\"><label>Tax Rate (%)</label><input type=\"number\" id=\"tax-rate\" value=\"0\" step=\"0.01\"></div>\n      <div class=\"field\" style=\"max-width:200px;\"><label>Due Date</label><input type=\"date\" id=\"due-date\"></div>\n      <div class=\"field\" style=\"flex:2;\"><strong id=\"selected-total\"></strong></div>\n      <button type=\"button\" id=\"create-invoice-btn\">Create Invoice</button>\n    </div>\n    <div id=\"create-msg\"></div>\n  </div>\n\n  <div class=\"panel\">\n    <h2>All Invoices</h2>\n    <div class=\"table-wrap\">\n      <table id=\"invoices-table\">\n        <thead><tr><th>Invoice #</th><th>Customer</th><th>Issued</th><th>Total</th><th>Paid</th><th>Status</th><th></th></tr></thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"invoices-empty\" style=\"display:none;\">No invoices yet.</div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const customers = await api('/api/customers');\n  document.getElementById('customer-filter').innerHTML += customers.map(c => `<option value=\"${c.id}\">${c.name}</option>`).join('');\n\n  async function loadReady() {\n    const custId = document.getElementById('customer-filter').value;\n    const controls = document.getElementById('invoice-controls');\n    const tbody = document.querySelector('#ready-table tbody');\n    if (!custId) { tbody.innerHTML = ''; document.getElementById('ready-empty').style.display = 'none'; controls.style.display = 'none'; return; }\n    const orders = await api(`/api/orders-ready-to-invoice?customer_id=${custId}`);\n    document.getElementById('ready-empty').style.display = orders.length ? 'none' : 'block';\n    controls.style.display = orders.length ? 'flex' : 'none';\n    tbody.innerHTML = orders.map(o => `\n      <tr>\n        <td><input type=\"checkbox\" class=\"ready-check\" value=\"${o.id}\" data-amount=\"${o.quantity * o.price_per_unit}\" checked></td>\n        <td>${o.order_number}</td>\n        <td>${o.delivered_at ? fmtDate(o.delivered_at) : '—'}</td>\n        <td>${o.material_name}</td>\n        <td>${o.quantity} ${o.unit}</td>\n        <td>${fmtMoney(o.quantity * o.price_per_unit)}</td>\n      </tr>\n    `).join('');\n    tbody.querySelectorAll('.ready-check').forEach(cb => cb.addEventListener('change', updateSelectedTotal));\n    updateSelectedTotal();\n  }\n\n  function updateSelectedTotal() {\n    const checked = [...document.querySelectorAll('.ready-check:checked')];\n    const subtotal = checked.reduce((s, cb) => s + Number(cb.dataset.amount), 0);\n    const taxRate = Number(document.getElementById('tax-rate').value) || 0;\n    const total = subtotal * (1 + taxRate / 100);\n    document.getElementById('selected-total').textContent = `${checked.length} order(s) selected — Subtotal ${fmtMoney(subtotal)}, Total w/ tax ${fmtMoney(total)}`;\n  }\n\n  document.getElementById('customer-filter').addEventListener('change', loadReady);\n  document.getElementById('tax-rate').addEventListener('input', updateSelectedTotal);\n\n  document.getElementById('create-invoice-btn').addEventListener('click', async () => {\n    const msg = document.getElementById('create-msg');\n    msg.innerHTML = '';\n    const orderIds = [...document.querySelectorAll('.ready-check:checked')].map(cb => Number(cb.value));\n    if (!orderIds.length) { msg.innerHTML = '<div class=\"error-msg\">Select at least one order.</div>'; return; }\n    try {\n      const invoice = await api('/api/invoices', { method: 'POST', body: {\n        order_ids: orderIds,\n        tax_rate: Number(document.getElementById('tax-rate').value) || 0,\n        due_date: document.getElementById('due-date').value || null,\n      }});\n      window.location.href = `/invoice-detail.html?id=${invoice.id}`;\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n\n  async function loadInvoices() {\n    const invoices = await api('/api/invoices');\n    const tbody = document.querySelector('#invoices-table tbody');\n    document.getElementById('invoices-empty').style.display = invoices.length ? 'none' : 'block';\n    tbody.innerHTML = invoices.map(i => `\n      <tr>\n        <td><a href=\"/invoice-detail.html?id=${i.id}\">${i.invoice_number}</a></td>\n        <td>${i.customer_name}</td>\n        <td>${i.issued_date ? fmtDate(i.issued_date) : '—'}</td>\n        <td>${fmtMoney(i.total)}</td>\n        <td>${fmtMoney(i.amount_paid)}</td>\n        <td>${badge(i.status)}</td>\n        <td><a class=\"btn secondary small\" href=\"/invoice-detail.html?id=${i.id}\">Open</a></td>\n      </tr>\n    `).join('');\n  }\n\n  await loadReady();\n  await loadInvoices();\n})();\n</script>\n</body>\n</html>\n",
  "js/app.js": "async function api(path, opts = {}) {\n  const res = await fetch(path, {\n    method: opts.method || 'GET',\n    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,\n    body: opts.body ? JSON.stringify(opts.body) : undefined,\n  });\n  let data = null;\n  try { data = await res.json(); } catch (e) { /* no body */ }\n  if (!res.ok) {\n    const err = new Error((data && data.error) || `Request failed (${res.status})`);\n    err.status = res.status;\n    throw err;\n  }\n  return data;\n}\n\nfunction fmtMoney(n) {\n  return '$' + (Number(n) || 0).toFixed(2);\n}\n\nfunction fmtDate(d) {\n  if (!d) return '—';\n  const dt = new Date(d.length <= 10 ? `${d}T00:00:00` : d);\n  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });\n}\n\nfunction fmtStatus(s) {\n  return (s || '').replace(/_/g, ' ').replace(/\\b\\w/g, (c) => c.toUpperCase());\n}\n\nfunction badge(status) {\n  return `<span class=\"badge ${status}\">${fmtStatus(status)}</span>`;\n}\n\nasync function requireSession(allowedRoles) {\n  try {\n    const me = await api('/api/me');\n    if (!me.loggedIn) { window.location.href = '/'; return null; }\n    if (allowedRoles && !allowedRoles.includes(me.role)) {\n      window.location.href = me.role === 'driver' ? '/driver.html' : '/dashboard.html';\n      return null;\n    }\n    renderTopbar(me);\n    return me;\n  } catch (e) {\n    window.location.href = '/';\n    return null;\n  }\n}\n\nfunction renderTopbar(me) {\n  const el = document.getElementById('topbar-who');\n  if (!el) return;\n  el.innerHTML = `<span>${me.name}</span> <button class=\"btn secondary small\" id=\"logout-btn\">Log out</button>`;\n  document.getElementById('logout-btn').addEventListener('click', async () => {\n    await api('/api/logout', { method: 'POST' });\n    window.location.href = '/';\n  });\n  const path = window.location.pathname;\n  document.querySelectorAll('.topbar nav a').forEach((a) => {\n    if (a.getAttribute('href') === path) a.classList.add('active');\n  });\n}\n",
  "new-order.html": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>New Order — MaterialFlow</title>\n<link rel=\"icon\" href=\"/favicon.svg\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\">🚛 MaterialFlow</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container narrow\">\n  <h1>New Material Order</h1>\n  <p class=\"subtitle\">Take down the order now — you can assign a driver and delivery date right away, or leave it unscheduled for dispatch to sort out later.</p>\n\n  <div class=\"panel\">\n    <form id=\"order-form\">\n      <div class=\"field\">\n        <label>Customer</label>\n        <select id=\"customer_id\"></select>\n      </div>\n      <button type=\"button\" class=\"btn secondary small\" id=\"new-customer-toggle\" style=\"margin:-8px 0 14px;\">+ Add a new customer</button>\n      <div id=\"new-customer-fields\" style=\"display:none;\">\n        <div class=\"field-row\">\n          <div class=\"field\"><label>New Customer Name</label><input id=\"nc_name\"></div>\n          <div class=\"field\"><label>Phone</label><input id=\"nc_phone\"></div>\n        </div>\n        <div class=\"field\"><label>Billing Address</label><input id=\"nc_address\"></div>\n      </div>\n\n      <div class=\"field-row\">\n        <div class=\"field\">\n          <label>Material</label>\n          <select id=\"material_id\" required></select>\n        </div>\n        <div class=\"field\">\n          <label>Quantity</label>\n          <input type=\"number\" step=\"0.25\" min=\"0.25\" id=\"quantity\" required>\n        </div>\n      </div>\n\n      <div class=\"field\">\n        <label>Price per unit ($)</label>\n        <input type=\"number\" step=\"0.01\" id=\"price_per_unit\">\n      </div>\n\n      <div class=\"field\">\n        <label>Delivery Address</label>\n        <input id=\"delivery_address\" required>\n      </div>\n\n      <div class=\"field-row\">\n        <div class=\"field\">\n          <label>Requested Date</label>\n          <input type=\"date\" id=\"requested_date\">\n        </div>\n        <div class=\"field\">\n          <label>Requested Window</label>\n          <input id=\"requested_window\" placeholder=\"e.g. AM, 8–10am\">\n        </div>\n      </div>\n\n      <div class=\"field\">\n        <label>Notes</label>\n        <textarea id=\"notes\" rows=\"2\" placeholder=\"Gate code, site contact, access notes...\"></textarea>\n      </div>\n\n      <h2 style=\"margin-top:20px;\">Schedule now (optional)</h2>\n      <div class=\"field-row\">\n        <div class=\"field\">\n          <label>Assign Driver</label>\n          <select id=\"driver_id\"><option value=\"\">— Leave unassigned —</option></select>\n        </div>\n        <div class=\"field\">\n          <label>Delivery Date</label>\n          <input type=\"date\" id=\"scheduled_date\">\n        </div>\n        <div class=\"field\">\n          <label>Time</label>\n          <input id=\"scheduled_time\" placeholder=\"e.g. 9:00 AM\">\n        </div>\n      </div>\n\n      <div id=\"msg\"></div>\n      <button type=\"submit\" style=\"width:100%;\">Create Order</button>\n    </form>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const [customers, materials, drivers] = await Promise.all([\n    api('/api/customers'), api('/api/materials'), api('/api/drivers'),\n  ]);\n\n  document.getElementById('customer_id').innerHTML =\n    '<option value=\"\">— Select customer —</option>' +\n    customers.map(c => `<option value=\"${c.id}\">${c.name}</option>`).join('');\n\n  const materialSelect = document.getElementById('material_id');\n  materialSelect.innerHTML = materials.map(m => `<option value=\"${m.id}\" data-price=\"${m.default_price}\" data-unit=\"${m.unit}\">${m.name} (${m.unit}, ${fmtMoney(m.default_price)})</option>`).join('');\n  materialSelect.addEventListener('change', () => {\n    const opt = materialSelect.selectedOptions[0];\n    document.getElementById('price_per_unit').value = opt.dataset.price;\n  });\n  if (materials.length) document.getElementById('price_per_unit').value = materials[0].default_price;\n\n  document.getElementById('driver_id').innerHTML += drivers.map(d => `<option value=\"${d.id}\">${d.name}${d.truck_label ? ' — ' + d.truck_label : ''}</option>`).join('');\n\n  document.getElementById('new-customer-toggle').addEventListener('click', () => {\n    const el = document.getElementById('new-customer-fields');\n    el.style.display = el.style.display === 'none' ? 'block' : 'none';\n  });\n\n  document.getElementById('order-form').addEventListener('submit', async (e) => {\n    e.preventDefault();\n    const msg = document.getElementById('msg');\n    msg.innerHTML = '';\n    try {\n      let customerId = document.getElementById('customer_id').value;\n      const ncName = document.getElementById('nc_name').value.trim();\n      if (ncName) {\n        const newCustomer = await api('/api/customers', { method: 'POST', body: {\n          name: ncName,\n          phone: document.getElementById('nc_phone').value,\n          billing_address: document.getElementById('nc_address').value,\n        }});\n        customerId = newCustomer.id;\n      }\n      if (!customerId) { msg.innerHTML = '<div class=\"error-msg\">Select or add a customer.</div>'; return; }\n\n      const order = await api('/api/orders', { method: 'POST', body: {\n        customer_id: Number(customerId),\n        material_id: Number(document.getElementById('material_id').value),\n        quantity: Number(document.getElementById('quantity').value),\n        price_per_unit: Number(document.getElementById('price_per_unit').value),\n        delivery_address: document.getElementById('delivery_address').value,\n        requested_date: document.getElementById('requested_date').value || null,\n        requested_window: document.getElementById('requested_window').value || null,\n        notes: document.getElementById('notes').value || null,\n        driver_id: document.getElementById('driver_id').value || null,\n        scheduled_date: document.getElementById('scheduled_date').value || null,\n        scheduled_time: document.getElementById('scheduled_time').value || null,\n      }});\n      msg.innerHTML = `<div class=\"ok-msg\">Order ${order.order_number} created.</div>`;\n      setTimeout(() => { window.location.href = '/schedule.html'; }, 700);\n    } catch (err) {\n      msg.innerHTML = `<div class=\"error-msg\">${err.message}</div>`;\n    }\n  });\n})();\n</script>\n</body>\n</html>\n",
  "pay.html": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Pay Your Invoice — MaterialFlow</title>\n<link rel=\"icon\" href=\"/favicon.svg\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <span class=\"brand\">🚛 MaterialFlow</span>\n</div>\n\n<div class=\"container narrow\">\n  <div class=\"panel\" id=\"content\">Loading invoice…</div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const token = window.location.pathname.split('/pay/')[1];\n  const params = new URLSearchParams(window.location.search);\n  const el = document.getElementById('content');\n\n  async function load() {\n    let invoice;\n    try {\n      invoice = await api(`/api/pay/${token}`);\n    } catch (e) {\n      el.innerHTML = '<h1>Invoice Not Found</h1><p>This payment link is invalid or has expired. Please contact us for a new link.</p>';\n      return;\n    }\n\n    const balance = invoice.total - invoice.amount_paid;\n    const paidBanner = invoice.status === 'paid'\n      ? '<div class=\"ok-msg\" style=\"font-size:16px; margin-bottom:16px;\">✅ This invoice is paid in full. Thank you!</div>'\n      : (params.get('paid') === '1' ? '<div class=\"ok-msg\" style=\"font-size:16px; margin-bottom:16px;\">Payment received — thank you! (This page may take a moment to update the balance.)</div>' : '');\n\n    el.innerHTML = `\n      <h1>Invoice ${invoice.invoice_number}</h1>\n      <p class=\"subtitle\">${invoice.customer_name}</p>\n      ${paidBanner}\n      <table>\n        <thead><tr><th>Description</th><th>Qty</th><th>Amount</th></tr></thead>\n        <tbody>${invoice.items.map(it => `<tr><td>${it.description}</td><td>${it.quantity} ${it.unit || ''}</td><td>${fmtMoney(it.amount)}</td></tr>`).join('')}</tbody>\n      </table>\n      <div class=\"totals\" style=\"margin-top:14px;\">\n        <div><span>Subtotal</span><span>${fmtMoney(invoice.subtotal)}</span></div>\n        <div><span>Tax</span><span>${fmtMoney(invoice.tax_amount)}</span></div>\n        <div class=\"grand\"><span>Total</span><span>${fmtMoney(invoice.total)}</span></div>\n        <div><span>Paid</span><span>${fmtMoney(invoice.amount_paid)}</span></div>\n        <div class=\"grand\"><span>Balance Due</span><span>${fmtMoney(balance)}</span></div>\n      </div>\n      ${balance > 0 ? `\n        <button type=\"button\" id=\"pay-btn\" style=\"width:100%; margin-top:20px;\">Pay ${fmtMoney(balance)} Online</button>\n        <div id=\"pay-msg\" style=\"margin-top:10px;\"></div>\n        <p style=\"font-size:12px; color:var(--ink-soft); margin-top:14px;\">You'll be redirected to a secure Stripe checkout page to pay by card.</p>\n      ` : ''}\n    `;\n\n    const payBtn = document.getElementById('pay-btn');\n    if (payBtn) {\n      payBtn.addEventListener('click', async () => {\n        const msg = document.getElementById('pay-msg');\n        payBtn.disabled = true;\n        msg.innerHTML = 'Redirecting to secure checkout…';\n        try {\n          const res = await fetch(`/api/pay/${token}/checkout`, { method: 'POST' });\n          const data = await res.json();\n          if (!res.ok) throw new Error(data.error);\n          window.location.href = data.url;\n        } catch (e) {\n          msg.innerHTML = `<div class=\"error-msg\">${e.message}</div>`;\n          payBtn.disabled = false;\n        }\n      });\n    }\n  }\n\n  await load();\n})();\n</script>\n</body>\n</html>\n",
  "schedule.html": "<!DOCTYPE html>\n<html lang=\"en\">\n<head>\n<meta charset=\"UTF-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n<title>Schedule — MaterialFlow</title>\n<link rel=\"icon\" href=\"/favicon.svg\">\n<link rel=\"stylesheet\" href=\"/css/style.css\">\n</head>\n<body>\n<div class=\"topbar\">\n  <a class=\"brand\" href=\"/dashboard.html\">🚛 MaterialFlow</a>\n  <nav>\n    <a href=\"/dashboard.html\">Dashboard</a>\n    <a href=\"/new-order.html\">New Order</a>\n    <a href=\"/schedule.html\">Schedule</a>\n    <a href=\"/invoices.html\">Invoicing</a>\n  </nav>\n  <div class=\"who\" id=\"topbar-who\"></div>\n</div>\n\n<div class=\"container\">\n  <h1>Dispatch Schedule</h1>\n  <p class=\"subtitle\">Assign unscheduled orders to a driver and date, then track deliveries as they go out.</p>\n\n  <div class=\"panel\">\n    <h2>Unscheduled Orders</h2>\n    <div class=\"table-wrap\">\n      <table id=\"unscheduled-table\">\n        <thead><tr><th>Order #</th><th>Customer</th><th>Material</th><th>Qty</th><th>Address</th><th>Requested</th><th>Assign Driver</th><th>Date</th><th>Time</th><th></th></tr></thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"unscheduled-empty\" style=\"display:none;\">No unscheduled orders. Nice and caught up.</div>\n  </div>\n\n  <div class=\"panel\">\n    <div class=\"field-row\" style=\"align-items:flex-end;\">\n      <div class=\"field\" style=\"max-width:220px;\">\n        <label>Viewing schedule for</label>\n        <input type=\"date\" id=\"schedule-date\">\n      </div>\n      <div class=\"field\" style=\"max-width:220px;\">\n        <label>Driver</label>\n        <select id=\"driver-filter\"><option value=\"\">All drivers</option></select>\n      </div>\n    </div>\n    <h2 id=\"schedule-heading\">Scheduled Deliveries</h2>\n    <div class=\"table-wrap\">\n      <table id=\"scheduled-table\">\n        <thead><tr><th>Time</th><th>Order #</th><th>Customer</th><th>Material</th><th>Qty</th><th>Driver</th><th>Status</th><th></th></tr></thead>\n        <tbody></tbody>\n      </table>\n    </div>\n    <div class=\"empty\" id=\"scheduled-empty\" style=\"display:none;\">Nothing scheduled for this day yet.</div>\n  </div>\n</div>\n\n<script src=\"/js/app.js\"></script>\n<script>\n(async function () {\n  const me = await requireSession(['office']);\n  if (!me) return;\n\n  const drivers = await api('/api/drivers');\n  document.getElementById('driver-filter').innerHTML += drivers.map(d => `<option value=\"${d.id}\">${d.name}</option>`).join('');\n\n  const dateInput = document.getElementById('schedule-date');\n  dateInput.value = new Date().toISOString().slice(0, 10);\n\n  async function loadUnscheduled() {\n    const orders = await api('/api/orders?status=new');\n    const tbody = document.querySelector('#unscheduled-table tbody');\n    document.getElementById('unscheduled-empty').style.display = orders.length ? 'none' : 'block';\n    tbody.innerHTML = orders.map(o => `\n      <tr data-id=\"${o.id}\">\n        <td>${o.order_number}</td>\n        <td>${o.customer_name}</td>\n        <td>${o.material_name}</td>\n        <td>${o.quantity} ${o.unit}</td>\n        <td>${o.delivery_address}</td>\n        <td>${o.requested_date ? fmtDate(o.requested_date) : '—'}${o.requested_window ? ' ('+o.requested_window+')' : ''}</td>\n        <td><select class=\"assign-driver\"><option value=\"\">Choose…</option>${drivers.map(d => `<option value=\"${d.id}\">${d.name}</option>`).join('')}</select></td>\n        <td><input type=\"date\" class=\"assign-date\" value=\"${o.requested_date || new Date().toISOString().slice(0,10)}\"></td>\n        <td><input class=\"assign-time\" placeholder=\"9:00 AM\" style=\"width:90px;\"></td>\n        <td><button type=\"button\" class=\"btn small assign-btn\">Assign</button></td>\n      </tr>\n    `).join('');\n\n    tbody.querySelectorAll('.assign-btn').forEach(btn => {\n      btn.addEventListener('click', async () => {\n        const tr = btn.closest('tr');\n        const id = tr.dataset.id;\n        const driverId = tr.querySelector('.assign-driver').value;\n        const date = tr.querySelector('.assign-date').value;\n        const time = tr.querySelector('.assign-time').value;\n        if (!driverId || !date) { alert('Pick a driver and date first.'); return; }\n        await api(`/api/orders/${id}`, { method: 'PUT', body: { driver_id: Number(driverId), scheduled_date: date, scheduled_time: time || null, status: 'scheduled' } });\n        await loadUnscheduled();\n        await loadScheduled();\n      });\n    });\n  }\n\n  async function loadScheduled() {\n    const date = dateInput.value;\n    const driverId = document.getElementById('driver-filter').value;\n    let path = `/api/orders?date=${date}`;\n    if (driverId) path += `&driver_id=${driverId}`;\n    const orders = (await api(path)).filter(o => o.status !== 'new');\n    document.getElementById('schedule-heading').textContent = `Scheduled Deliveries — ${fmtDate(date)}`;\n    const tbody = document.querySelector('#scheduled-table tbody');\n    document.getElementById('scheduled-empty').style.display = orders.length ? 'none' : 'block';\n    tbody.innerHTML = orders.map(o => `\n      <tr>\n        <td>${o.scheduled_time || '—'}</td>\n        <td>${o.order_number}</td>\n        <td>${o.customer_name}</td>\n        <td>${o.material_name}</td>\n        <td>${o.quantity} ${o.unit}</td>\n        <td>${o.driver_name || '—'}</td>\n        <td>${badge(o.status)}</td>\n        <td>${o.status === 'delivered' ? '' : `<button type=\"button\" class=\"btn secondary small cancel-btn\" data-id=\"${o.id}\">Cancel</button>`}</td>\n      </tr>\n    `).join('');\n    tbody.querySelectorAll('.cancel-btn').forEach(btn => {\n      btn.addEventListener('click', async () => {\n        if (!confirm('Cancel this order?')) return;\n        await api(`/api/orders/${btn.dataset.id}`, { method: 'PUT', body: { status: 'cancelled' } });\n        await loadScheduled();\n      });\n    });\n  }\n\n  dateInput.addEventListener('change', loadScheduled);\n  document.getElementById('driver-filter').addEventListener('change', loadScheduled);\n\n  await loadUnscheduled();\n  await loadScheduled();\n})();\n</script>\n</body>\n</html>\n"
};

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

function serveStatic(res, pathname) {
  const key = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const content = STATIC_FILES[key];
  if (content === undefined) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found'); }
  const ext = path.extname(key);
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
  res.end(content);
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

server.listen(PORT, () => { console.log(`MaterialFlow running on port ${PORT}`); });
