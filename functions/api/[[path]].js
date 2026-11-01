// Cloudflare Pages Function: every request to /api/... lands here.
// Secrets (set in Cloudflare > Pages > Settings > Variables and Secrets):
//   TURSO_URL, TURSO_TOKEN (secret), VOICE_API_KEY (secret, only if the voice agent writes data)
//   Supabase login check reuses VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (or SUPABASE_URL / SUPABASE_ANON_KEY)
import { createClient } from '@libsql/client/web'
import { handle, getSupabaseUser } from '../../server/handler.js'

export async function onRequest({ request, env }) {
  if (!env.TURSO_URL || !env.TURSO_TOKEN) {
    return new Response(JSON.stringify({ error: 'Server is missing TURSO_URL or TURSO_TOKEN' }), {
      status: 500,
      headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
    })
  }
  const db = createClient({ url: env.TURSO_URL, authToken: env.TURSO_TOKEN })
  return handle({ request, db, env, getUser: getSupabaseUser })
}
