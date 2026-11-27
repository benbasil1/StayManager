// StayManager login, stored in Turso (replaces Supabase Auth).
// Passwords: PBKDF2-SHA256 (100,000 rounds = the maximum Cloudflare Workers allows), random salt per user.
// Sessions: a signed token (HMAC-SHA256) valid for 30 days, sent as "Authorization: Bearer <token>".
// Needs Cloudflare secrets: AUTH_SECRET (long random string), plus for email:
//   BREVO_API_KEY or RESEND_API_KEY, and MAIL_FROM.
// Optional email polish: MAIL_FROM_NAME (default "StayManager"), MAIL_REPLY_TO (your Gmail: replies land there), SUPPORT_EMAIL.
// Optional for Google/Apple sign-in:
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY
import { HttpError } from './errors.js'
import { welcomeEmail, codeEmail, resetEmail } from './emailTemplates.js'

const ITERATIONS = 100000
const SESSION_DAYS = 30
const MAX_FAILS = 8 // wrong passwords allowed per email ...
const FAIL_WINDOW_MIN = 15 // ... within this many minutes
const MAX_SIGNUPS_PER_IP = 10 // new accounts allowed from one network address per hour (stops bots)
const RESET_MINUTES = 60 // a password-reset link works for this long, once
const MAX_RESETS_PER_EMAIL = 3 // reset emails per address per hour
const MAX_RESETS_PER_IP = 10 // reset requests per network address per hour

// ───────────── email one-time codes (signup + password change) ─────────────
const CODE_MINUTES = 10 // a 6-digit code works for this long
const CODE_ATTEMPTS = 5 // wrong guesses allowed before the code is thrown away
const MAX_CODES_PER_EMAIL = 5 // codes emailed to one address per hour
const MAX_CODES_PER_IP = 15 // codes emailed to one network address per hour

// ───────────── OAuth handoff ─────────────
const HANDOFF_SECONDS = 60 // one-time code that carries a finished Google/Apple login back to the app
const OAUTH_STATE_MINUTES = 10

const enc = new TextEncoder()

const b64u = {
  enc: (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (str) => Uint8Array.from(atob(String(str).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)),
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

// Accounts created with Google / Apple have no password. This placeholder is not a valid
// "salt.hash" pair, so verifyPassword() can never match it. See usersWithoutPassword().
const NO_PASSWORD = '!'

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

// ───────────── tables ─────────────
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
      // 6-digit codes emailed for signup and for changing a password. The code itself is never stored.
      `CREATE TABLE IF NOT EXISTS email_codes (
         email TEXT NOT NULL,
         purpose TEXT NOT NULL,
         code_hash TEXT NOT NULL,
         password_hash TEXT,
         attempts INTEGER NOT NULL DEFAULT 0,
         expires_at TEXT NOT NULL,
         created_at TEXT NOT NULL,
         PRIMARY KEY (email, purpose)
       )`,
      // Which Google / Apple account belongs to which StayManager user.
      `CREATE TABLE IF NOT EXISTS oauth_accounts (
         provider TEXT NOT NULL,
         subject TEXT NOT NULL,
         user_id TEXT NOT NULL,
         created_at TEXT NOT NULL,
         PRIMARY KEY (provider, subject)
       )`,
      // Short-lived single-use code that carries a finished OAuth login back to the app.
      `CREATE TABLE IF NOT EXISTS oauth_handoffs (
         code_hash TEXT PRIMARY KEY,
         user_id TEXT NOT NULL,
         expires_at TEXT NOT NULL
       )`,
      // PKCE verifier + CSRF state for the Google redirect.
      `CREATE TABLE IF NOT EXISTS oauth_states (
         state TEXT PRIMARY KEY,
         verifier TEXT,
         expires_at TEXT NOT NULL
       )`,
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

// ───────────── email ─────────────
// Sends through Brevo or Resend (whichever key is set). Secrets: BREVO_API_KEY or RESEND_API_KEY, and MAIL_FROM.
const mailReady = (env) => !!((env.BREVO_API_KEY || env.RESEND_API_KEY) && env.MAIL_FROM)
async function sendMail(env, to, subject, html, text) {
  const from = String(env.MAIL_FROM).trim()
  const name = String(env.MAIL_FROM_NAME || 'StayManager').trim()
  const replyTo = String(env.MAIL_REPLY_TO || '').trim()
  const res = env.BREVO_API_KEY
    ? await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { name, email: from },
          to: [{ email: to }],
          subject,
          htmlContent: html,
          ...(text ? { textContent: text } : {}),
          ...(replyTo ? { replyTo: { email: replyTo, name } } : {}),
        }),
      })
    : await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: `${name} <${from}>`,
          to: [to],
          subject,
          html,
          ...(text ? { text } : {}),
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
      })
  if (!res.ok) throw new Error(`Email provider said ${res.status}: ${(await res.text()).slice(0, 200)}`)
}

