// StayManager login, stored in Turso (replaces Supabase Auth).
// Passwords: PBKDF2-SHA256 (100,000 rounds = the maximum Cloudflare Workers allows), random salt per user.
// Sessions: a signed token (HMAC-SHA256) valid for 30 days, sent as "Authorization: Bearer <token>".
// Needs ONE Cloudflare secret: AUTH_SECRET (a long random string).
import { HttpError } from './errors.js'

const ITERATIONS = 100000
const SESSION_DAYS = 30
const MAX_FAILS = 8 // wrong passwords allowed per email ...
const FAIL_WINDOW_MIN = 15 // ... within this many minutes
const MAX_SIGNUPS_PER_IP = 10 // new accounts allowed from one network address per hour (stops bots)
const RESET_MINUTES = 60 // a password-reset link works for this long, once
const MAX_RESETS_PER_EMAIL = 3 // reset emails per address per hour
const MAX_RESETS_PER_IP = 10 // reset requests per network address per hour
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

// ───────────── routes: /api/auth/signup | signin | forgot | reset | password ─────────────
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
      `CREATE TABLE IF NOT EXISTS password_resets (
         token_hash TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         expires_at TEXT NOT NULL
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
const sha256 = async (text) => b64u.enc(await crypto.subtle.digest('SHA-256', enc.encode(text)))

// Sends the reset email through Brevo or Resend (whichever key is set). Secrets: BREVO_API_KEY or RESEND_API_KEY, and MAIL_FROM.
const mailReady = (env) => !!((env.BREVO_API_KEY || env.RESEND_API_KEY) && env.MAIL_FROM)
async function sendMail(env, to, subject, html) {
  const from = String(env.MAIL_FROM).trim()
  const res = env.BREVO_API_KEY
    ? await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { name: 'StayManager', email: from }, to: [{ email: to }], subject, htmlContent: html }),
      })
    : await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from: `StayManager <${from}>`, to: [to], subject, html }),
      })
  if (!res.ok) throw new Error(`Email provider said ${res.status}: ${(await res.text()).slice(0, 200)}`)
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
    // limit how many accounts one network address can create per hour
    const ipKey = 'signup:' + (request.headers.get('cf-connecting-ip') || 'unknown')
    const hourAgo = new Date(Date.now() - 3600000).toISOString()
    const made = await rowOf(db, 'SELECT COUNT(*) AS n FROM login_fails WHERE email = ? AND at > ?', [ipKey, hourAgo])
    if (Number(made?.n) >= MAX_SIGNUPS_PER_IP) throw new HttpError(429, 'Too many accounts created from this connection. Please try again later.')
    if (await rowOf(db, 'SELECT 1 AS ok FROM users WHERE email = ?', [email])) throw new HttpError(409, 'This email is already registered. Please sign in.')
    const user = { id: crypto.randomUUID(), email }
    await db.batch(
      [
        { sql: 'INSERT INTO users (id, email, password_hash) VALUES (?,?,?)', args: [user.id, email, await hashPassword(body.password)] },
        { sql: 'INSERT INTO login_fails (email, at) VALUES (?,?)', args: [ipKey, new Date().toISOString()] },
        { sql: 'DELETE FROM login_fails WHERE at < ?', args: [new Date(Date.now() - 86400000).toISOString()] }, // tidy up old rows
      ],
      'write'
    )
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
      await db.batch(
        [
          { sql: 'INSERT INTO login_fails (email, at) VALUES (?,?)', args: [email, new Date().toISOString()] },
          { sql: 'DELETE FROM login_fails WHERE at < ?', args: [new Date(Date.now() - 86400000).toISOString()] },
        ],
        'write'
      )
      throw new HttpError(401, 'Wrong email or password.')
    }
    await db.execute({ sql: 'DELETE FROM login_fails WHERE email = ?', args: [email] })
    return session({ id: u.id, email: u.email }, env)
  }

  // "Forgot password": always answers the same way, so nobody can use it to find out who has an account.
  if (what === 'forgot') {
    if (!mailReady(env)) throw new HttpError(503, 'Password reset by email is not set up yet. Ask your owner (or the app admin) to reset it for you.')
    const email = cleanEmail(body?.email)
    checkEmail(email)
    const hourAgo = new Date(Date.now() - 3600000).toISOString()
    const ipKey = 'forgotip:' + (request.headers.get('cf-connecting-ip') || 'unknown')
    const emailKey = 'forgot:' + email
    const byIp = await rowOf(db, 'SELECT COUNT(*) AS n FROM login_fails WHERE email = ? AND at > ?', [ipKey, hourAgo])
    if (Number(byIp?.n) >= MAX_RESETS_PER_IP) throw new HttpError(429, 'Too many requests. Please try again later.')
    const byEmail = await rowOf(db, 'SELECT COUNT(*) AS n FROM login_fails WHERE email = ? AND at > ?', [emailKey, hourAgo])
    const now = new Date().toISOString()
    await db.batch(
      [
        { sql: 'INSERT INTO login_fails (email, at) VALUES (?,?)', args: [ipKey, now] },
        ...(Number(byEmail?.n) < MAX_RESETS_PER_EMAIL ? [{ sql: 'INSERT INTO login_fails (email, at) VALUES (?,?)', args: [emailKey, now] }] : []),
        { sql: 'DELETE FROM login_fails WHERE at < ?', args: [new Date(Date.now() - 86400000).toISOString()] },
        { sql: 'DELETE FROM password_resets WHERE expires_at < ?', args: [now] },
      ],
      'write'
    )
    const u = Number(byEmail?.n) < MAX_RESETS_PER_EMAIL ? await rowOf(db, 'SELECT id, email FROM users WHERE email = ?', [email]) : null
    if (u) {
      const token = b64u.enc(crypto.getRandomValues(new Uint8Array(32)))
      await db.execute({
        sql: 'INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)',
        args: [await sha256(token), u.id, new Date(Date.now() + RESET_MINUTES * 60000).toISOString()],
      })
      // PUBLIC_URL (optional secret/variable) pins the link to your site; otherwise the site this request came to is used.
      const base = String(env.PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, '')
      const link = `${base}/#/reset/${token}`
      try {
        await sendMail(
          env,
          u.email,
          'Reset your StayManager password',
          `<p>Hi,</p><p>Someone asked to reset the password for your StayManager account. Tap the button below to choose a new one. The link works once and expires in ${RESET_MINUTES} minutes.</p>` +
            `<p><a href="${link}" style="background:#1f8a4c;color:#fff;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:700">Choose a new password</a></p>` +
            `<p style="color:#666;font-size:13px">Or open this link: ${link}<br>If you did not ask for this, ignore this email. Your password stays the same.</p>`
        )
      } catch (e) {
        console.error('Reset email failed:', e?.message || e)
      }
    }
    return { ok: true }
  }

  if (what === 'reset') {
    checkPassword(body?.password)
    const bad = () => new HttpError(400, 'This reset link is invalid or has expired. Please request a new one.')
    const token = String(body?.token || '')
    if (!token || token.length > 100) throw bad()
    const r = await rowOf(db, 'SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?', [await sha256(token)])
    if (!r || r.expires_at < new Date().toISOString()) throw bad()
    const u = await rowOf(db, 'SELECT email FROM users WHERE id = ?', [r.user_id])
    if (!u) throw bad()
    await db.batch(
      [
        { sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [await hashPassword(body.password), r.user_id] },
        { sql: 'DELETE FROM password_resets WHERE user_id = ?', args: [r.user_id] }, // the link (and any older ones) now stop working
        { sql: 'DELETE FROM login_fails WHERE email = ?', args: [u.email] },
      ],
      'write'
    )
    return { ok: true }
  }

  if (what === 'password') {
    const user = await getUser(request, env)
    checkPassword(body?.new_password)
    const u = await rowOf(db, 'SELECT password_hash FROM users WHERE id = ?', [user.id])
    if (!u) throw new HttpError(401, 'Session expired. Please sign in again.')
    // the current password is always required, so a stolen login token alone can never change the password
    if (typeof body?.current_password !== 'string' || !(await verifyPassword(body.current_password, u.password_hash))) throw new HttpError(401, 'Current password is incorrect.')
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
