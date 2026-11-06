// Login for StayManager, stored in Turso through /api/auth/*  (replaces the Supabase client).
// The file keeps the old name and the same shape ("supabase.auth.signInWithPassword" etc.)
// so the rest of the app does not need to change.
const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
const KEY = 'stay_session'

// Demo mode (data kept in the browser only) now has to be asked for: set VITE_DEMO_MODE=true in .env.local
export const isSupabaseConfigured = import.meta.env.VITE_DEMO_MODE !== 'true'

const listeners = new Set()
const read = () => {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (s?.access_token && s.expires_at > Date.now() / 1000) return s
  } catch { /* ignore */ }
  return null
}
const write = (s) => {
  try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY) } catch { /* ignore */ }
}
const emit = (event, s) => listeners.forEach((cb) => { try { cb(event, s) } catch { /* ignore */ } })
if (typeof window !== 'undefined') {
  // keep other tabs in step
  window.addEventListener('storage', (e) => { if (e.key === KEY) emit(e.newValue ? 'SIGNED_IN' : 'SIGNED_OUT', read()) })
}

async function post(path, body, token) {
  let res
  try {
    res = await fetch(`${BASE}/api/auth/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
    })
  } catch {
    return { error: new Error('Could not reach the server. Check your internet connection.') }
  }
  let payload = null
  try { payload = await res.json() } catch { /* empty */ }
  if (!res.ok) return { error: Object.assign(new Error(payload?.error || `Request failed (${res.status})`), { status: res.status }) }
  return { payload }
}

const auth = {
  async getSession() {
    return { data: { session: read() }, error: null }
  },
  async getUser() {
    const s = read()
    return { data: { user: s?.user || null }, error: null }
  },
  onAuthStateChange(cb) {
    listeners.add(cb)
    setTimeout(() => cb('INITIAL_SESSION', read()), 0)
    return { data: { subscription: { unsubscribe: () => listeners.delete(cb) } } }
  },
  async signInWithPassword({ email, password }) {
    const { payload, error } = await post('signin', { email, password })
    if (error) return { data: { user: null, session: null }, error }
    write(payload)
    emit('SIGNED_IN', payload)
    return { data: { user: payload.user, session: payload }, error: null }
  },
  async signUp({ email, password }) {
    const { payload, error } = await post('signup', { email, password })
    if (error) return { data: { user: null, session: null }, error }
    write(payload) // signed in straight away (no email confirmation step)
    emit('SIGNED_IN', payload)
    return { data: { user: payload.user, session: payload }, error: null }
  },
  async signOut() {
    write(null)
    emit('SIGNED_OUT', null)
    return { error: null }
  },
  async updateUser({ password, current_password }) {
    const s = read()
    if (!s) return { data: { user: null }, error: new Error('Not signed in') }
    if (!password) return { data: { user: s.user }, error: null }
    const { error } = await post('password', { new_password: password, current_password }, s.access_token)
    if (error) return { data: { user: null }, error }
    emit('USER_UPDATED', s)
    return { data: { user: s.user }, error: null }
  },
  async resetPasswordForEmail() {
    return { data: null, error: new Error('Password reset by email is not available yet. Ask the app owner to reset it.') }
  },
}

// Files that were uploaded to Supabase Storage earlier can no longer be opened from here.
const storage = {
  from: () => ({
    createSignedUrl: async () => ({ data: null, error: new Error('This older file was stored in Supabase and is no longer available.') }),
    remove: async () => ({ data: null, error: null }),
  }),
}

export const supabase = { auth, storage }
