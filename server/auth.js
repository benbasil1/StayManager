// StayManager login, stored in Turso (replaces Supabase Auth).
// Passwords: PBKDF2-SHA256 (100,000 rounds = the maximum Cloudflare Workers allows), random salt per user.
// Sessions: a signed token (HMAC-SHA256) valid for 30 days, sent as "Authorization: Bearer <token>".
// Needs ONE Cloudflare secret: AUTH_SECRET (a long random string).
import { HttpError } from './errors.js'

const ITERATIONS = 100000
const SESSION_DAYS = 30
const MAX_FAILS = 8 // wrong passwords allowed per email ...
const FAIL_WINDOW_MIN = 15 // ... within this many minutes
const enc = new TextEncoder()

const b64u = {
  enc: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (str) => Uint8Array.from(atob(str.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
}

async function pbkdf2(password, salt) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS }, key, 256))
}
const same = (a, b) => {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]
  return d === 0
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  return `${b64u.enc(salt)}.${b64u.enc(await pbkdf2(password, salt))}`
}
export async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split('.')
  if (!salt || !hash) return false
  return same(await pbkdf2(password, b64u.dec(salt)), b64u.dec(hash))
}

// ───────────── session tokens ─────────────
async function hmacKey(env) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 16) throw new HttpError(500, 'Server is missing AUTH_SECRET')
  return crypto.subtle.importKey('raw', enc.encode(env.AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}
export async function signToken(user, env) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400
  const payload = b64u.enc(enc.encode(JSON.stringify({ sub: user.id, email: user.email, exp })))
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(payload))
  return { token: `${payload}.${b64u.enc(sig)}`, exp }
}
export async function getUser(request, env) {
  const header = request.headers.get('authorization') || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  const expired = () => new HttpError(401, 'Session expired. Please sign in again.')
  if (!token) throw new HttpError(401, 'Not signed in')
  const [payload, sig] = token.split('.')
  if (!payload || !sig) throw expired()
  let ok = false
  try { ok = await crypto.subtle.verify('HMAC', await hmacKey(env), b64u.dec(sig), enc.encode(payload)) } catch { ok = false }
  if (!ok) throw expired()
  let p
  try { p = JSON.parse(new TextDecoder().decode(b64u.dec(payload))) } catch { throw expired() }
  if (!p?.sub || !p.exp || p.exp < Date.now() / 1000) throw expired()
  return { id: p.sub, email: String(p.email || '').toLowerCase() }
}

// ───────────── routes: /api/auth/signup | signin | password ─────────────
let ready = false
async function ensureTables(db) {
  if (ready) return
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS users (
         id TEXT PRIMARY KEY,
         email TEXT NOT NULL UNIQUE,
         password_hash TEXT NOT NULL,
         created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
       )`,
      `CREATE TABLE IF NOT EXISTS login_fails (email TEXT NOT NULL, at TEXT NOT NULL)`,
      `CREATE INDEX IF NOT EXISTS idx_login_fails ON login_fails(email, at)`,
    ],
    'write'
  )
  ready = true
}
const rowOf = async (db, sql, args) => {
  const r = await db.execute({ sql, args })
  return r.rows.length ? Object.fromEntries(r.columns.map((c, i) => [c, r.rows[0][i]])) : null
}
const cleanEmail = (e) => String(e || '').trim().toLowerCase()
const checkEmail = (e) => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) || e.length > 200) throw new HttpError(400, 'Please enter a valid email address.')
}
const checkPassword = (p) => {
  if (typeof p !== 'string' || p.length < 8) throw new HttpError(400, 'Password must be at least 8 characters.')
  if (p.length > 200) throw new HttpError(400, 'Password is too long.')
}
async function session(user, env) {
  const { token, exp } = await signToken(user, env)
  return { access_token: token, expires_at: exp, user: { id: user.id, email: user.email } }
}

export async function authRoute({ request, db, env, segments, body }) {
  if (request.method !== 'POST') throw new HttpError(404, 'Not found')
  await ensureTables(db)
  const what = segments[1]

  if (what === 'signup') {
    const email = cleanEmail(body?.email)
    checkEmail(email)
    checkPassword(body?.password)
    if (await rowOf(db, 'SELECT 1 AS ok FROM users WHERE email = ?', [email])) throw new HttpError(409, 'This email is already registered. Please sign in.')
    const user = { id: crypto.randomUUID(), email }
    await db.execute({ sql: 'INSERT INTO users (id, email, password_hash) VALUES (?,?,?)', args: [user.id, email, await hashPassword(body.password)] })
    return session(user, env)
  }

  if (what === 'signin') {
    const email = cleanEmail(body?.email)
    const since = new Date(Date.now() - FAIL_WINDOW_MIN * 60000).toISOString()
    const fails = await rowOf(db, 'SELECT COUNT(*) AS n FROM login_fails WHERE email = ? AND at > ?', [email, since])
    if (Number(fails?.n) >= MAX_FAILS) throw new HttpError(429, `Too many wrong attempts. Try again in ${FAIL_WINDOW_MIN} minutes.`)
    const u = await rowOf(db, 'SELECT id, email, password_hash FROM users WHERE email = ?', [email])
    // always run the hash so a missing account takes as long as a wrong password
    const good = await verifyPassword(String(body?.password || ''), u?.password_hash || 'x.x')
    if (!u || !good) {
      await db.execute({ sql: 'INSERT INTO login_fails (email, at) VALUES (?,?)', args: [email, new Date().toISOString()] })
      throw new HttpError(401, 'Wrong email or password.')
    }
    await db.execute({ sql: 'DELETE FROM login_fails WHERE email = ?', args: [email] })
    return session({ id: u.id, email: u.email }, env)
  }

  if (what === 'password') {
    const user = await getUser(request, env)
    checkPassword(body?.new_password)
    const u = await rowOf(db, 'SELECT password_hash FROM users WHERE id = ?', [user.id])
    if (!u) throw new HttpError(401, 'Session expired. Please sign in again.')
    if (body?.current_password !== undefined && !(await verifyPassword(String(body.current_password), u.password_hash))) throw new HttpError(401, 'Current password is wrong.')
    await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [await hashPassword(body.new_password), user.id] })
    return { ok: true }
  }
  throw new HttpError(404, 'Not found')
}

// ───────────── used by the owner's "Add attender" screen (server/handler.js) ─────────────
export async function findLogin(db, email) {
  await ensureTables(db)
  return rowOf(db, 'SELECT id, email FROM users WHERE email = ?', [cleanEmail(email)])
}
export async function loginExists(db, id) {
  await ensureTables(db)
  return !!(await rowOf(db, 'SELECT 1 AS ok FROM users WHERE id = ?', [id]))
}
export async function createLogin(db, email, password) {
  await ensureTables(db)
  email = cleanEmail(email)
  checkEmail(email)
  checkPassword(password)
  const id = crypto.randomUUID()
  await db.execute({ sql: 'INSERT INTO users (id, email, password_hash) VALUES (?,?,?)', args: [id, email, await hashPassword(password)] })
  return id
}
export async function setLoginPassword(db, email, password) {
  await ensureTables(db)
  checkPassword(password)
  await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE email = ?', args: [await hashPassword(password), cleanEmail(email)] })
}
export async function deleteLogin(db, email) {
  await ensureTables(db)
  await db.execute({ sql: 'DELETE FROM users WHERE email = ?', args: [cleanEmail(email)] })
}
