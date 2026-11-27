import { useEffect, useState } from 'react'
import { getRememberedLogin, isSupabaseConfigured, setRememberedLogin, supabase } from '../lib/supabase'
import Icon from './Icon'

export default function Login({ auth }) {
  const [mode, setMode] = useState('signin')
  const saved = useState(() => getRememberedLogin())[0]
  const [email, setEmail] = useState(saved?.email || '')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [remember, setRemember] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })
  const [awaitCode, setAwaitCode] = useState('')

  // The server sends failed Google/Apple sign-ins back here as /#/login?error=...
  useEffect(() => {
    const m = window.location.hash.match(/^#\/login\?error=(.*)$/)
    if (m) {
      try { setMsg({ type: 'err', text: decodeURIComponent(m[1]) }) } catch { /* ignore */ }
      history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  const switchMode = (m) => { setMode(m); setConfirm(''); setAwaitCode(''); setMsg({ type: '', text: '' }) }

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
      if (mode === 'signup' && password !== confirm) {
        setMsg({ type: 'err', text: 'Passwords do not match. Please type the same password in both boxes.' })
        return
      }
      if (mode === 'signin') {
        await auth.signIn(email, password, remember)
        setRememberedLogin(email.trim(), remember)
      } else {
        const { needsConfirmation } = await auth.signUp(email, password, remember)
        setRememberedLogin(email.trim(), remember)
        if (needsConfirmation) setMsg({ type: 'ok', text: 'Check your email to confirm your account, then sign in.' })
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

  async function sendCode() {
    setBusy(true)
    setMsg({ type: '', text: '' })
    try {
      const { error, needsCode } = await auth.signUp(email, password)
      if (error) throw error
      if (needsCode) setAwaitCode(email)
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Could not start sign-up.' })
    } finally {
      setBusy(false)
    }
  }

  async function verifyCode() {
    setBusy(true)
    setMsg({ type: '', text: '' })
    try {
      await supabase.auth.signUpVerify({ email: awaitCode, code: confirm })
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Code did not match. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><Icon name="bed" size={30} /></div>
        <h1>StayManager</h1>
        {isSupabaseConfigured && welcome && (
          <div className="welcome-back"><strong>{welcome}</strong><span>{welcomeSub}</span></div>
        )}
        <p className="muted">Beds, complaints and AI calls for your PG in one place.</p>

        {isSupabaseConfigured ? (
          <form onSubmit={submit} className="login-form">
            {mode === 'signup' && awaitCode === email && (
              <>
                <label>Code sent to {email}<input type="text" required minLength={6} maxLength={6} pattern="[0-9]{6}" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="one-time-code" placeholder="123456" /></label>
                <p className="muted" style={{ margin: '2px 0' }}>Enter the 6-digit code we just emailed you. It expires in 10 minutes.</p>
                {msg.text && <div className={'notice ' + msg.type}>{msg.text}</div>}
                <button className="btn primary block" disabled={busy} onClick={verifyCode}>{busy ? 'Please wait…' : 'Verify code'}</button>
                <button type="button" className="link block" onClick={() => switchMode('signin')}>Back to password sign-up</button>
              </>
            )}
            {mode !== 'signup' || awaitCode === '' ? (
              <>
                <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
                {mode !== 'forgot' && (
                  <label>{mode === 'signup' ? 'Password (at least 8 characters)' : 'Password'}<input type="password" required minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
                )}
                {mode === 'signup' && (
                  <label>Confirm password<input type="password" required minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" aria-invalid={confirm && confirm !== password ? 'true' : undefined} />
                    {confirm && confirm !== password && <small className="pw-mismatch">Passwords do not match</small>}
                    {confirm && confirm === password && <small className="pw-match">Passwords match ✓</small>}
                  </label>
                )}
                {mode !== 'forgot' && (
                  <label className="remember"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /><span>Remember me <em>(stay signed in on this device)</em></span></label>
                )}
                {mode === 'forgot' && <p className="muted" style={{ margin: 0 }}>Enter the email you sign in with and we will email you a link to choose a new password. Attenders can also ask their owner to reset it.</p>}
                {msg.text && <div className={'notice ' + msg.type}>{msg.text}</div>}
                <button className="btn primary block" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Send code'}</button>
                <div className="oauth">
                  <p className="muted" style={{ margin: '4px 0 0', textAlign: 'center', fontSize: '.85rem' }}>Or continue with</p>
                  <button type="button" className="btn oauth-btn block" disabled={busy} onClick={() => startOauth('google')}><Icon name="google" size={18} /> Continue with Google</button>
                </div>
                {mode === 'signin' && <button type="button" className="link" onClick={() => switchMode('forgot')}>Forgot password?</button>}
                <button type="button" className="link" onClick={() => switchMode(mode === 'signup' || mode === 'forgot' ? 'signin' : 'signup')}>
                  {mode === 'signin' ? 'New here? Create an account' : mode === 'forgot' ? 'Back to sign in' : 'Already have an account? Sign in'}
                </button>
              </>
            ) : null}
          </form>
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
