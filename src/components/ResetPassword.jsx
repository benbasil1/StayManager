// Page the emailed "reset password" link opens (#/reset/<token>). Works for owners and attenders. No login needed.
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import Icon from './Icon'

export default function ResetPassword({ token }) {
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (password !== again) return setErr('The two passwords do not match.')
    setBusy(true)
    const { error } = await supabase.auth.resetPasswordWithToken(token, password)
    setBusy(false)
    if (error) return setErr(error.message || 'Could not reset the password.')
    setDone(true)
  }

  const goSignIn = () => { window.location.hash = ''; window.location.reload() }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><Icon name="bed" size={30} /></div>
        <h1>Choose a new password</h1>
        {done ? (
          <div className="login-form">
            <div className="notice ok">Your password has been changed. You can sign in with it now.</div>
            <button className="btn primary block" onClick={goSignIn}>Go to sign in</button>
          </div>
        ) : (
          <form onSubmit={submit} className="login-form">
            <label>New password (at least 8 characters)<input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
            <label>Type it again<input type="password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></label>
            {err && <div className="notice err">{err}</div>}
            <button className="btn primary block" disabled={busy}>{busy ? 'Please wait…' : 'Change password'}</button>
            <button type="button" className="link" onClick={goSignIn}>Back to sign in</button>
          </form>
        )}
      </div>
    </div>
  )
}
