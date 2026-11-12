import { useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import Icon from './Icon'

export default function Login({ auth }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })

  const switchMode = (m) => { setMode(m); setMsg({ type: '', text: '' }) }

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
        await auth.signIn(email, password)
      } else {
        const { needsConfirmation } = await auth.signUp(email, password)
        if (needsConfirmation) setMsg({ type: 'ok', text: 'Check your email to confirm your account, then sign in.' })
      }
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Something went wrong' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><Icon name="bed" size={30} /></div>
        <h1>StayManager</h1>
        <p className="muted">Beds, complaints and AI calls for your PG in one place.</p>

        {isSupabaseConfigured ? (
          <form onSubmit={submit} className="login-form">
            <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} /></label>
            {mode !== 'forgot' && (
              <label>{mode === 'signup' ? 'Password (at least 8 characters)' : 'Password'}<input type="password" required minLength={mode === 'signup' ? 8 : undefined} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
            )}
            {mode === 'forgot' && <p className="muted" style={{ margin: 0 }}>Enter the email you sign in with and we will email you a link to choose a new password. Attenders can also ask their owner to reset it.</p>}
            {msg.text && <div className={'notice ' + msg.type}>{msg.text}</div>}
            <button className="btn primary block" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : mode === 'forgot' ? 'Send reset link' : 'Create account'}</button>
            {mode === 'signin' && <button type="button" className="link" onClick={() => switchMode('forgot')}>Forgot password?</button>}
            <button type="button" className="link" onClick={() => switchMode(mode === 'signup' || mode === 'forgot' ? 'signin' : 'signup')}>
              {mode === 'signin' ? 'New here? Create an account' : mode === 'forgot' ? 'Back to sign in' : 'Already have an account? Sign in'}
            </button>
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
