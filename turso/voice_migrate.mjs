// turso/voice_migrate.mjs
// Adds the columns/tables that functions/api/voice-webhook.js needs. Safe to run more than once.
//
// Usage (PowerShell):
//   $env:TURSO_URL="libsql://your-db.turso.io"; $env:TURSO_TOKEN="your-token"; node turso/voice_migrate.mjs
// Usage (Mac/Linux):
//   TURSO_URL=libsql://your-db.turso.io TURSO_TOKEN=your-token node turso/voice_migrate.mjs

import { createClient } from '@libsql/client';

const url = process.env.TURSO_URL || process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_TOKEN || process.env.TURSO_AUTH_TOKEN;
if (!url || !authToken) {
  console.error('Set TURSO_URL and TURSO_TOKEN first.');
  process.exit(1);
}
const db = createClient({ url, authToken });

async function cols(table) {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  return r.rows.map((x) => ({ name: x.name, type: String(x.type || '').toUpperCase() }));
}

async function ensureColumns(table, wanted) {
  const have = await cols(table);
  if (!have.length) {
    console.log(`!! table "${table}" does not exist. Create it first (see build_db.py / schema).`);
    return;
  }
  const names = new Set(have.map((c) => c.name));
  for (const [name, ddl] of Object.entries(wanted)) {
    if (names.has(name)) continue;
    await db.execute(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
    console.log(`+ ${table}.${name}`);
  }
}

// ---- properties: voice settings + info the agent may read out
await ensureColumns('properties', {
  voice_number: 'TEXT',
  voice_aliases: 'TEXT',
  address: 'TEXT',
  locality: 'TEXT',
  amenities: 'TEXT',
  food_details: 'TEXT',
  house_rules: 'TEXT',
  deposit_note: 'TEXT',
  visit_start: "TEXT DEFAULT '09:00'",
  visit_end: "TEXT DEFAULT '19:00'",
  visit_slot_minutes: 'INTEGER DEFAULT 30',
  reservation_hold_hours: 'INTEGER DEFAULT 48',
});

// ---- columns on existing tables that the webhook reads/writes
await ensureColumns('tenants', { whatsapp: 'TEXT', leaving_on: 'TEXT', due_day: 'INTEGER DEFAULT 5' });
await ensureColumns('complaints', { caller_phone: 'TEXT' });
await ensureColumns('payments', { for_month: 'TEXT', paid_on: 'TEXT', created_at: 'TEXT' });

// ---- new tables
await db.execute(`CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  visitor_name TEXT,
  visitor_phone TEXT,
  visit_at TEXT NOT NULL,
  duration_minutes INTEGER DEFAULT 30,
  status TEXT DEFAULT 'scheduled',
  source TEXT,
  notes TEXT,
  created_at TEXT
)`);
await db.execute(`CREATE TABLE IF NOT EXISTS bed_reservations (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL,
  bed_id TEXT,
  guest_name TEXT,
  guest_phone TEXT,
  move_in_date TEXT,
  status TEXT DEFAULT 'pending',
  source TEXT,
  notes TEXT,
  expires_at TEXT,
  created_at TEXT
)`);
await db.execute(`CREATE INDEX IF NOT EXISTS idx_visits_prop_at ON visits(property_id, visit_at)`);
await db.execute(`CREATE INDEX IF NOT EXISTS idx_resv_bed ON bed_reservations(bed_id, status)`);
console.log('tables visits, bed_reservations: ok');

// ---- sanity checks on what I could not see
const must = {
  rooms: ['id', 'property_id', 'room_no', 'floor', 'price'],
  beds: ['id', 'room_id', 'label', 'occupied'],
  tenants: ['id', 'property_id', 'bed_id', 'name', 'phone', 'status', 'rent_amount', 'move_in'],
  payments: ['tenant_id', 'amount'],
  complaints: ['id', 'property_id', 'tenant_name', 'message', 'category', 'priority', 'kind', 'status', 'created_at'],
};
for (const [t, list] of Object.entries(must)) {
  const have = new Set((await cols(t)).map((c) => c.name));
  const missing = list.filter((c) => !have.has(c));
  if (missing.length) console.log(`!! ${t} is missing: ${missing.join(', ')}  (tell me and I will adapt the webhook)`);
}
const cid = (await cols('complaints')).find((c) => c.name === 'id');
if (cid && cid.type.includes('INT')) {
  console.log('!! complaints.id is an INTEGER. The webhook sends text ids. Tell me and I will change it.');
}
const rv = (await db.execute('SELECT id, name, voice_number, voice_aliases FROM properties')).rows;
console.log('\nYour PGs (set voice_number / voice_aliases so callers can be matched):');
for (const p of rv) console.log(` - ${p.name} | voice_number=${p.voice_number} | aliases=${p.voice_aliases}`);
console.log('\nDone.');
