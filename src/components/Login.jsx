import { useEffect, useState } from 'react'
import { getRememberedLogin, isSupabaseConfigured, setRememberedLogin, supabase } from '../lib/supabase'
import Icon from './Icon'

export default function Login({ auth }) {
  const [mode, setMode] = useState('signin')
  const saved = useState(() => getRememberedLogin())[0]
  const [email, setEmail] = useState(saved?.email || '')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })
  const [code, setCode] = useState('')
  const [codeFor, setCodeFor] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [cooldown, setCooldown] = useState(0)

  // The server sends failed Google/Apple sign-ins back here as /#/login?error=...
  useEffect(() => {
    const m = window.location.hash.match(/^#\/login\?error=(.*)$/)
    if (m) {
      try { setMsg({ type: 'err', text: decodeURIComponent(m[1]) }) } catch { /* ignore */ }
      history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  const switchMode = (m) => { setMode(m); setCode(''); setCodeFor(''); setMsg({ type: '', text: '' }) }

  const first = (saved?.email || '').split('@')[0].replace(/[._-]+/g, ' ').split(' ')[0]
  const name = first ? first.charAt(0).toUpperCase() + first.slice(1) : ''
  const hour = new Date().getHours()
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const welcome = mode === 'signin'
    ? (name ? `Welcome back, ${name}! 👋` : 'Welcome back! 👋')
    : mode === 'signup'
      ? (name ? `Welcome, ${name}! 🎉` : 'Welcome to StayManager! 🎉')
      : ''
  const welcomeSub = mode === 'signin'
    ? `${hello}. Sign in to pick up where you left off.`
    : mode === 'signup' ? 'Create your account in a few seconds.' : ''

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg({ type: '', text: '' })
    try {
      if (mode === 'forgot') {
        const { error } = await supabase.auth.resetPasswordForEmail(email)
        if (error) throw error
        setMsg({ type: 'ok', text: 'If this email has an account, we have sent a link to reset the password. It works for 1 hour. Check your spam folder too.' })
        return
      }
      if (mode === 'signin') {
        await auth.signIn(email, password, remember)
        setRememberedLogin(email.trim(), remember)
      } else {
        await sendCode()
      }
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Something went wrong' })
    } finally {
      setBusy(false)
    }
  }

  async function startOauth(provider) {
    setBusy(true)
    setMsg({ type: '', text: '' })
    try {
      // The server sends a 302 to Google / Apple, so just navigate there directly.
      window.location.href = `${(import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')}/api/auth/${provider}/start`
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Could not start sign-in.' })
    } finally {
      setBusy(false)
    }
  }

  // Step 1 of sign-up: email the 6-digit code, then show the code screen.
  async function sendCode() {
    const { error, needsCode } = await supabase.auth.signUp({ email: email.trim(), password })
    if (error) throw error
    if (needsCode) { setCodeFor(email.trim()); setCode(''); setCooldown(30) }
  }

  async function resend() {
    if (cooldown > 0 || busy) return
    setBusy(true)
    setMsg({ type: '', text: '' })
    try {
      await sendCode()
      setMsg({ type: 'ok', text: 'New code sent. Check your inbox and spam folder.' })
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Could not send a new code.' })
    } finally {
      setBusy(false)
    }
  }

  // Step 2: check the code. On success the session is saved and the app signs in.
  async function verifyCode(value = code) {
    if (busy || value.length !== 6) return
    setBusy(true)
    setMsg({ type: '', text: '' })
    const { error } = await supabase.auth.signUpVerify({ email: codeFor, code: value, remember })
    if (error) { setMsg({ type: 'err', text: error.message || 'That code is wrong or has expired.' }); setCode('') }
    else setRememberedLogin(codeFor, remember)
    setBusy(false)
  }

  const onCode = (v) => {
    const d = v.replace(/\D/g, '').slice(0, 6)
    setCode(d)
    if (d.length === 6) verifyCode(d)
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><Icon name="bed" size={30} /></div>
        <h1>StayManager</h1>
        {isSupabaseConfigured && welcome && !codeFor && (
          <div className="welcome-back"><strong>{welcome}</strong><span>{welcomeSub}</span></div>
        )}
        <p className="muted">Beds, complaints and AI calls for your PG in one place.</p>

        {isSupabaseConfigured ? (
          codeFor ? (
            <div className="login-form">
              <div className="notice ok" style={{ marginBottom: 0 }}>We sent a 6-digit code to <strong>{codeFor}</strong>. It expires in 10 minutes.</div>
              <label>Verification code
                <input className="code-input" type="text" inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} placeholder="000000" value={code} onChange={(e) => onCode(e.target.value)} aria-label="6-digit verification code" />
              </label>
              {msg.text && <div className={'notice ' + msg.type} style={{ marginBottom: 0 }}>{msg.text}</div>}
              <button type="button" className="btn primary block" disabled={busy} onClick={() => verifyCode()}>{busy ? 'Please wait…' : 'Verify and continue'}</button>
              <button type="button" className="link" disabled={cooldown > 0 || busy} onClick={resend}>{cooldown > 0 ? `Resend code in ${cooldown}s` : 'Send a new code'}</button>
              <button type="button" className="link" onClick={() => switchMode('signup')}>Use a different email</button>
            </div>
          ) : (
          <div className="login-form">
            {mode !== 'forgot' && (
              <>
                <button type="button" className="btn oauth-btn block" disabled={busy} onClick={() => startOauth('google')}><Icon name="google" size={18} /> Continue with Google</button>
                <div className="or-divider"><span>or use email</span></div>
              </>
            )}
            <form onSubmit={submit} className="login-form" style={{ marginTop: 0 }}>
              <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
              {mode !== 'forgot' && (
                <label>{mode === 'signup' ? 'Password (at least 8 characters)' : 'Password'}
                  <span className="pw-wrap">
                    <input type={showPw ? 'text' : 'password'} required minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} />
                    <button type="button" className="pw-toggle" onClick={() => setShowPw((v) => !v)}>{showPw ? 'Hide' : 'Show'}</button>
                  </span>
                </label>
              )}
              {mode !== 'forgot' && (
                <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Remember me <em>(stay signed in on this device)</em></span></label>
              )}
              {mode === 'forgot' && <p className="muted" style={{ margin: 0 }}>Enter the email you sign in with and we will email you a link to choose a new password. Attenders can also ask their owner to reset it.</p>}
              {msg.text && <div className={'notice ' + msg.type} style={{ marginBottom: 0 }}>{msg.text}</div>}
              <button className="btn primary block" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Email me a code'}</button>
              {mode === 'signin' && <button type="button" className="link" onClick={() => switchMode('forgot')}>Forgot password?</button>}
              <button type="button" className="link" onClick={() => switchMode(mode === 'signup' || mode === 'forgot' ? 'signin' : 'signup')}>
                {mode === 'signin' ? 'New here? Create an account' : mode === 'forgot' ? 'Back to sign in' : 'Already have an account? Sign in'}
              </button>
            </form>
          </div>
          )
        ) : (
          <div className="login-form">
            <div className="notice">Demo mode: data is saved in this browser only. Remove <code>VITE_DEMO_MODE=true</code> from <code>.env.local</code> to go live.</div>
            <button className="btn primary block" onClick={auth.demoLogin}>Open demo</button>
          </div>
        )}
      </div>
    </div>
  )
}