// Welcome email after an account is created. Never blocks or breaks signup: a failure is only logged.
async function sendWelcome(env, to, base) {
  if (!mailReady(env)) return
  try {
    const m = welcomeEmail({ env, appUrl: base })
    await sendMail(env, to, m.subject, m.html, m.text)
  } catch (e) {
    console.error('Welcome email failed:', e?.message || e)
  }
}

// 6 random digits, without the modulo bias a plain % 1000000 would introduce.
function sixDigits() {
  const buf = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(buf)
    if (buf[0] < 4294000000) return String(buf[0] % 1000000).padStart(6, '0')
  }
}

// Emails a code and stores only its hash. Limits how many one address/network can request per hour.
async function issueCode(db, env, email, purpose, passwordHash = null, why = '') {
  const hourAgo = new Date(Date.now() - 3600000).toISOString()
  const ipKey = 'code:' + (env.__ip || 'unknown') + ':' + purpose
  const emailKey = `codeemail:${purpose}:${email}`
  const byIp = await rowOf(db, 'SELECT COUNT(*) AS n FROM login_fails WHERE email = ? AND at > ?', [ipKey, hourAgo])
  const byEmail = await rowOf(db, 'SELECT COUNT(*) AS n FROM login_fails WHERE email = ? AND at > ?', [emailKey, hourAgo])
  if (Number(byIp?.n) >= MAX_CODES_PER_IP) throw new HttpError(429, 'Too many codes requested from this connection. Please try again later.')
  if (Number(byEmail?.n) >= MAX_CODES_PER_EMAIL) throw new HttpError(429, 'Too many codes requested for this email. Please try again in an hour.')

  const code = sixDigits()
  const now = new Date()
  await db.batch(
    [
      {
        sql: `INSERT INTO email_codes (email, purpose, code_hash, password_hash, attempts, expires_at, created_at)
              VALUES (?,?,?,?,0,?,?)
              ON CONFLICT(email, purpose) DO UPDATE SET
                code_hash = excluded.code_hash,
                password_hash = excluded.password_hash,
                attempts = 0,
                expires_at = excluded.expires_at,
                created_at = excluded.created_at`,
        args: [email, purpose, await sha256(`${purpose}:${email}:${code}`), passwordHash, new Date(now.getTime() + CODE_MINUTES * 60000).toISOString(), now.toISOString()],
      },
      { sql: 'INSERT INTO login_fails (email, at) VALUES (?,?)', args: [ipKey, now.toISOString()] },
      { sql: 'INSERT INTO login_fails (email, at) VALUES (?,?)', args: [emailKey, now.toISOString()] },
      { sql: 'DELETE FROM login_fails WHERE at < ?', args: [new Date(now.getTime() - 86400000).toISOString()] },
      { sql: 'DELETE FROM email_codes WHERE expires_at < ?', args: [now.toISOString()] },
    ],
    'write'
  )
  const m = codeEmail({ env, code, why, minutes: CODE_MINUTES })
  await sendMail(env, email, m.subject, m.html, m.text)
}

