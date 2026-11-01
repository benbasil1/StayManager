// StayManager API: runs on Cloudflare Pages Functions and talks to Turso.
// Every request is authenticated with the user's Supabase login token, and EVERY query is scoped
// to the properties that user owns (or, for attenders, is staff at). This replaces Supabase RLS.
//
// handle({ request, db, env, getUser }) -> Response   (db = a @libsql/client client)

const CORS = {
  'access-control-allow-origin': '*', // safe: auth uses a Bearer token, never cookies
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'access-control-max-age': '86400',
}

export class HttpError extends Error {
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code
  }
}
const FORBIDDEN = () => new HttpError(403, 'Not allowed')

const json = (data, status = 200) =>
  new Response(JSON.stringify(data ?? null), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS },
  })

// ───────────── column whitelists (the client can never set anything else) ─────────────
const TENANT_COLS = ['bed_id', 'name', 'phone', 'whatsapp', 'email', 'rent_amount', 'deposit', 'move_in', 'move_out', 'due_day', 'notes', 'id_type', 'id_last4', 'id_doc_paths', 'status', 'leaving_on']
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
  complaints: ['status'],
}
const CALL_COLS = ['property_id', 'caller_name', 'summary', 'intent', 'sentiment', 'duration_seconds', 'caller_phone', 'call_id', 'transcript', 'needs_follow_up', 'flags']
const COMPLAINT_COLS = ['property_id', 'tenant_name', 'message', 'category', 'priority', 'kind', 'status', 'caller_phone', 'notified_status']

const uuid = () => crypto.randomUUID()

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

// ───────────── handlers ─────────────
async function loadProperties(db, user) {
  return all(db, 'SELECT * FROM properties WHERE owner_id = ? ORDER BY created_at', [user.id])
}

async function loadPropertyData(db, user, propertyId) {
  await requireOwner(db, user, propertyId)
  const q = (sql) => ({ sql, args: [propertyId] })
  const res = await db.batch(
    [
      q('SELECT * FROM rooms WHERE property_id = ? ORDER BY room_no'),
      q('SELECT b.* FROM beds b JOIN rooms r ON r.id = b.room_id WHERE r.property_id = ?'),
      q('SELECT * FROM complaints WHERE property_id = ? ORDER BY created_at DESC'),
      q('SELECT * FROM calls WHERE property_id = ? ORDER BY created_at DESC LIMIT 300'),
      q('SELECT * FROM tenants WHERE property_id = ? ORDER BY created_at'),
      q('SELECT * FROM payments WHERE property_id = ? ORDER BY paid_on DESC'),
    ],
    'read'
  )
  const [rooms, beds, complaints, calls, tenants, payments] = res.map(toObjects)
  const bedsByRoom = {}
  beds.map(fixBeds).forEach((b) => (bedsByRoom[b.room_id] ||= []).push(b))
  return {
    rooms: rooms.map((r) => ({ ...r, beds: bedsByRoom[r.id] || [] })),
    complaints,
    calls: calls.map(fixCalls),
    tenants: tenants.map(fixTenant),
    payments,
  }
}

async function role(db, user) {
  if (await one(db, 'SELECT 1 AS ok FROM properties WHERE owner_id = ? LIMIT 1', [user.id])) return 'owner'
  if (user.email && (await one(db, 'SELECT 1 AS ok FROM property_staff WHERE lower(email) = ? LIMIT 1', [user.email]))) return 'staff'
  return 'owner'
}

