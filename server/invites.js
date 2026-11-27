// Attender invitations: the owner enters the attender's name + email, the attender gets an email link,
// opens it (which proves the address is theirs), chooses their own password, and only then is added to the PG's staff list.
import { HttpError } from './errors.js'
import { sendMail, mailReady, siteBase, session, sha256, b64u, findLogin, createLogin } from './auth.js'
import { staffInviteEmail } from './emailTemplates.js'

const INVITE_DAYS = 7 // a link works for this long, once
const RESEND_SECONDS = 60 // the owner must wait this long before re-sending to the same address
const MAX_INVITES_PER_HOUR = 20 // invitations one owner can send per hour (stops misuse of the mail sender)
const MAX_STAFF = 30

let ready = false
export async function ensureInviteTable(db) {
  if (ready) return
  await db.batch(
    [
      `CREATE TABLE IF NOT EXISTS staff_invites (
         id TEXT PRIMARY KEY,
         token_hash TEXT NOT NULL UNIQUE,
         property_id TEXT NOT NULL,
         email TEXT NOT NULL,
         name TEXT NOT NULL DEFAULT '',
         invited_by TEXT NOT NULL,
         expires_at TEXT NOT NULL,
         created_at TEXT NOT NULL
       )`,
      'CREATE UNIQUE INDEX IF NOT EXISTS staff_invites_uniq ON staff_invites(property_id, email)',
    ],
    'write'
  )
  ready = true
}

const rowOf = async (db, sql, args = []) => {
  const r = await db.execute({ sql, args })
  return r.rows.length ? Object.fromEntries(r.columns.map((c, i) => [c, r.rows[0][i]])) : null
}

// Creates (or refreshes) the invitation and emails the link. Called from the owner's "Send invitation" button.
export async function sendStaffInvite({ db, env, request, ownerId, ownerEmail, property, email, name }) {
  await ensureInviteTable(db)
  if (!mailReady(env)) throw new HttpError(503, 'Email is not set up on the server, so we cannot send the invitation. Ask the app admin.')
  const now = new Date()
  const prior = await rowOf(db, 'SELECT created_at FROM staff_invites WHERE property_id = ? AND email = ?', [property.id, email])
  if (prior && now - new Date(prior.created_at) < RESEND_SECONDS * 1000) {
    throw new HttpError(429, 'An invitation was just sent. Please wait a minute before sending it again.')
  }
  const recent = await rowOf(db, 'SELECT COUNT(*) AS n FROM staff_invites WHERE invited_by = ? AND created_at > ?', [ownerId, new Date(now - 3600000).toISOString()])
  if (Number(recent?.n) >= MAX_INVITES_PER_HOUR) throw new HttpError(429, 'Too many invitations sent in the last hour. Please try again later.')

  const token = b64u.enc(crypto.getRandomValues(new Uint8Array(32)))
  await db.batch(
    [
      {
        sql: `INSERT INTO staff_invites (id, token_hash, property_id, email, name, invited_by, expires_at, created_at)
              VALUES (?,?,?,?,?,?,?,?)
              ON CONFLICT(property_id, email) DO UPDATE SET
                token_hash = excluded.token_hash, name = excluded.name, invited_by = excluded.invited_by,
                expires_at = excluded.expires_at, created_at = excluded.created_at`,
        args: [crypto.randomUUID(), await sha256(token), property.id, email, name || '', ownerId, new Date(now.getTime() + INVITE_DAYS * 86400000).toISOString(), now.toISOString()],
      },
      { sql: 'DELETE FROM staff_invites WHERE expires_at < ?', args: [now.toISOString()] },
    ],
    'write'
  )
  try {
    const m = staffInviteEmail({ env, ownerEmail, propertyName: property.name, name, link: `${siteBase(request, env)}/#/invite/${token}`, days: INVITE_DAYS })
    await sendMail(env, email, m.subject, m.html, m.text)
  } catch (e) {
    console.error('Invitation email failed:', e?.message || e)
    await db.execute({ sql: 'DELETE FROM staff_invites WHERE property_id = ? AND email = ?', args: [property.id, email] })
    throw new HttpError(502, 'We could not send the invitation email. Check the address and try again in a moment.')
  }
}

