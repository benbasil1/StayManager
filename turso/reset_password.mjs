// Reset someone's password by hand (there is no "forgot password" email yet).
//   TURSO_URL=libsql://... TURSO_TOKEN=... node turso/reset_password.mjs user@example.com NewPassword123
import { createClient } from '@libsql/client'
import { hashPassword } from '../server/auth.js'

const [email, password] = process.argv.slice(2)
if (!email || !password || password.length < 8) {
  console.error('Usage: node turso/reset_password.mjs <email> <new password, 8+ characters>')
  process.exit(1)
}
const db = createClient({ url: process.env.TURSO_URL, authToken: process.env.TURSO_TOKEN })
const r = await db.execute({ sql: 'UPDATE users SET password_hash = ? WHERE email = ?', args: [await hashPassword(password), email.trim().toLowerCase()] })
console.log(r.rowsAffected ? 'Password updated.' : 'No user with that email.')