// Checks a typed code, burning it on success. Returns the row (so callers can read password_hash).
async function checkCode(db, email, purpose, code) {
  const bad = () => new HttpError(400, 'That code is wrong or has expired. Tap “Send a new code” to try again.')
  const typed = String(code || '').replace(/\D/g, '')
  if (typed.length !== 6) throw bad()
  const row = await rowOf(db, 'SELECT code_hash, password_hash, attempts, expires_at FROM email_codes WHERE email = ? AND purpose = ?', [email, purpose])
  if (!row || row.expires_at < new Date().toISOString()) throw bad()
  if (Number(row.attempts) >= CODE_ATTEMPTS) {
    await db.execute({ sql: 'DELETE FROM email_codes WHERE email = ? AND purpose = ?', args: [email, purpose] })
    throw new HttpError(400, 'Too many wrong guesses. Tap “Send a new code” to get a fresh one.')
  }
  if (!same(b64u.dec(await sha256(`${purpose}:${email}:${typed}`)), b64u.dec(row.code_hash))) {
    await db.execute({ sql: 'UPDATE email_codes SET attempts = attempts + 1 WHERE email = ? AND purpose = ?', args: [email, purpose] })
    throw bad()
  }
  await db.execute({ sql: 'DELETE FROM email_codes WHERE email = ? AND purpose = ?', args: [email, purpose] })
  return row
}

async function session(user, env) {
  const { token, exp } = await signToken(user, env)
  return { access_token: token, expires_at: exp, user: { id: user.id, email: user.email } }
}

// ───────────── OAuth helpers ─────────────
const siteBase = (request, env) => String(env.PUBLIC_URL || new URL(request.url).origin).replace(/\/+$/, '')
const redirect = (url) => new Response(null, { status: 302, headers: { location: url, 'cache-control': 'no-store' } })

// Verifies an OpenID Connect id_token against the provider's published keys.
const jwksCache = {}
async function getJwks(url) {
  const hit = jwksCache[url]
  if (hit && hit.until > Date.now()) return hit.keys
  const res = await fetch(url)
  if (!res.ok) throw new HttpError(502, 'Could not reach the sign-in provider.')
  const { keys } = await res.json()
  jwksCache[url] = { keys, until: Date.now() + 3600000 }
  return keys
}
async function verifyIdToken(token, jwksUrl, audience, issuers) {
  const fail = () => new HttpError(401, 'Could not verify the sign-in provider’s response.')
  const [h, p, s] = String(token || '').split('.')
  if (!h || !p || !s) throw fail()
  let header, payload
  try {
    header = JSON.parse(new TextDecoder().decode(b64u.dec(h)))
    payload = JSON.parse(new TextDecoder().decode(b64u.dec(p)))
  } catch { throw fail() }
  const keys = await getJwks(jwksUrl)
  const jwk = keys.find((k) => k.kid === header.kid) || (keys.length === 1 ? keys[0] : null)
  if (!jwk) throw fail()
  const rsa = /^RS/.test(String(jwk.alg || header.alg))
  const algo = { name: rsa ? 'RSASSA-PKCS1-v1_5' : 'ECDSA', hash: 'SHA-256' }
  let key
  try { key = await crypto.subtle.importKey('jwk', jwk, algo, false, ['verify']) } catch { throw fail() }
  const ok = await crypto.subtle.verify(algo, key, b64u.dec(s), enc.encode(`${h}.${p}`))
  if (!ok) throw fail()
  if (!payload.exp || payload.exp * 1000 < Date.now()) throw new HttpError(401, 'That sign-in has expired. Please try again.')
  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (audience && !aud.includes(audience)) throw fail()
  if (issuers && !issuers.includes(payload.iss)) throw fail()
  return payload
}