// Invitations still waiting for the attender, shaped like staff rows so the owner's list can show them as "Pending".
export async function listPendingInvites(db, propertyId) {
  await ensureInviteTable(db)
  const r = await db.execute({
    sql: 'SELECT id, email, name, created_at FROM staff_invites WHERE property_id = ? AND expires_at > ? ORDER BY created_at',
    args: [propertyId, new Date().toISOString()],
  })
  return r.rows.map((row) => {
    const o = Object.fromEntries(r.columns.map((c, i) => [c, row[i]]))
    return { id: 'inv-' + o.id, email: o.email, name: o.name, created_at: o.created_at, pending: true, property_id: propertyId }
  })
}
export async function invitePropertyId(db, id) {
  await ensureInviteTable(db)
  return (await rowOf(db, 'SELECT property_id FROM staff_invites WHERE id = ?', [id]))?.property_id || null
}
export async function deleteInvite(db, id) {
  await db.execute({ sql: 'DELETE FROM staff_invites WHERE id = ?', args: [id] })
}

// Public routes the invitation page uses (no login): POST /api/auth/invite/info and /api/auth/invite/accept
export async function inviteRoute({ request, db, env, segments, body }) {
  await ensureInviteTable(db)
  if (request.method !== 'POST') throw new HttpError(404, 'Not found')
  const sub = segments[2]
  const bad = () => new HttpError(400, 'This invitation link is invalid or has expired. Ask the owner to send you a new one.')
  const token = String(body?.token || '')
  if (!token || token.length > 100) throw bad()
  const inv = await rowOf(db, 'SELECT id, property_id, email, name, expires_at FROM staff_invites WHERE token_hash = ?', [await sha256(token)])
  if (!inv || inv.expires_at < new Date().toISOString()) throw bad()
  const prop = await rowOf(db, 'SELECT id, name FROM properties WHERE id = ?', [inv.property_id])
  if (!prop) {
    await deleteInvite(db, inv.id)
    throw bad()
  }
  const login = await findLogin(db, inv.email)
  const isOwner = login && (await rowOf(db, 'SELECT 1 AS ok FROM properties WHERE owner_id = ? LIMIT 1', [login.id]))
  const staffElsewhere = login && (await rowOf(db, 'SELECT 1 AS ok FROM property_staff WHERE lower(email) = ? LIMIT 1', [inv.email]))
  if (login && (isOwner || !staffElsewhere)) throw new HttpError(409, 'This email already has an account, so it cannot be used for an attender. Ask the owner to use a different email.')

  if (sub === 'info') return { email: inv.email, name: inv.name, property_name: prop.name, has_account: !!login }

  if (sub === 'accept') {
    const already = await rowOf(db, 'SELECT 1 AS ok FROM property_staff WHERE property_id = ? AND lower(email) = ?', [inv.property_id, inv.email])
    if (!already) {
      const have = Number((await rowOf(db, 'SELECT COUNT(*) AS n FROM property_staff WHERE property_id = ?', [inv.property_id])).n)
      if (have >= MAX_STAFF) throw new HttpError(400, 'This PG already has the maximum number of attenders.')
    }
    let user = login
    // New attender: the password they choose here is their own; the owner never sees it.
    if (!login) {
      const id = await createLogin(db, inv.email, body?.password)
      user = { id, email: inv.email }
    }
    if (!already) {
      await db.execute({ sql: 'INSERT INTO property_staff (id, property_id, email, name) VALUES (?,?,?,?)', args: [crypto.randomUUID(), inv.property_id, inv.email, inv.name || ''] })
    }
    await deleteInvite(db, inv.id)
    if (login) return { ok: true, signed_in: false, property_name: prop.name }
    return { ok: true, signed_in: true, property_name: prop.name, ...(await session(user, env)) }
  }
  throw new HttpError(404, 'Not found')
}
