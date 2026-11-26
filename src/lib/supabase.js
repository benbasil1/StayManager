// Login for StayManager, stored in Turso through /api/auth/*  (replaces the Supabase client).
// The file keeps the old name and the same shape ("supabase.auth.signInWithPassword" etc.)
// so the rest of the app does not need to change.
const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')
const KEY = 'stay_session'

// Demo mode (data kept in the browser only) now has to be asked for: set VITE_DEMO_MODE=true in .env.local
export const isSupabaseConfigured = import.meta.env.VITE_DEMO_MODE !== 'true'

const listeners = new Set()
// "Remember me" ON  -> session kept in localStorage (stays signed in after closing the browser).
// "Remember me" OFF -> session kept in sessionStorage (ends when the tab/browser is closed).
const readFrom = (store) => {
  try {
    const s = JSON.parse(store.getItem(KEY) || 'null')
    if (s?.access_token && s.expires_at > Date.now() / 1000) return s
  } catch { /* ignore */ }
  return null
}
const read = () => readFrom(window.localStorage) || readFrom(window.sessionStorage)
const write = (s, remember = true) => {
  try {
    localStorage.removeItem(KEY)
    sessionStorage.removeItem(KEY)
    if (s) (remember ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(s))
  } catch { /* ignore */ }
}
// Remembered login details (email only, never the password) for the "Welcome back" greeting.
const LAST = 'stay_last_login'
export const getRememberedLogin = () => {
  try { return JSON.parse(localStorage.getItem(LAST) || 'null') } catch { return null }
}
export const setRememberedLogin = (email, remember) => {
  try { remember && email ? localStorage.setItem(LAST, JSON.stringify({ email, remember: true })) : localStorage.removeItem(LAST) } catch { /* ignore */ }
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
  async signInWithPassword({ email, password, remember = true }) {
    const { payload, error } = await post('signin', { email, password })
    if (error) return { data: { user: null, session: null }, error }
    write(payload, remember)
    emit('SIGNED_IN', payload)
    return { data: { user: payload.user, session: payload }, error: null }
  },

  // Sign-up is two steps now: this emails a 6-digit code, and signUpVerify creates the account.
  async signUp({ email, password }) {
    const { error } = await post('signup/start', { email, password })
    if (error) return { data: { user: null, session: null }, error }
    return { data: { user: null, session: null }, error: null, needsCode: true }
  },
  // Checks the code and, if it matches, creates the account and signs in.
  async signUpVerify({ email, code, remember = true }) {
    const { payload, error } = await post('signup/verify', { email, code })
    if (error) return { data: { user: null, session: null }, error }
    write(payload, remember)
    emit('SIGNED_IN', payload)
    return { data: { user: payload.user, session: payload }, error: null }
  },

  async signOut() {
    write(null)
    emit('SIGNED_OUT', null)
    return { error: null }
  },

  // Changing a password is two steps too: check the current password and email a code,
  // then supply that code plus the new password.
  async startPasswordChange({ current_password }) {
    const s = read()
    if (!s) return { error: new Error('Not signed in') }
    const { error } = await post('password/start', { current_password }, s.access_token)
    return { error: error || null }
  },
  async finishPasswordChange({ current_password, new_password, code }) {
    const s = read()
    if (!s) return { error: new Error('Not signed in') }
    const { error } = await post('password/verify', { current_password, new_password, code }, s.access_token)
    if (error) return { error }
    emit('USER_UPDATED', s)
    return { error: null }
  },
  // Kept for compatibility: one call that does only the "check current password" half.
  async updateUser({ password, current_password }) {
    const s = read()
    if (!s) return { data: { user: null }, error: new Error('Not signed in') }
    if (!password) return { data: { user: s.user }, error: null }
    const { error } = await post('password', { new_password: password, current_password }, s.access_token)
    if (error) return { data: { user: null }, error }
    emit('USER_UPDATED', s)
    return { data: { user: s.user }, error: null }
  },

  // Emails a one-time reset link (owner and attender use the same screen).
  async resetPasswordForEmail(email) {
    const { error } = await post('forgot', { email })
    return { data: error ? null : {}, error: error || null }
  },
  // Used by the page the reset link opens.
  async resetPasswordWithToken(token, password) {
    const { error } = await post('reset', { token, password })
    return { error: error || null }
  },
  // Last step of Google / Apple sign-in: trade the single-use code for a session.
  async exchangeOauthCode(code, remember = true) {
    const { payload, error } = await post('oauth/exchange', { code })
    if (error) return { data: { user: null, session: null }, error }
    write(payload, remember)
    emit('SIGNED_IN', payload)
    return { data: { user: payload.user, session: payload }, error: null }
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