// Finds the StayManager user behind a provider account, creating or linking one as needed.
async function userForOauth(db, provider, subject, email, emailVerified, onCreated) {
  const linked = await rowOf(db, 'SELECT user_id FROM oauth_accounts WHERE provider = ? AND subject = ?', [provider, subject])
  if (linked) {
    const u = await rowOf(db, 'SELECT id, email FROM users WHERE id = ?', [linked.user_id])
    if (u) return u
    // The user row was deleted: drop the stale link and fall through to re-create it.
    await db.execute({ sql: 'DELETE FROM oauth_accounts WHERE provider = ? AND subject = ?', args: [provider, subject] })
  }
  const mail = cleanEmail(email)
  if (!mail) throw new HttpError(400, 'The sign-in provider did not share an email address, so we cannot make an account.')

  const existing = await rowOf(db, 'SELECT id, email FROM users WHERE email = ?', [mail])
  // Only take over an existing account if the provider vouches for the address. Otherwise someone
  // could sign up at Apple with a victim's email and inherit their PG data.
  if (existing) {
    if (!emailVerified) throw new HttpError(409, 'This email already has an account. Sign in with your password instead.')
    await db.execute({
      sql: 'INSERT OR IGNORE INTO oauth_accounts (provider, subject, user_id, created_at) VALUES (?,?,?,?)',
      args: [provider, subject, existing.id, new Date().toISOString()],
    })
    return existing
  }

  const user = { id: crypto.randomUUID(), email: mail }
  await db.batch(
    [
      { sql: 'INSERT INTO users (id, email, password_hash) VALUES (?,?,?)', args: [user.id, user.email, NO_PASSWORD] },
      { sql: 'INSERT OR IGNORE INTO oauth_accounts (provider, subject, user_id, created_at) VALUES (?,?,?,?)', args: [provider, subject, user.id, new Date().toISOString()] },
    ],
    'write'
  )
  if (onCreated) await onCreated(user)
  return user
}

// Stores a single-use code and returns the app URL that finishes the login.
async function handoff(db, request, env, user) {
  const code = b64u.enc(crypto.getRandomValues(new Uint8Array(32)))
  await db.batch(
    [
      {
        sql: 'INSERT INTO oauth_handoffs (code_hash, user_id, expires_at) VALUES (?,?,?)',
        args: [await sha256(code), user.id, new Date(Date.now() + HANDOFF_SECONDS * 1000).toISOString()],
      },
      { sql: 'DELETE FROM oauth_handoffs WHERE expires_at < ?', args: [new Date().toISOString()] },
      { sql: 'DELETE FROM oauth_states WHERE expires_at < ?', args: [new Date().toISOString()] },
    ],
    'write'
  )
  return `${siteBase(request, env)}/#/oauth?code=${encodeURIComponent(code)}`
}

const pkce = async () => {
  const verifier = b64u.enc(crypto.getRandomValues(new Uint8Array(32)))
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier)))
  return { verifier, challenge: b64u.enc(digest) }
}

