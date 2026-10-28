import { useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabase'
import Icon from './Icon'

export default function Login({ auth }) {
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setMsg({ type: '', text: '' })
    try {
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
            <label>Email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></label>
            <label>Password<input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} /></label>
            {msg.text && <div className={'notice ' + msg.type}>{msg.text}</div>}
            <button className="btn primary block" disabled={busy}>{busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}</button>
            <button type="button" className="link" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
              {mode === 'signin' ? 'New here? Create an account' : 'Already have an account? Sign in'}
            </button>
          </form>
        ) : (
          <div className="login-form">
            <div className="notice">Demo mode: data is saved in this browser only. Add your Supabase keys in <code>.env.local</code> to go live.</div>
            <button className="btn primary block" onClick={auth.demoLogin}>Open demo</button>
          </div>
        )}
      </div>
    </div>
  )
}