async function staffLoad(db, user) {
  if (!user.email) return { properties: [], complaints: [], contacts: [] }
  const mine = `SELECT DISTINCT p.id FROM properties p JOIN property_staff s ON s.property_id = p.id WHERE lower(s.email) = ?`
  const [properties, complaints, contacts] = await Promise.all([
    all(db, `SELECT DISTINCT p.id, p.name FROM properties p JOIN property_staff s ON s.property_id = p.id WHERE lower(s.email) = ? ORDER BY p.name`, [user.email]),
    all(
      db,
      `SELECT id, property_id, tenant_name, message, category, priority, kind, status, created_at, caller_phone
         FROM complaints WHERE property_id IN (${mine}) ORDER BY created_at DESC LIMIT 300`,
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
  return { properties, complaints, contacts }
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
          args: [uuid(), pid, tid, price, ymd(now), ymd(now).slice(0, 7)],
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

// ───────────── routing ─────────────
async function route({ request, db, user, segments, url, body }) {
  const method = request.method
  const [a, b, c] = segments // e.g. ['rooms', '<id>']

  if (a === 'role' && method === 'GET') return role(db, user)

  if (a === 'properties') {
    if (!b && method === 'GET') return loadProperties(db, user)
    if (!b && method === 'POST') {
      const name = String(body?.name || '').trim()
      if (!name) throw new HttpError(400, 'Name is required')
      const id = body.id || uuid()
      await db.execute(insertStmt('properties', { id, owner_id: user.id, name }))
      return one(db, 'SELECT * FROM properties WHERE id = ?', [id])
    }
    if (b && c === 'data' && method === 'GET') return loadPropertyData(db, user, b)
  }

  if (a === 'rooms') {
    if (!b && method === 'POST') {
      const room = pick(body, INSERT_COLS.rooms)
      room.id ||= uuid()
      await requireOwner(db, user, room.property_id)
      const stmts = [insertStmt('rooms', room)]
      for (const bed of Array.isArray(body.beds) ? body.beds : []) {
        stmts.push(insertStmt('beds', { ...pick(bed, INSERT_COLS.beds), id: bed.id || uuid(), room_id: room.id }))
      }
      await db.batch(stmts, 'write')
      return { ok: true }
    }
    if (b && method === 'PATCH') {
      await requireOwnerOfRow(db, user, 'rooms', b)
      await db.execute(updateStmt('rooms', b, pick(body, PATCH_COLS.rooms)))
      return { ok: true }
    }
    if (b && method === 'DELETE') {
      await requireOwnerOfRow(db, user, 'rooms', b)
      // tenants in this room's beds are released first (the database also does ON DELETE SET NULL)
      await db.batch(
        [
          { sql: "UPDATE tenants SET status = 'left' WHERE bed_id IN (SELECT id FROM beds WHERE room_id = ?)", args: [b] },
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
      await requireOwner(db, user, await propertyOfRoom(db, bed.room_id))
      await db.execute(insertStmt('beds', bed))
      return { ok: true }
    }
    if (b && method === 'PATCH') {
      await requireOwnerOfRow(db, user, 'beds', b)
      await db.execute(updateStmt('beds', b, pick(body, PATCH_COLS.beds)))
      return { ok: true }
    }
    if (b && method === 'DELETE') {
      await requireOwnerOfRow(db, user, 'beds', b)
      await db.batch(
        [
          { sql: "UPDATE tenants SET status = 'left' WHERE bed_id = ?", args: [b] },
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
      await requireOwner(db, user, t.property_id)
      await checkBedInProperty(db, t.bed_id, t.property_id)
      await db.execute(insertStmt('tenants', t))
      return { ok: true }
    }
    if (b && method === 'PATCH') {
      const pid = await propertyOfRow(db, 'tenants', b)
      await requireOwner(db, user, pid)
      const patch = pick(body, PATCH_COLS.tenants)
      if ('bed_id' in patch) await checkBedInProperty(db, patch.bed_id, pid)
      await db.execute(updateStmt('tenants', b, patch))
      return { ok: true }
    }
  }

  if (a === 'payments') {
    if (!b && method === 'POST') {
      const p = pick(body, INSERT_COLS.payments)
      p.id ||= uuid()
      await requireOwner(db, user, p.property_id)
      if ((await propertyOfTenant(db, p.tenant_id)) !== p.property_id) throw FORBIDDEN()
      await db.execute(insertStmt('payments', p))
      return { ok: true }
    }
    if (b && method === 'PATCH') {
      await requireOwnerOfRow(db, user, 'payments', b)
      await db.execute(updateStmt('payments', b, pick(body, PATCH_COLS.payments)))
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
    await db.execute(updateStmt('complaints', b, pick(body, PATCH_COLS.complaints)))
    return { ok: true }
  }

  if (a === 'feedback' && !b && method === 'POST') {
    const f = pick(body, INSERT_COLS.feedback)
    await db.execute(insertStmt('feedback', { ...f, id: f.id || uuid(), user_id: user.id, user_email: user.email || null }))
    return { ok: true }
  }

  if (a === 'staff') {
    // attender (staff) screens
    if (b === 'load' && method === 'GET') return staffLoad(db, user)
    if (b === 'complaints' && c && method === 'PATCH') {
      const pid = await propertyOfRow(db, 'complaints', c)
      if (!(await isStaffOf(db, user, pid))) throw FORBIDDEN()
      if (!['open', 'in_progress', 'resolved'].includes(body?.status)) throw new HttpError(400, 'Invalid status')
      await db.execute({ sql: 'UPDATE complaints SET status = ? WHERE id = ?', args: [body.status, c] })
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
      if (await one(db, 'SELECT 1 AS ok FROM property_staff WHERE property_id = ? AND lower(email) = ?', [s.property_id, s.email])) {
        throw new HttpError(409, 'This email is already added.', '23505')
      }
      await db.execute(insertStmt('property_staff', s))
      return one(db, 'SELECT * FROM property_staff WHERE id = ?', [s.id])
    }
    if (b && method === 'DELETE') {
      await requireOwnerOfRow(db, user, 'property_staff', b)
      await db.execute({ sql: 'DELETE FROM property_staff WHERE id = ?', args: [b] })
      return { ok: true }
    }
  }

  if (a === 'seed' && method === 'POST') return seedDemo(db, user)

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
    await requirePropertyExists(db, row.property_id)
    await db.execute(insertStmt('calls', { ...row, id: uuid() }))
    return { ok: true }
  }
  if (what === 'complaint') {
    const row = pick(body, COMPLAINT_COLS)
    await requirePropertyExists(db, row.property_id)
    await db.execute(insertStmt('complaints', { ...row, id: uuid() }))
    return { ok: true }
  }
  // same behaviour as the old report_leaving() database function
  if (what === 'leaving') {
    const digits = (s) => String(s || '').replace(/\D/g, '').slice(-10)
    const phone = digits(body?.phone)
    if (phone.length < 10 || !/^\d{4}-\d{2}-\d{2}$/.test(body?.date || '')) throw new HttpError(400, 'phone and date (YYYY-MM-DD) are required')
    const rows = await all(db, "SELECT id, property_id, name, phone FROM tenants WHERE status = 'active' ORDER BY created_at DESC")
    const t = rows.find((r) => digits(r.phone) === phone && (!body.property_id || r.property_id === body.property_id))
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
async function requirePropertyExists(db, pid) {
  if (!pid || !(await one(db, 'SELECT 1 AS ok FROM properties WHERE id = ?', [pid]))) throw new HttpError(400, 'Unknown property_id')
}

// ───────────── entry point ─────────────
export async function handle({ request, db, env = {}, getUser }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  try {
    const url = new URL(request.url)
    const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean)
    let body
    if (!['GET', 'DELETE', 'HEAD'].includes(request.method)) {
      try { body = await request.json() } catch { body = {} }
    }
    if (segments[0] === 'voice') return json(await voiceRoute({ request, db, env, segments, body }))
    const user = await getUser(request, env)
    return json(await route({ request, db, user, segments, url, body }))
  } catch (e) {
    if (e instanceof HttpError) return json(e.code ? { error: e.message, code: e.code } : { error: e.message }, e.status)
    const msg = String(e?.message || e)
    // database rules (CHECK / FOREIGN KEY / UNIQUE / NOT NULL) -> a clear 400 for the app
    if (/constraint|SQLITE_CONSTRAINT/i.test(msg)) return json({ error: msg.replace(/^.*?:\s*/, ''), code: /UNIQUE/i.test(msg) ? '23505' : 'constraint' }, /UNIQUE/i.test(msg) ? 409 : 400)
    console.error('API error:', msg)
    return json({ error: 'Server error' }, 500)
  }
}

// ───────────── Supabase login check ─────────────
const tokenCache = new Map()
export async function getSupabaseUser(request, env, fetchImpl = fetch) {
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) throw new HttpError(401, 'Not signed in')
  const hit = tokenCache.get(token)
  if (hit && hit.exp > Date.now()) return hit.user
  const base = env.SUPABASE_URL || env.VITE_SUPABASE_URL
  const key = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
  if (!base || !key) throw new HttpError(500, 'Server is missing the Supabase settings')
  const res = await fetchImpl(`${base}/auth/v1/user`, { headers: { authorization: `Bearer ${token}`, apikey: key } })
  if (!res.ok) throw new HttpError(401, 'Session expired. Please sign in again.')
  const u = await res.json()
  if (!u?.id) throw new HttpError(401, 'Session expired. Please sign in again.')
  const user = { id: u.id, email: String(u.email || '').toLowerCase() }
  if (tokenCache.size > 500) tokenCache.clear()
  tokenCache.set(token, { user, exp: Date.now() + 60_000 })
  return user
}