// Apple's client secret is a JWT we sign ourselves with the .p8 key (ES256, raw r||s output = JWT format).
async function appleClientSecret(env) {
  const now = Math.floor(Date.now() / 1000)
  const head = b64u.enc(enc.encode(JSON.stringify({ alg: 'ES256', kid: env.APPLE_KEY_ID })))
  const body = b64u.enc(
    enc.encode(JSON.stringify({ iss: env.APPLE_TEAM_ID, iat: now, exp: now + 600, aud: 'https://appleid.apple.com', sub: env.APPLE_CLIENT_ID }))
  )
  const pem = String(env.APPLE_PRIVATE_KEY || '')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\\n/g, '')
    .replace(/\s+/g, '')
  if (!pem) throw new HttpError(500, 'Server is missing APPLE_PRIVATE_KEY')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`))
  return `${head}.${body}.${b64u.enc(sig)}`
}

// ───────────── routes ─────────────
// /api/auth/signup/start | signup/verify | signin | forgot | reset
// /api/auth/password/start | password/verify
// /api/auth/google/start | google/callback | apple/start | apple/callback | oauth/exchange
export async function authRoute({ request, db, env, segments, body }) {
  await ensureTables(db)
  const what = segments[1]
  const sub = segments[2]
  env.__ip = request.headers.get('cf-connecting-ip') || 'unknown'

  // ───────────── Google / Apple ─────────────
  if (what === 'google' || what === 'apple') {
    const provider = what

    if (sub === 'start' && request.method === 'GET') {
      const base = siteBase(request, env)
      if (provider === 'google') {
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) throw new HttpError(503, 'Google sign-in is not set up on the server yet.')
        const state = b64u.enc(crypto.getRandomValues(new Uint8Array(24)))
        const { verifier, challenge } = await pkce()
        await db.execute({
          sql: 'INSERT INTO oauth_states (state, verifier, expires_at) VALUES (?,?,?)',
          args: [state, verifier, new Date(Date.now() + OAUTH_STATE_MINUTES * 60000).toISOString()],
        })
        const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        url.searchParams.set('client_id', env.GOOGLE_CLIENT_ID)
        url.searchParams.set('redirect_uri', `${base}/api/auth/google/callback`)
        url.searchParams.set('response_type', 'code')
        url.searchParams.set('scope', 'openid email profile')
        url.searchParams.set('state', state)
        url.searchParams.set('code_challenge', challenge)
        url.searchParams.set('code_challenge_method', 'S256')
        url.searchParams.set('prompt', 'select_account')
        return redirect(url.toString())
      }
      if (!env.APPLE_CLIENT_ID || !env.APPLE_TEAM_ID || !env.APPLE_KEY_ID || !env.APPLE_PRIVATE_KEY) {
        throw new HttpError(503, 'Apple sign-in is not set up on the server yet.')
      }
      const state = b64u.enc(crypto.getRandomValues(new Uint8Array(24)))
      await db.execute({
        sql: 'INSERT INTO oauth_states (state, verifier, expires_at) VALUES (?,?,?)',
        args: [state, null, new Date(Date.now() + OAUTH_STATE_MINUTES * 60000).toISOString()],
      })
      const url = new URL('https://appleid.apple.com/auth/authorize')
      url.searchParams.set('client_id', env.APPLE_CLIENT_ID)
      url.searchParams.set('redirect_uri', `${base}/api/auth/apple/callback`)
      url.searchParams.set('response_type', 'code id_token')
      url.searchParams.set('scope', 'name email')
      url.searchParams.set('response_mode', 'form_post')
      url.searchParams.set('state', state)
      return redirect(url.toString())
    }

    if (sub === 'callback' && provider === 'google' && request.method === 'GET') {
      const base = siteBase(request, env)
      const url = new URL(request.url)
      const back = (msg) => redirect(`${base}/#/login?error=${encodeURIComponent(msg)}`)
      if (url.searchParams.get('error')) return back('Google sign-in was cancelled.')
      const state = url.searchParams.get('state') || ''
      const st = state && (await rowOf(db, 'SELECT verifier, expires_at FROM oauth_states WHERE state = ?', [state]))
      if (!st) return back('That sign-in link has expired. Please try again.')
      await db.execute({ sql: 'DELETE FROM oauth_states WHERE state = ?', args: [state] })

      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code: String(url.searchParams.get('code') || ''),
          client_id: env.GOOGLE_CLIENT_ID,
          client_secret: env.GOOGLE_CLIENT_SECRET,
          redirect_uri: `${base}/api/auth/google/callback`,
          grant_type: 'authorization_code',
          code_verifier: st.verifier || '',
        }),
      })
      if (!tokenRes.ok) return back('Google sign-in failed. Please try again.')
      const { id_token: idToken } = await tokenRes.json()
      const claims = await verifyIdToken(idToken, 'https://www.googleapis.com/oauth2/v3/certs', env.GOOGLE_CLIENT_ID, [
        'accounts.google.com',
        'https://accounts.google.com',
      ])
      const user = await userForOauth(db, 'google', claims.sub, claims.email, claims.email_verified !== false && claims.email_verified !== 'false', (u) => sendWelcome(env, u.email, base))
      return redirect(await handoff(db, request, env, user))
    }

    if (sub === 'callback' && provider === 'apple' && request.method === 'POST') {
      const base = siteBase(request, env)
      const back = (msg) => redirect(`${base}/#/login?error=${encodeURIComponent(msg)}`)
      // Apple posts a form (response_mode=form_post), not JSON. handler.js leaves the body untouched for this path.
      let form
      try { form = await request.formData() } catch { return back('Apple sign-in failed. Please try again.') }
      if (form.get('error')) return back('Apple sign-in was cancelled.')
      const state = String(form.get('state') || '')
      const st = state && (await rowOf(db, 'SELECT expires_at FROM oauth_states WHERE state = ?', [state]))
      if (!st) return back('That sign-in link has expired. Please try again.')
      await db.execute({ sql: 'DELETE FROM oauth_states WHERE state = ?', args: [state] })

      const claims = await verifyIdToken(String(form.get('id_token') || ''), 'https://appleid.apple.com/auth/keys', env.APPLE_CLIENT_ID, [
        'https://appleid.apple.com',
      ])
      const user = await userForOauth(db, 'apple', claims.sub, claims.email, claims.email_verified === true || claims.email_verified === 'true', (u) => sendWelcome(env, u.email, base))
      return redirect(await handoff(db, request, env, user))
    }

    if (sub === 'exchange' && request.method === 'POST') {
      const code = String(body?.code || '')
      if (!code) throw new HttpError(400, 'Missing sign-in code.')
      const h = await rowOf(db, 'SELECT user_id, expires_at FROM oauth_handoffs WHERE code_hash = ?', [await sha256(code)])
      if (!h || h.expires_at < new Date().toISOString()) throw new HttpError(400, 'That sign-in has expired. Please try again.')
      await db.execute({ sql: 'DELETE FROM oauth_handoffs WHERE code_hash = ?', args: [await sha256(code)] })
      const u = await rowOf(db, 'SELECT id, email FROM users WHERE id = ?', [h.user_id])
      if (!u) throw new HttpError(400, 'That account no longer exists.')
      return session(u, env)
    }

    throw new HttpError(404, 'Not found')
  }

  // /api/auth/oauth/exchange is reached when what === 'oauth' (not google/apple above).
  if (what === 'oauth' && sub === 'exchange' && request.method === 'POST') {
    const code = String(body?.code || '')
    if (!code) throw new HttpError(400, 'Missing sign-in code.')
    const h = await rowOf(db, 'SELECT user_id, expires_at FROM oauth_handoffs WHERE code_hash = ?', [await sha256(code)])
    if (!h || h.expires_at < new Date().toISOString()) throw new HttpError(400, 'That sign-in has expired. Please try again.')
    await db.execute({ sql: 'DELETE FROM oauth_handoffs WHERE code_hash = ?', args: [await sha256(code)] })
    const u = await rowOf(db, 'SELECT id, email FROM users WHERE id = ?', [h.user_id])
    if (!u) throw new HttpError(400, 'That account no longer exists.')
    return session(u, env)
  }

  if (request.method !== 'POST') throw new HttpError(404, 'Not found')

  // ───────────── signup with an emailed code ─────────────
  if (what === 'signup' && sub === 'start') {
    const email = cleanEmail(body?.email)
    checkEmail(email)
    checkPassword(body?.password)
    // limit how many accounts one network address can create per hour
    const ipKey = 'signup:' + env.__ip
    const hourAgo = new Date(Date.now() - 3600000).toISOString()
    const made = await rowOf(db, 'SELECT COUNT(*) AS n FROM login_fails WHERE email = ? AND at > ?', [ipKey, hourAgo])
    if (Number(made?.n) >= MAX_SIGNUPS_PER_IP) throw new HttpError(429, 'Too many accounts created from this connection. Please try again later.')
    if (await rowOf(db, 'SELECT 1 AS ok FROM users WHERE email = ?', [email])) throw new HttpError(409, 'This email is already registered. Please sign in.')
    if (!mailReady(env)) throw new HttpError(503, 'Email is not set up on the server, so we cannot send your verification code. Ask the app admin.')
    await issueCode(db, env, email, 'signup', await hashPassword(body.password), 'Use this code to finish creating your StayManager account.')
    return { ok: true, email }
  }

  if (what === 'signup' && sub === 'verify') {
    const email = cleanEmail(body?.email)
    checkEmail(email)
    const row = await checkCode(db, email, 'signup', body?.code)
    if (await rowOf(db, 'SELECT 1 AS ok FROM users WHERE email = ?', [email])) throw new HttpError(409, 'This email is already registered. Please sign in.')
    if (!row.password_hash) throw new HttpError(400, 'Your sign-up expired. Please start again.')
    const user = { id: crypto.randomUUID(), email }
    await db.batch(
      [
        { sql: 'INSERT INTO users (id, email, password_hash) VALUES (?,?,?)', args: [user.id, user.email, row.password_hash] },
        { sql: 'INSERT INTO login_fails (email, at) VALUES (?,?)', args: ['signup:' + env.__ip, new Date().toISOString()] },
      ],
      'write'
    )
    await sendWelcome(env, user.email, siteBase(request, env))
    return session(user, env)
  }

  // ───────────── sign in ─────────────
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
      const oauthOnly = u && u.password_hash === NO_PASSWORD
      throw new HttpError(401, oauthOnly ? 'This account uses Google or Apple sign-in. Tap that button to sign in.' : 'Wrong email or password.')
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
    const ipKey = 'forgotip:' + env.__ip
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
      const base = siteBase(request, env)
      const link = `${base}/#/reset/${token}`
      try {
        const m = resetEmail({ env, link, minutes: RESET_MINUTES })
        await sendMail(env, u.email, m.subject, m.html, m.text)
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

  // ───────────── changing a password: current password, then an emailed code ─────────────
  // Step 1 checks the current password and emails a code. Step 2 needs that code AND the current
  // password again, so a stolen session token on its own can never change the password.
  if (what === 'password' && sub === 'start') {
    const user = await getUser(request, env)
    const u = await rowOf(db, 'SELECT password_hash FROM users WHERE id = ?', [user.id])
    if (!u) throw new HttpError(401, 'Session expired. Please sign in again.')
    if (u.password_hash === NO_PASSWORD) {
      throw new HttpError(400, 'This account signs in with Google or Apple and has no password to change.')
    }
    if (typeof body?.current_password !== 'string' || !(await verifyPassword(body.current_password, u.password_hash))) {
      throw new HttpError(401, 'Current password is incorrect.')
    }
    if (!mailReady(env)) throw new HttpError(503, 'Email is not set up on the server, so we cannot send your verification code.')
    await issueCode(db, env, user.email, 'password', null, 'Use this code to confirm your new StayManager password.')
    return { ok: true, email: user.email }
  }

  if (what === 'password' && sub === 'verify') {
    const user = await getUser(request, env)
    const u = await rowOf(db, 'SELECT password_hash FROM users WHERE id = ?', [user.id])
    if (!u) throw new HttpError(401, 'Session expired. Please sign in again.')
    if (typeof body?.current_password !== 'string' || !(await verifyPassword(body.current_password, u.password_hash))) {
      throw new HttpError(401, 'Current password is incorrect.')
    }
    checkPassword(body?.new_password)
    if (body.new_password === body.current_password) throw new HttpError(400, 'Choose a password different from the current one.')
    await checkCode(db, user.email, 'password', body?.code)
    await db.batch(
      [
        { sql: 'UPDATE users SET password_hash = ? WHERE id = ?', args: [await hashPassword(body.new_password), user.id] },
        { sql: 'DELETE FROM password_resets WHERE user_id = ?', args: [user.id] },
        { sql: 'DELETE FROM login_fails WHERE email = ?', args: [user.email] },
      ],
      'write'
    )
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
