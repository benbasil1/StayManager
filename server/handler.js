// StayManager API: runs on Cloudflare Pages Functions and talks to Turso.
// Every request is authenticated with the user's login token (see auth.js, stored in Turso), and EVERY query is scoped
// to the properties that user owns (or, for attenders, is staff at). This replaces Supabase RLS.
//
// handle({ request, db, env, getUser }) -> Response   (db = a @libsql/client client)

import { HttpError } from './errors.js'
import { authRoute, getUser as verifyLogin, createLogin, findLogin, loginExists, setLoginPassword, deleteLogin } from './auth.js'

const CORS = {
  'access-control-allow-origin': '*', // safe: auth uses a Bearer token, never cookies
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-max-age': '86400',
}

export { HttpError }
const FORBIDDEN = () => new HttpError(403, 'Not allowed')

const json = (data, status = 200) =>
  new Response(JSON.stringify(data ?? null), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...CORS },
  })

// ───────────── column whitelists (the client can never set anything else) ─────────────
const TENANT_COLS = ['bed_id', 'name', 'phone', 'whatsapp', 'email', 'rent_amount', 'deposit', 'move_in', 'move_out', 'due_day', 'notes', 'id_type', 'id_last4', 'id_doc_paths', 'status', 'leaving_on', 'wa_invited_at']
const INSERT_COLS = {
  properties: ['id', 'name'],
  rooms: ['id', 'property_id', 'room_no', 'floor', 'price'],
  beds: ['id', 'room_id', 'label', 'occupied', 'vacant_since'],
  tenants: ['id', 'property_id', ...TENANT_COLS],
  payments: ['id', 'property_id', 'tenant_id', 'amount', 'paid_on', 'for_month', 'method', 'note', 'proof_path'],
  property_staff: ['id', 'property_id', 'email', 'name'],
  feedback: ['id', 'kind', 'message'],
}
const PATCH_COLS = {
  rooms: ['room_no', 'floor', 'price'],
  beds: ['label', 'occupied', 'vacant_since'],
  tenants: TENANT_COLS,
  payments: ['amount', 'paid_on', 'for_month', 'method', 'note', 'proof_path'],
  complaints: ['status', 'notified_status'],
}
const CALL_COLS = ['property_id', 'caller_name', 'summary', 'intent', 'sentiment', 'duration_seconds', 'caller_phone', 'call_id', 'transcript', 'needs_follow_up', 'flags']
const COMPLAINT_COLS = ['property_id', 'tenant_name', 'message', 'category', 'priority', 'kind', 'status', 'caller_phone', 'notified_status']

const uuid = () => crypto.randomUUID()

// "Today" in India (the app is built for Indian PGs), so dates do not roll over at 5:30 am.
const todayIST = () => new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
const MAX_PROPERTIES_PER_OWNER = 25

// ───────────── input checks: clear messages instead of raw database errors ─────────────
const bad = (m) => new HttpError(400, m)
function text(row, k, max, label, { nonEmpty = false, must = false } = {}) {
  if (row[k] === undefined) { if (must) throw bad(`${label} is required.`); return }
  if (row[k] === null) { if (nonEmpty || must) throw bad(`${label} is required.`); return }
  const v = String(row[k]).trim()
  if (nonEmpty && !v) throw bad(`${label} is required.`)
  if (v.length > max) throw bad(`${label} is too long (max ${max} characters).`)
  row[k] = v
}
function whole(row, k, min, max, label, must = false) {
  if (row[k] === undefined) { if (must) throw bad(`${label} is required.`); return }
  if (row[k] === null || row[k] === '') throw bad(`${label} is required.`)
  const n = Number(row[k])
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${label} must be a whole number from ${min} to ${max}.`)
  row[k] = n
}
function day(row, k, label, { nullable = true, must = false } = {}) {
  if (row[k] === undefined) { if (must) throw bad(`${label} is required.`); return }
  if (row[k] === null || row[k] === '') {
    if (!nullable) throw bad(`${label} is required.`)
    row[k] = null
    return
  }
  const v = String(row[k]).trim()
  const d = new Date(v + 'T00:00:00Z')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) throw bad(`${label} is not a valid date.`)
  row[k] = v
}
function oneOf(row, k, list, label) {
  if (row[k] !== undefined && !list.includes(row[k])) throw bad(`${label} is not valid.`)
}
function checkTenant(t, insert) {
  text(t, 'name', 120, 'Name', { nonEmpty: true, must: insert })
  text(t, 'phone', 20, 'Phone')
  text(t, 'whatsapp', 20, 'WhatsApp number')
  text(t, 'email', 200, 'Email')
  text(t, 'notes', 2000, 'Notes')
  text(t, 'id_type', 40, 'ID type')
  text(t, 'id_last4', 8, 'ID last digits')
  text(t, 'wa_invited_at', 40, 'Invite time')
  whole(t, 'rent_amount', 0, 10000000, 'Rent')
  whole(t, 'deposit', 0, 100000000, 'Deposit')
  whole(t, 'due_day', 1, 28, 'Due day')
  day(t, 'move_in', 'Move-in date', { nullable: false })
  day(t, 'move_out', 'Move-out date')
  day(t, 'leaving_on', 'Leaving date')
  oneOf(t, 'status', ['active', 'left'], 'Status')
  if (t.id_doc_paths !== undefined) {
    let list
    try { list = JSON.parse(t.id_doc_paths) } catch { list = null }
    if (!Array.isArray(list) || list.length > 20 || list.some((p) => typeof p !== 'string' || p.length > 200)) throw bad('ID documents list is not valid.')
  }
}
function checkRoom(r, insert) {
  text(r, 'room_no', 20, 'Room number', { nonEmpty: true, must: insert })
  whole(r, 'floor', -5, 100, 'Floor')
  whole(r, 'price', 0, 10000000, 'Price')
}
function checkBed(b, insert) {
  text(b, 'label', 40, 'Bed name', { nonEmpty: true, must: insert })
  oneOf(b, 'occupied', [0, 1], 'Occupied')
  day(b, 'vacant_since', 'Vacant since')
}
function checkPayment(p, insert) {
  whole(p, 'amount', 1, 100000000, 'Amount', insert)
  day(p, 'paid_on', 'Payment date', { nullable: false, must: insert })
  if (p.for_month !== undefined || insert) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(String(p.for_month || ''))) throw bad('Month is not valid.')
  }
  text(p, 'method', 30, 'Payment method')
  text(p, 'note', 500, 'Note')
  text(p, 'proof_path', 200, 'Screenshot')
}

// ───────────── file storage limits (ID photos, payment screenshots) ─────────────
// The app shrinks photos to ~300-500 KB before uploading, so these are generous ceilings.
const MAX_IMAGE_BYTES = 1024 * 1024 // 1 MB
const MAX_PDF_BYTES = 1536 * 1024 // 1.5 MB
const FILE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' }
const DEFAULT_QUOTA_MB = 200 // per owner; change with the FILE_QUOTA_MB variable

// ───────────── small database helpers ─────────────
function toObjects(result) {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((c, i) => [c, row[i]])))
}
async function all(db, sql, args = []) {
  return toObjects(await db.execute({ sql, args }))
}
async function one(db, sql, args = []) {
  return (await all(db, sql, args))[0] || null
}

// JS value -> SQLite value
function toDb(v) {
  if (v === undefined) return undefined
  if (v === null) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v)
  return v
}
function pick(body, cols) {
  const out = {}
  for (const c of cols) if (body && body[c] !== undefined) out[c] = toDb(body[c])
  return out
}
function insertStmt(table, values) {
  const cols = Object.keys(values)
  return {
    sql: `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
    args: cols.map((c) => values[c]),
  }
}
function updateStmt(table, id, values) {
  const cols = Object.keys(values)
  if (!cols.length) throw new HttpError(400, 'Nothing to update')
  return { sql: `UPDATE ${table} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, args: [...cols.map((c) => values[c]), id] }
}

// row from the database -> what the app expects
const fixBeds = (b) => ({ ...b, occupied: !!b.occupied })
const fixCalls = (c) => ({ ...c, needs_follow_up: !!c.needs_follow_up })
const fixTenant = (t) => {
  let docs = []
  try { docs = JSON.parse(t.id_doc_paths || '[]') } catch { docs = [] }
  return { ...t, id_doc_paths: Array.isArray(docs) ? docs : [] }
}

// ───────────── access control ─────────────
async function ownsProperty(db, user, propertyId) {
  if (!propertyId) return false
  return !!(await one(db, 'SELECT 1 AS ok FROM properties WHERE id = ? AND owner_id = ?', [propertyId, user.id]))
}
async function requireOwner(db, user, propertyId) {
  if (!(await ownsProperty(db, user, propertyId))) throw FORBIDDEN()
}
async function isStaffOf(db, user, propertyId) {
  if (!propertyId || !user.email) return false
  return !!(await one(db, 'SELECT 1 AS ok FROM property_staff WHERE property_id = ? AND lower(email) = ?', [propertyId, user.email]))
}
async function propertyOfRoom(db, roomId) {
  return (await one(db, 'SELECT property_id FROM rooms WHERE id = ?', [roomId]))?.property_id || null
}
async function propertyOfBed(db, bedId) {
  return (await one(db, 'SELECT r.property_id FROM beds b JOIN rooms r ON r.id = b.room_id WHERE b.id = ?', [bedId]))?.property_id || null
}
async function propertyOfTenant(db, tenantId) {
  return (await one(db, 'SELECT property_id FROM tenants WHERE id = ?', [tenantId]))?.property_id || null
}
// The property a row belongs to (used before update / delete)
async function propertyOfRow(db, table, id) {
  if (table === 'beds') return propertyOfBed(db, id)
  return (await one(db, `SELECT property_id FROM ${table} WHERE id = ?`, [id]))?.property_id || null
}
async function requireOwnerOfRow(db, user, table, id) {
  await requireOwner(db, user, await propertyOfRow(db, table, id))
}

// A tenant may only be put in a bed of the SAME property (stops cross-owner links)
async function checkBedInProperty(db, bedId, propertyId) {
  if (bedId == null) return
  if ((await propertyOfBed(db, bedId)) !== propertyId) throw FORBIDDEN()
}

// A bed must never have two active tenants (two phones tapping at once, or an old screen). The index below enforces it
// in the database; the code checks first so the owner gets a clear message. If old data already breaks the rule the
// index is skipped (it never blocks the app from starting).
async function bedIsFree(db, bedId, exceptTenantId = '') {
  return !(await one(db, "SELECT 1 AS ok FROM tenants WHERE bed_id = ? AND status = 'active' AND id <> ?", [bedId, exceptTenantId]))
}
const BED_TAKEN = () => new HttpError(409, 'This bed already has a tenant. Refresh and pick another bed.')

// ───────────── indexes (created once per server start; safe to run again) ─────────────
let indexesReady = false
async function ensureIndexes(db) {
  if (indexesReady) return
  try {
    await db.batch(
      [
        'CREATE INDEX IF NOT EXISTS idx_complaints_pulse ON complaints(property_id, status, created_at)',
        'CREATE INDEX IF NOT EXISTS idx_calls_prop_created ON calls(property_id, created_at)',
        'CREATE INDEX IF NOT EXISTS idx_payments_prop_paid ON payments(property_id, paid_on)',
        'CREATE INDEX IF NOT EXISTS idx_tenants_prop_status ON tenants(property_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_tenants_phone ON tenants(phone)',
      ].map((sql) => ({ sql, args: [] })),
      'write'
    )
  } catch (e) { console.error('index setup skipped:', String(e?.message || e)) }
  try {
    await db.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_tenant_per_bed ON tenants(bed_id) WHERE status = 'active' AND bed_id IS NOT NULL")
  } catch (e) { console.error('one-tenant-per-bed index skipped (duplicates exist):', String(e?.message || e)) }
  indexesReady = true
}

// ───────────── WhatsApp group link + "invited" mark (columns are added automatically on first use) ─────────────
let waReady = false
async function ensureWaColumns(db) {
  if (waReady) return
  for (const sql of ['ALTER TABLE properties ADD COLUMN wa_group_link TEXT', 'ALTER TABLE tenants ADD COLUMN wa_invited_at TEXT']) {
    try { await db.execute(sql) } catch (e) {
      if (!/duplicate column/i.test(String(e?.message || e))) throw e
    }
  }
  waReady = true
}
const WA_GROUP_RE = /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+(\?[^\s]*)?$/


// ───────────── owner / attender phone numbers (printed on the QR poster) ─────────────
let phoneReady = false
async function ensurePhoneColumns(db) {
  if (phoneReady) return
  for (const sql of ["ALTER TABLE properties ADD COLUMN owner_phone TEXT NOT NULL DEFAULT ''", "ALTER TABLE properties ADD COLUMN attender_phone TEXT NOT NULL DEFAULT ''"]) {
    try { await db.execute(sql) } catch (e) {
      if (!/duplicate column/i.test(String(e?.message || e))) throw e
    }
  }
  phoneReady = true
}
const PHONE_RE = /^[6-9]\d{9}$/
function cleanPhone(v, label) {
  let d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2)
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  if (d && !PHONE_RE.test(d)) throw new HttpError(400, `${label} must be a 10-digit mobile number (or leave it empty).`)
  return d
}

// "Tenant informed" marker on a complaint: which status the tenant was last told about (set when someone taps the WhatsApp button).
let notifyReady = false
async function ensureNotifyColumn(db) {
  if (notifyReady) return
  try { await db.execute('ALTER TABLE complaints ADD COLUMN notified_status TEXT') } catch (e) {
    if (!/duplicate column/i.test(String(e?.message || e))) throw e
  }
  notifyReady = true
}

// ───────────── handlers ─────────────
async function loadProperties(db, user) {
  await ensureWaColumns(db)
  await ensureNotifyColumn(db)
  await ensurePhoneColumns(db)
  await ensureIndexes(db)
  return all(db, 'SELECT * FROM properties WHERE owner_id = ? ORDER BY created_at', [user.id])
}

// Very cheap "did anything change?" check. The app asks this every few seconds instead of re-downloading everything,
// and only does a full reload when the fingerprint is different (new call, new complaint, status change).
const PULSE_QUERIES = [
  'SELECT status, COUNT(*) AS n, MAX(created_at) AS latest FROM complaints WHERE property_id = ? GROUP BY status ORDER BY status',
  'SELECT COUNT(*) AS n, MAX(created_at) AS latest FROM calls WHERE property_id = ?',
]
const pulseValue = (cm, cl) => JSON.stringify([cm.map((r) => [r.status, r.n, r.latest]), cl.map((r) => [r.n, r.latest])])
async function pulse(db, user, propertyId) {
  await requireOwner(db, user, propertyId)
  const [cm, cl] = (await db.batch(PULSE_QUERIES.map((sql) => ({ sql, args: [propertyId] })), 'read')).map(toObjects)
  return { v: pulseValue(cm, cl) }
}

async function loadPropertyData(db, user, propertyId) {
  await requireOwner(db, user, propertyId)
  await ensureWaColumns(db)
  const q = (sql) => ({ sql, args: [propertyId] })
  const res = await db.batch(
    [
      q('SELECT * FROM rooms WHERE property_id = ? ORDER BY room_no'),
      q('SELECT b.* FROM beds b JOIN rooms r ON r.id = b.room_id WHERE r.property_id = ?'),
      q('SELECT * FROM complaints WHERE property_id = ? ORDER BY created_at DESC LIMIT 1000'),
      q('SELECT * FROM calls WHERE property_id = ? ORDER BY created_at DESC LIMIT 300'),
      q('SELECT * FROM tenants WHERE property_id = ? ORDER BY created_at'),
      q('SELECT * FROM payments WHERE property_id = ? ORDER BY paid_on DESC'),
      ...PULSE_QUERIES.map(q),
    ],
    'read'
  )
  const [rooms, beds, complaints, calls, tenants, payments, pulseComplaints, pulseCalls] = res.map(toObjects)
  const bedsByRoom = {}
  beds.map(fixBeds).forEach((b) => (bedsByRoom[b.room_id] ||= []).push(b))
  return {
    rooms: rooms.map((r) => ({ ...r, beds: bedsByRoom[r.id] || [] })),
    complaints,
    calls: calls.map(fixCalls),
    tenants: tenants.map(fixTenant),
    payments,
    pulse: { v: pulseValue(pulseComplaints, pulseCalls) },
  }
}

async function role(db, user) {
  if (!(await loginExists(db, user.id))) throw new HttpError(401, 'This account no longer exists. Please sign in again.')
  if (await one(db, 'SELECT 1 AS ok FROM properties WHERE owner_id = ? LIMIT 1', [user.id])) return 'owner'
  if (user.email && (await one(db, 'SELECT 1 AS ok FROM property_staff WHERE lower(email) = ? LIMIT 1', [user.email]))) return 'staff'
  return 'owner'
}

// Attenders (and removed attenders) must never be able to start their own PG and turn into owners.
async function requireCanOwn(db, user) {
  if (!(await loginExists(db, user.id))) throw new HttpError(401, 'This account no longer exists. Please sign in again.')
  const ownsOne = await one(db, 'SELECT 1 AS ok FROM properties WHERE owner_id = ? LIMIT 1', [user.id])
  if (!ownsOne && user.email && (await one(db, 'SELECT 1 AS ok FROM property_staff WHERE lower(email) = ? LIMIT 1', [user.email]))) throw FORBIDDEN()
}

async function staffLoad(db, user) {
  if (!user.email) return { properties: [], complaints: [], calls: [], contacts: [] }
  const mine = `SELECT DISTINCT p.id FROM properties p JOIN property_staff s ON s.property_id = p.id WHERE lower(s.email) = ?`
  const [properties, complaints, calls, contacts] = await Promise.all([
    all(db, `SELECT DISTINCT p.id, p.name FROM properties p JOIN property_staff s ON s.property_id = p.id WHERE lower(s.email) = ? ORDER BY p.name`, [user.email]),
    all(
      db,
      `SELECT id, property_id, tenant_name, message, category, priority, kind, status, created_at, caller_phone
         FROM complaints WHERE property_id IN (${mine}) ORDER BY created_at DESC LIMIT 300`,
      [user.email]
    ),
    all(
      db,
      `SELECT id, property_id, caller_name, caller_phone, summary, intent, sentiment, duration_seconds, created_at, needs_follow_up
         FROM calls WHERE property_id IN (${mine}) ORDER BY created_at DESC LIMIT 200`,
      [user.email]
    ),
    all(
      db,
      `SELECT t.id, t.property_id, t.name, t.phone, t.whatsapp, r.room_no, b.label AS bed_label
         FROM tenants t JOIN beds b ON b.id = t.bed_id JOIN rooms r ON r.id = b.room_id
        WHERE t.status = 'active' AND t.property_id IN (${mine}) ORDER BY r.room_no, t.name`,
      [user.email]
    ),
  ])
  return { properties, complaints, calls: calls.map(fixCalls), contacts }
}

// "Load sample data" button
async function seedDemo(db, user) {
  const pid = uuid()
  const stmts = [{ sql: 'INSERT INTO properties (id, owner_id, name) VALUES (?, ?, ?)', args: [pid, user.id, 'Green Nest PG'] }]
  const spec = [
    ['101', 1, 8000, [false, true]],
    ['102', 1, 6500, [true, true, false]],
    ['103', 1, 9500, [true]],
    ['201', 2, 6000, [true, false, false]],
    ['202', 2, 7500, [false, true]],
    ['203', 2, 5500, [true, false, true, false]],
  ]
  const names = ['Ramesh Kumar', 'Sunil Reddy', 'Arjun Mehta', 'Vikram S.', 'Neha Gupta', 'Karthik R.', 'Faisal Khan', 'Anita Joshi']
  const now = new Date()
  const ymd = (d) => d.toISOString().slice(0, 10)
  const monthStart = (back) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1))
  const addDays = (d, n) => new Date(d.getTime() + n * 86400000)
  const ago = (hours) => new Date(now.getTime() - hours * 3600000).toISOString()
  let n = 0
  for (const [no, floor, price, beds] of spec) {
    const rid = uuid()
    stmts.push({ sql: 'INSERT INTO rooms (id, property_id, room_no, floor, price) VALUES (?,?,?,?,?)', args: [rid, pid, no, floor, price] })
    let i = 0
    for (const occupied of beds) {
      i += 1
      const bid = uuid()
      stmts.push({ sql: 'INSERT INTO beds (id, room_id, label, occupied) VALUES (?,?,?,?)', args: [bid, rid, `Bed ${i}`, occupied ? 1 : 0] })
      if (!occupied) continue
      n += 1
      const tid = uuid()
      const phone = '98765400' + (10 + n)
      stmts.push({
        sql: 'INSERT INTO tenants (id, property_id, bed_id, name, phone, whatsapp, rent_amount, deposit, move_in, due_day) VALUES (?,?,?,?,?,?,?,?,?,5)',
        args: [tid, pid, bid, names[(n - 1) % names.length], phone, phone, price, price * 2, ymd(addDays(monthStart(2), 2))],
      })
      for (const back of [2, 1]) {
        const m = monthStart(back)
        stmts.push({
          sql: "INSERT INTO payments (id, property_id, tenant_id, amount, paid_on, for_month, method) VALUES (?,?,?,?,?,?,'UPI')",
          args: [uuid(), pid, tid, price, ymd(addDays(m, 4)), ymd(m).slice(0, 7)],
        })
      }
      if (n % 2 === 0) {
        stmts.push({
          sql: "INSERT INTO payments (id, property_id, tenant_id, amount, paid_on, for_month, method) VALUES (?,?,?,?,?,?,'Cash')",
          args: [uuid(), pid, tid, price, todayIST(), todayIST().slice(0, 7)],
        })
      }
    }
  }
  const complaints = [
    ['Rajiv M.', 'Hot water is not available in the morning. Please check the geyser.', 'Maintenance', 'high', 'complaint', 'open', 20],
    ['Rohit Verma', 'Request deep cleaning of bathroom in room 102.', 'Cleaning', 'medium', 'request', 'in_progress', 22],
    ['Megha R.', 'Can I get a monthly discount for 6-month advance payment?', 'Pricing', 'low', 'query', 'in_progress', 23],
    ['Nandini P.', 'Please install a water purifier on 2nd floor.', 'Amenities', 'low', 'request', 'in_progress', 24],
  ]
  for (const [who, msg, cat, pri, kind, status, h] of complaints) {
    stmts.push({
      sql: 'INSERT INTO complaints (id, property_id, tenant_name, message, category, priority, kind, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      args: [uuid(), pid, who, msg, cat, pri, kind, status, ago(h)],
    })
  }
  const calls = [
    ['Amit Kumar', 'Caller asked about bed availability for a working professional. Prefers AC room.', 'bed_vacancy', 'green', 142, 0.33],
    ['Sneha D.', 'Wanted price list for triple sharing. Mentioned budget around ₹7000.', 'price_query', 'orange', 95, 3],
    ['Rajiv M.', 'Existing tenant complained about hot water issue in morning.', 'complaint', 'red', 218, 21],
    ['Kavya S.', 'Looking for single-sharing room for 3 months. Will visit this weekend.', 'room_vacancy', 'green', 110, 25],
    ['Rahul A.', 'Asked if any bed is free on the first floor. Wants to move in next week.', 'bed_vacancy', 'green', 75, 28],
    ['Priya N.', 'Asked about monthly rent for double sharing and the security deposit.', 'price_query', 'orange', 88, 33],
    ['Tenant 203', 'Wifi is slow in the evenings. Requested a router check.', 'complaint', 'orange', 130, 47],
    ['Imran S.', 'Requested an extra cupboard in his room.', 'request', 'green', 64, 52],
  ]
  for (const [who, summary, intent, sentiment, secs, h] of calls) {
    stmts.push({
      sql: 'INSERT INTO calls (id, property_id, caller_name, summary, intent, sentiment, duration_seconds, created_at) VALUES (?,?,?,?,?,?,?,?)',
      args: [uuid(), pid, who, summary, intent, sentiment, secs, ago(h)],
    })
  }
  await db.batch(stmts, 'write')
  return pid
}

// ───────────── files ─────────────
// Bytes live in their own table, so loading tenants / payments never pulls file data.
let filesReady = false
async function ensureFilesTable(db) {
  if (filesReady) return
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS files (
         id          TEXT PRIMARY KEY,
         owner_id    TEXT NOT NULL,
         property_id TEXT NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
         tenant_id   TEXT,
         name        TEXT NOT NULL DEFAULT '',
         mime        TEXT NOT NULL,
         size        INTEGER NOT NULL,
         data        BLOB NOT NULL,
         created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
       )`,
      'CREATE INDEX IF NOT EXISTS idx_files_property ON files(property_id)',
      'CREATE INDEX IF NOT EXISTS idx_files_owner ON files(owner_id)',
    ].map((sql) => ({ sql, args: [] })),
    'write'
  )
  filesReady = true
}

// The first bytes must match the declared type, so nobody can store a web page as "image/jpeg".
function looksLike(mime, b) {
  if (mime === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff
  if (mime === 'image/png') return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47
  if (mime === 'image/webp') return b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  if (mime === 'application/pdf') return b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46
  return false
}

async function uploadFile({ db, user, url, request, body, env }) {
  const mime = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  const ext = FILE_TYPES[mime]
  if (!ext) throw new HttpError(400, 'Only JPG, PNG, WebP photos or PDF files are allowed.')
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(0)
  if (!bytes.length) throw new HttpError(400, 'The file is empty.')
  if (bytes.length > (mime === 'application/pdf' ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
    throw new HttpError(413, mime === 'application/pdf' ? 'PDF is larger than 1.5 MB. Use a photo instead.' : 'Photo is too large even after shrinking. Try a clearer, simpler photo.')
  }
  if (!looksLike(mime, bytes)) throw new HttpError(400, 'This file does not look like a valid ' + ext.toUpperCase() + '.')

  const tenantId = url.searchParams.get('tenant_id')
  const propertyId = await propertyOfTenant(db, tenantId)
  await requireOwner(db, user, propertyId)
  await ensureFilesTable(db)

  const quota = (Number(env.FILE_QUOTA_MB) || DEFAULT_QUOTA_MB) * 1024 * 1024
  const used = Number((await one(db, 'SELECT COALESCE(SUM(size), 0) AS s FROM files WHERE owner_id = ?', [user.id])).s)
  if (used + bytes.length > quota) throw new HttpError(413, 'Your file storage is full. Delete some old documents first.')

  const id = uuid()
  const name = String(url.searchParams.get('name') || 'file').slice(0, 120)
  await db.execute({
    sql: 'INSERT INTO files (id, owner_id, property_id, tenant_id, name, mime, size, data) VALUES (?,?,?,?,?,?,?,?)',
    args: [id, user.id, propertyId, tenantId, name, mime, bytes.length, bytes],
  })
  return { id, path: `turso:${id}.${ext}`, size: bytes.length }
}

const fileIdOf = (s) => {
  const id = String(s || '').replace(/\.[a-z0-9]{2,5}$/i, '')
  return /^[0-9a-f-]{36}$/i.test(id) ? id : null
}

async function downloadFile(db, user, rawId) {
  const id = fileIdOf(rawId)
  await ensureFilesTable(db)
  const row = id && (await one(db, 'SELECT f.mime, f.data FROM files f JOIN properties p ON p.id = f.property_id WHERE f.id = ? AND p.owner_id = ?', [id, user.id]))
  if (!row) throw new HttpError(404, 'File not found')
  return new Response(row.data, {
    headers: {
      'content-type': row.mime,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'content-disposition': 'inline',
      ...CORS,
    },
  })
}

async function deleteFile(db, user, rawId) {
  const id = fileIdOf(rawId)
  if (!id) throw new HttpError(404, 'File not found')
  await ensureFilesTable(db)
  await db.execute({ sql: 'DELETE FROM files WHERE id = ? AND property_id IN (SELECT id FROM properties WHERE owner_id = ?)', args: [id, user.id] })
  return { ok: true }
}

// ───────────── complaint QR (public page, no login) ─────────────
// One QR per PG. The QR holds a secret code (properties.report_code). A tenant types phone + room + message; the
// server matches the phone against ACTIVE tenants of that PG. This page can only ADD a complaint, it never returns data.
let reportReady = false
async function ensureReportSchema(db) {
  if (reportReady) return
  try { await db.execute('ALTER TABLE properties ADD COLUMN report_code TEXT') } catch (e) {
    if (!/duplicate column/i.test(String(e?.message || e))) throw e
  }
  await db.batch(
    [
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_properties_report_code ON properties(report_code)',
      'CREATE TABLE IF NOT EXISTS report_log (key TEXT NOT NULL, at TEXT NOT NULL)',
      'CREATE INDEX IF NOT EXISTS idx_report_log ON report_log(key, at)',
    ].map((sql) => ({ sql, args: [] })),
    'write'
  )
  reportReady = true
}
const newReportCode = () => {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
async function getReportCode(db, user, propertyId, reset) {
  await requireOwner(db, user, propertyId)
  await ensureReportSchema(db)
  const cur = await one(db, 'SELECT report_code FROM properties WHERE id = ?', [propertyId])
  if (cur?.report_code && !reset) return { code: cur.report_code }
  const code = newReportCode()
  await db.execute({ sql: 'UPDATE properties SET report_code = ? WHERE id = ?', args: [code, propertyId] })
  return { code }
}

const REPORT_CATEGORIES = ['Maintenance', 'Cleaning', 'Water', 'Electricity', 'Wifi', 'Food', 'Noise', 'Other']
const last10 = (v) => String(v || '').replace(/\D/g, '').slice(-10)
const sameRoom = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

async function reportRoute({ request, db, segments, body }) {
  await ensureReportSchema(db)
  const code = String(segments[1] || body?.code || '')
  const prop = code.length >= 16 ? await one(db, 'SELECT id, name FROM properties WHERE report_code = ?', [code]) : null
  if (!prop) throw new HttpError(404, 'This QR code is not valid any more. Ask the PG owner for the new one.')

  if (request.method === 'GET') return { name: prop.name, categories: REPORT_CATEGORIES }
  if (request.method !== 'POST') throw new HttpError(404, 'Not found')

  if (body?.website) return { ok: true } // hidden field: only bots fill it in
  const phone = last10(body?.phone)
  const room = String(body?.room || '').trim().slice(0, 20)
  const message = String(body?.message || '').trim().slice(0, 1000)
  const typedName = String(body?.name || '').trim().slice(0, 80)
  const category = REPORT_CATEGORIES.includes(body?.category) ? body.category : 'Other'
  if (phone.length < 10) throw new HttpError(400, 'Please enter your 10-digit phone number.')
  if (!room) throw new HttpError(400, 'Please enter your room number.')
  if (message.length < 5) throw new HttpError(400, 'Please describe the problem (at least a few words).')

  // simple rate limit: 5 reports per phone and 30 per network address per hour
  const now = new Date()
  const since = new Date(now.getTime() - 3600000).toISOString()
  const ip = request.headers.get('cf-connecting-ip') || 'unknown'
  const count = async (key) => Number((await one(db, 'SELECT COUNT(*) AS n FROM report_log WHERE key = ? AND at > ?', [key, since])).n)
  if ((await count('ph:' + phone)) >= 5 || (await count('ip:' + ip)) >= 30) throw new HttpError(429, 'Too many reports from you in the last hour. Please try again later, or call the PG.')
  await db.batch(
    [
      { sql: 'INSERT INTO report_log (key, at) VALUES (?,?)', args: ['ph:' + phone, now.toISOString()] },
      { sql: 'INSERT INTO report_log (key, at) VALUES (?,?)', args: ['ip:' + ip, now.toISOString()] },
      { sql: 'DELETE FROM report_log WHERE at < ?', args: [new Date(now.getTime() - 2 * 86400000).toISOString()] },
    ],
    'write'
  )

  // match: the phone must belong to an active tenant of THIS PG; if several tenants share it, the room breaks the tie
  const tenants = await all(
    db,
    `SELECT t.id, t.name, t.phone, t.whatsapp, r.room_no
       FROM tenants t LEFT JOIN beds b ON b.id = t.bed_id LEFT JOIN rooms r ON r.id = b.room_id
      WHERE t.property_id = ? AND t.status = 'active'`,
    [prop.id]
  )
  const byPhone = tenants.filter((t) => last10(t.phone) === phone || last10(t.whatsapp) === phone)
  const tenant = byPhone.length === 1 ? byPhone[0] : byPhone.find((t) => sameRoom(t.room_no, room)) || null

  const row = tenant
    ? { tenant_name: tenant.name, caller_phone: tenant.phone || phone, message: `(Room ${tenant.room_no || room}) ${message}` }
    : { tenant_name: typedName || 'Unverified tenant', caller_phone: phone, message: `[Not matched to a tenant] (Room ${room}) ${message}` }
  await db.execute(insertStmt('complaints', { id: uuid(), property_id: prop.id, category, priority: 'medium', kind: 'complaint', status: 'open', ...row }))
  return { ok: true } // never says whether the phone matched
}

// ───────────── routing ─────────────
async function route({ request, db, user, segments, url, body, env }) {
  const method = request.method
  const [a, b, c] = segments // e.g. ['rooms', '<id>']

  if (a === 'role' && method === 'GET') return role(db, user)

  if (a === 'properties') {
    if (!b && method === 'GET') return loadProperties(db, user)
    if (!b && method === 'POST') {
      await requireCanOwn(db, user)
      const name = String(body?.name || '').trim()
      if (!name) throw new HttpError(400, 'Name is required')
      if (name.length > 100) throw new HttpError(400, 'PG name is too long (max 100 characters).')
      const have = Number((await one(db, 'SELECT COUNT(*) AS n FROM properties WHERE owner_id = ?', [user.id])).n)
      if (have >= MAX_PROPERTIES_PER_OWNER) throw new HttpError(400, `You can have up to ${MAX_PROPERTIES_PER_OWNER} PGs on one account.`)
      const id = uuid()
      await db.execute(insertStmt('properties', { id, owner_id: user.id, name }))
      return one(db, 'SELECT * FROM properties WHERE id = ?', [id])
    }
    if (b && c === 'data' && method === 'GET') return loadPropertyData(db, user, b)
    if (b && c === 'pulse' && method === 'GET') return pulse(db, user, b)
    if (b && !c && method === 'PATCH') {
      await requireOwner(db, user, b)
      const sets = []
      const args = []
      if (body && 'wa_group_link' in body) {
        await ensureWaColumns(db)
        const link = String(body.wa_group_link || '').trim()
        if (link && !WA_GROUP_RE.test(link)) throw new HttpError(400, 'This does not look like a WhatsApp group invite link. It starts with https://chat.whatsapp.com/')
        sets.push('wa_group_link = ?'); args.push(link || null)
      }
      if (body && ('owner_phone' in body || 'attender_phone' in body)) {
        await ensurePhoneColumns(db)
        if ('owner_phone' in body) { sets.push('owner_phone = ?'); args.push(cleanPhone(body.owner_phone, 'Owner number')) }
        if ('attender_phone' in body) { sets.push('attender_phone = ?'); args.push(cleanPhone(body.attender_phone, 'Attender number')) }
      }
      if (!sets.length) throw new HttpError(400, 'Nothing to update.')
      await db.execute({ sql: `UPDATE properties SET ${sets.join(', ')} WHERE id = ?`, args: [...args, b] })
      return { ok: true }
    }
    if (b && c === 'qr' && method === 'GET') return getReportCode(db, user, b, false)
    if (b && c === 'qr' && method === 'POST') return getReportCode(db, user, b, true)
  }

  if (a === 'rooms') {
    if (!b && method === 'POST') {
      const room = pick(body, INSERT_COLS.rooms)
      room.id ||= uuid()
      checkRoom(room, true)
      await requireOwner(db, user, room.property_id)
      const beds = (Array.isArray(body.beds) ? body.beds : []).slice(0, 20)
      const stmts = [insertStmt('rooms', room)]
      for (const bed of beds) {
        const row = { ...pick(bed, INSERT_COLS.beds), id: bed.id || uuid(), room_id: room.id }
        checkBed(row, true)
        stmts.push(insertStmt('beds', row))
      }
      await db.batch(stmts, 'write')
      return { ok: true }
    }
    if (b && method === 'PATCH') {
      await requireOwnerOfRow(db, user, 'rooms', b)
      const patch = pick(body, PATCH_COLS.rooms)
      checkRoom(patch, false)
      await db.execute(updateStmt('rooms', b, patch))
      return { ok: true }
    }
    if (b && method === 'DELETE') {
      await requireOwnerOfRow(db, user, 'rooms', b)
      // tenants in this room's beds are released first (the database also does ON DELETE SET NULL)
      await db.batch(
        [
          { sql: "UPDATE tenants SET status = 'left', move_out = COALESCE(move_out, ?) WHERE bed_id IN (SELECT id FROM beds WHERE room_id = ?)", args: [todayIST(), b] },
          { sql: 'DELETE FROM rooms WHERE id = ?', args: [b] },
        ],
        'write'
      )
      return { ok: true }
    }
  }

  if (a === 'beds') {
    if (!b && method === 'POST') {
      const bed = pick(body, INSERT_COLS.beds)
      bed.id ||= uuid()
      checkBed(bed, true)
      await requireOwner(db, user, await propertyOfRoom(db, bed.room_id))
      await db.execute(insertStmt('beds', bed))
      return { ok: true }
    }
    if (b && method === 'PATCH') {
      await requireOwnerOfRow(db, user, 'beds', b)
      const patch = pick(body, PATCH_COLS.beds)
      checkBed(patch, false)
      await db.execute(updateStmt('beds', b, patch))
      return { ok: true }
    }
    if (b && method === 'DELETE') {
      await requireOwnerOfRow(db, user, 'beds', b)
      await db.batch(
        [
          { sql: "UPDATE tenants SET status = 'left', move_out = COALESCE(move_out, ?) WHERE bed_id = ?", args: [todayIST(), b] },
          { sql: 'DELETE FROM beds WHERE id = ?', args: [b] },
        ],
        'write'
      )
      return { ok: true }
    }
  }

  if (a === 'tenants') {
    if (!b && method === 'POST') {
      const t = pick(body, INSERT_COLS.tenants)
      t.id ||= uuid()
      checkTenant(t, true)
      await requireOwner(db, user, t.property_id)
      await checkBedInProperty(db, t.bed_id, t.property_id)
      await ensureIndexes(db)
      const active = (t.status ?? 'active') === 'active'
      if (t.bed_id != null && active && !(await bedIsFree(db, t.bed_id))) throw BED_TAKEN()
      // the tenant and the "bed is occupied" mark are saved together, so they can never disagree
      const stmts = [insertStmt('tenants', t)]
      if (t.bed_id != null && active) stmts.push({ sql: 'UPDATE beds SET occupied = 1, vacant_since = NULL WHERE id = ?', args: [t.bed_id] })
      await db.batch(stmts, 'write')
      return { ok: true }
    }
    if (b && method === 'PATCH') {
      const pid = await propertyOfRow(db, 'tenants', b)
      await requireOwner(db, user, pid)
      const patch = pick(body, PATCH_COLS.tenants)
      checkTenant(patch, false)
      if ('wa_invited_at' in patch) await ensureWaColumns(db)
      if ('bed_id' in patch) await checkBedInProperty(db, patch.bed_id, pid)
      const cur = await one(db, 'SELECT bed_id, status FROM tenants WHERE id = ?', [b])
      const newBed = 'bed_id' in patch ? patch.bed_id : cur.bed_id
      const newStatus = patch.status ?? cur.status
      const stmts = [updateStmt('tenants', b, patch)]
      // moving out / changing bed frees the old bed; taking a bed marks it occupied (all in one save)
      if (cur.bed_id && (newBed !== cur.bed_id || newStatus !== 'active')) {
        stmts.push({ sql: 'UPDATE beds SET occupied = 0, vacant_since = ? WHERE id = ?', args: [todayIST(), cur.bed_id] })
      }
      if (newBed && newStatus === 'active' && (newBed !== cur.bed_id || cur.status !== 'active')) {
        if (!(await bedIsFree(db, newBed, b))) throw BED_TAKEN()
        stmts.push({ sql: 'UPDATE beds SET occupied = 1, vacant_since = NULL WHERE id = ?', args: [newBed] })
      }
      await db.batch(stmts, 'write')
      return { ok: true }
    }
  }

  if (a === 'payments') {
    if (!b && method === 'POST') {
      const p = pick(body, INSERT_COLS.payments)
      p.id ||= uuid()
      checkPayment(p, true)
      await requireOwner(db, user, p.property_id)
      if ((await propertyOfTenant(db, p.tenant_id)) !== p.property_id) throw FORBIDDEN()
      await db.execute(insertStmt('payments', p))
      return { ok: true }
    }
    if (b && method === 'PATCH') {
      await requireOwnerOfRow(db, user, 'payments', b)
      const patch = pick(body, PATCH_COLS.payments)
      checkPayment(patch, false)
      await db.execute(updateStmt('payments', b, patch))
      return { ok: true }
    }
    if (b && method === 'DELETE') {
      await requireOwnerOfRow(db, user, 'payments', b)
      await db.execute({ sql: 'DELETE FROM payments WHERE id = ?', args: [b] })
      return { ok: true }
    }
  }

  if (a === 'complaints' && b && method === 'PATCH') {
    await requireOwnerOfRow(db, user, 'complaints', b)
    const patch = pick(body, PATCH_COLS.complaints)
    oneOf(patch, 'status', ['open', 'in_progress', 'resolved'], 'Status')
    oneOf(patch, 'notified_status', ['in_progress', 'resolved'], 'Notified status')
    if (!Object.keys(patch).length) throw bad('Nothing to update.')
    await ensureNotifyColumn(db)
    await db.execute(updateStmt('complaints', b, patch))
    return { ok: true }
  }

  if (a === 'feedback' && !b && method === 'POST') {
    const f = pick(body, INSERT_COLS.feedback)
    text(f, 'message', 2000, 'Message', { nonEmpty: true, must: true })
    if (f.message.length < 3) throw bad('Please write a little more.')
    if (f.kind === undefined) f.kind = 'idea'
    oneOf(f, 'kind', ['bug', 'idea', 'praise', 'other'], 'Type')
    await db.execute(insertStmt('feedback', { ...f, id: f.id || uuid(), user_id: user.id, user_email: user.email || null }))
    return { ok: true }
  }

  if (a === 'staff') {
    // attender (staff) screens
    if (b === 'load' && method === 'GET') return staffLoad(db, user)
    if (b === 'complaints' && c && method === 'PATCH') {
      const pid = await propertyOfRow(db, 'complaints', c)
      if (!(await isStaffOf(db, user, pid))) throw FORBIDDEN()
      const sets = []
      const args = []
      if (body?.status !== undefined) {
        if (!['open', 'in_progress', 'resolved'].includes(body.status)) throw new HttpError(400, 'Invalid status')
        sets.push('status = ?'); args.push(body.status)
      }
      if (body?.notified_status !== undefined) {
        if (!['in_progress', 'resolved'].includes(body.notified_status)) throw new HttpError(400, 'Invalid status')
        await ensureNotifyColumn(db)
        sets.push('notified_status = ?'); args.push(body.notified_status)
      }
      if (!sets.length) throw new HttpError(400, 'Nothing to update.')
      await db.execute({ sql: `UPDATE complaints SET ${sets.join(', ')} WHERE id = ?`, args: [...args, c] })
      return { ok: true }
    }
    // owner manages attenders
    if (!b && method === 'GET') {
      const pid = url.searchParams.get('property_id')
      await requireOwner(db, user, pid)
      return all(db, 'SELECT * FROM property_staff WHERE property_id = ? ORDER BY created_at', [pid])
    }
    if (!b && method === 'POST') {
      const s = pick(body, INSERT_COLS.property_staff)
      await requireOwner(db, user, s.property_id)
      s.id ||= uuid()
      s.email = String(s.email || '').trim().toLowerCase()
      if (!s.email) throw new HttpError(400, 'Email is required')
      text(s, 'name', 100, 'Name')
      const haveStaff = Number((await one(db, 'SELECT COUNT(*) AS n FROM property_staff WHERE property_id = ?', [s.property_id])).n)
      if (haveStaff >= 30) throw new HttpError(400, 'You can add up to 30 attenders per PG.')
      if (s.email === user.email) throw new HttpError(400, 'That is your own email. Use a different email for the attender.')
      if (await one(db, 'SELECT 1 AS ok FROM property_staff WHERE property_id = ? AND lower(email) = ?', [s.property_id, s.email])) {
        throw new HttpError(409, 'This email is already added.', '23505')
      }
      // The owner creates the attender's login (email + password). An email that already has a login can only be
      // reused if it is an attender already, so an owner can never take over somebody else's account.
      const existing = await findLogin(db, s.email)
      if (existing) {
        const isOwner = await one(db, 'SELECT 1 AS ok FROM properties WHERE owner_id = ? LIMIT 1', [existing.id])
        const isStaff = await one(db, 'SELECT 1 AS ok FROM property_staff WHERE lower(email) = ? LIMIT 1', [s.email])
        if (isOwner || !isStaff) throw new HttpError(409, 'This email already has an account. Use a different email for the attender.')
      } else {
        await createLogin(db, s.email, body?.password)
      }
      await db.execute(insertStmt('property_staff', s))
      return one(db, 'SELECT * FROM property_staff WHERE id = ?', [s.id])
    }
    // owner sets a new password for an attender
    if (b && method === 'PATCH') {
      await requireOwnerOfRow(db, user, 'property_staff', b)
      const st = await one(db, 'SELECT email FROM property_staff WHERE id = ?', [b])
      const elsewhere = await one(
        db,
        'SELECT 1 AS ok FROM property_staff s JOIN properties p ON p.id = s.property_id WHERE lower(s.email) = lower(?) AND p.owner_id <> ? LIMIT 1',
        [st.email, user.id]
      )
      if (elsewhere) throw new HttpError(409, 'This attender also works for another owner, so only they can change this password.')
      await setLoginPassword(db, st.email, body?.password)
      return { ok: true }
    }
    if (b && method === 'DELETE') {
      await requireOwnerOfRow(db, user, 'property_staff', b)
      const st = await one(db, 'SELECT email FROM property_staff WHERE id = ?', [b])
      await db.execute({ sql: 'DELETE FROM property_staff WHERE id = ?', args: [b] })
      // no longer an attender anywhere (and not an owner): delete the login too, so the account stops working
      if (st) {
        const login = await findLogin(db, st.email)
        const stillStaff = await one(db, 'SELECT 1 AS ok FROM property_staff WHERE lower(email) = lower(?) LIMIT 1', [st.email])
        const isOwner = login && (await one(db, 'SELECT 1 AS ok FROM properties WHERE owner_id = ? LIMIT 1', [login.id]))
        if (login && !stillStaff && !isOwner) await deleteLogin(db, st.email)
      }
      return { ok: true }
    }
  }

  if (a === 'files') {
    if (!b && method === 'POST') return uploadFile({ db, user, url, request, body, env })
    if (b && method === 'GET') return downloadFile(db, user, b)
    if (b && method === 'DELETE') return deleteFile(db, user, b)
  }

  if (a === 'seed' && method === 'POST') {
    await requireCanOwn(db, user)
    return seedDemo(db, user)
  }

  throw new HttpError(404, 'Not found')
}

// ───────────── voice agent (server-to-server, protected by VOICE_API_KEY) ─────────────
function sameSecret(a, b) {
  if (!a || !b || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function voiceRoute({ request, db, env, segments, body }) {
  const key = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!env.VOICE_API_KEY || !sameSecret(key, env.VOICE_API_KEY)) throw new HttpError(401, 'Bad voice key')
  const [, what] = segments
  if (request.method !== 'POST') throw new HttpError(404, 'Not found')

  if (what === 'call') {
    const row = pick(body, CALL_COLS)
    await requirePropertyExists(db, row.property_id, env)
    await db.execute(insertStmt('calls', { ...row, id: uuid() }))
    return { ok: true }
  }
  if (what === 'complaint') {
    const row = pick(body, COMPLAINT_COLS)
    await requirePropertyExists(db, row.property_id, env)
    await db.execute(insertStmt('complaints', { ...row, id: uuid() }))
    return { ok: true }
  }
  // same behaviour as the old report_leaving() database function (now always limited to ONE property)
  if (what === 'leaving') {
    const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10)
    const phone = digits(body?.phone)
    if (phone.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(body?.date || '')) throw new HttpError(400, 'phone and date (YYYY-MM-DD) are required')
    await requirePropertyExists(db, body?.property_id, env)
    const rows = await all(db, "SELECT id, property_id, name, phone FROM tenants WHERE status = 'active' AND property_id = ? ORDER BY created_at DESC", [body.property_id])
    const t = rows.find((r) => digits(r.phone) === phone)
    if (!t) return { name: null }
    const d = new Date(body.date + 'T00:00:00Z')
    const pretty = `${String(d.getUTCDate()).padStart(2, '0')} ${d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })} ${d.getUTCFullYear()}`
    await db.batch(
      [
        { sql: 'UPDATE tenants SET leaving_on = ? WHERE id = ?', args: [body.date, t.id] },
        insertStmt('complaints', {
          id: uuid(), property_id: t.property_id, tenant_name: t.name,
          message: `${t.name} plans to leave on ${pretty}.`, category: 'Vacating', priority: 'medium', kind: 'request', status: 'open',
        }),
      ],
      'write'
    )
    return { name: t.name }
  }
  throw new HttpError(404, 'Not found')
}
// If VOICE_OWNER_ID is set (the owner's login id), the voice agent can only touch that owner's PGs.
async function requirePropertyExists(db, pid, env = {}) {
  const row = pid && (await one(db, 'SELECT owner_id FROM properties WHERE id = ?', [pid]))
  if (!row || (env.VOICE_OWNER_ID && row.owner_id !== env.VOICE_OWNER_ID)) throw new HttpError(400, 'Unknown property_id')
}

// ───────────── entry point ─────────────
export async function handle({ request, db, env = {}, getUser }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const url = new URL(request.url)
    const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
    let body
    if (segments[0] === 'files' && request.method === 'POST') {
      // raw file bytes (not JSON); refuse oversized uploads before reading them
      if (Number(request.headers.get('content-length') || 0) > MAX_PDF_BYTES + 4096) throw new HttpError(413, 'The file is too large.')
      body = new Uint8Array(await request.arrayBuffer())
    } else if (!['GET', 'DELETE', 'HEAD'].includes(request.method)) {
      try { body = await request.json() } catch { body = {} }
    }
    if (segments[0] === 'voice') return json(await voiceRoute({ request, db, env, segments, body }))
    if (segments[0] === 'report') return json(await reportRoute({ request, db, segments, body }))
    if (segments[0] === 'auth') return json(await authRoute({ request, db, env, segments, body }))
    const user = await getUser(request, env)
    const out = await route({ request, db, user, segments, url, body, env })
    return out instanceof Response ? out : json(out)
  } catch (e) {
    if (e instanceof HttpError) return json(e.code ? { error: e.message, code: e.code } : { error: e.message }, e.status)
    const msg = String(e?.message || e)
    // database rules (CHECK / FOREIGN KEY / UNIQUE / NOT NULL) -> a plain-language 400 for the app (never raw SQL text)
    if (/constraint|SQLITE_CONSTRAINT/i.test(msg)) {
      if (/UNIQUE/i.test(msg)) {
        const why = /tenants\.bed_id/i.test(msg) ? BED_TAKEN().message : 'This already exists.'
        return json({ error: why, code: '23505' }, 409)
      }
      if (/FOREIGN KEY/i.test(msg)) return json({ error: 'This item is linked to other records, so it cannot be changed that way.', code: 'constraint' }, 400)
      return json({ error: 'Some of the information is not allowed. Please check it and try again.', code: 'constraint' }, 400)
    }
    console.error('API error:', msg)
    return json({ error: 'Server error' }, 500)
  }
}

// ───────────── login check ─────────────
// Kept under the old name too, so functions/api/[[path]].js keeps working without any edit.
export const getUser = verifyLogin
export const getSupabaseUser = verifyLogin
