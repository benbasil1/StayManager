// Page the emailed attender invitation opens (#/invite/<token>). No login needed.
// Opening the link proves the attender owns the email address; here they choose their own password.
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import Icon from './Icon'

export default function AcceptInvite({ token }) {
  const [info, setInfo] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('') // '' | 'signed-in' | 'existing'

  useEffect(() => {
    let live = true
    supabase.auth.inviteInfo(token).then(({ data, error }) => {
      if (!live) return
      if (error) setLoadErr(error.message || 'This invitation link is not valid.')
      else setInfo(data)
    })
    return () => { live = false }
  }, [token])

  const goApp = () => { window.location.hash = ''; window.location.reload() }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!info.has_account) {
      if (password.length < 8) return setErr('Password must be at least 8 characters.')
      if (password !== again) return setErr('The two passwords do not match.')
    }
    setBusy(true)
    const { data, error } = await supabase.auth.acceptInvite({ token, password })
    setBusy(false)
    if (error) return setErr(error.message || 'Could not accept the invitation.')
    setDone(data.signed_in ? 'signed-in' : 'existing')
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><Icon name="bed" size={30} /></div>
        {loadErr ? (
          <div className="login-form">
            <h1>Invitation not valid</h1>
            <div className="notice err">{loadErr}</div>
            <button className="btn primary block" onClick={goApp}>Go to sign in</button>
          </div>
        ) : !info ? (
          <h1>Checking your invitation…</h1>
        ) : done ? (
          <div className="login-form">
            <h1>You are in</h1>
            <div className="notice ok">
              Your email is verified and you have been added to {info.property_name}.
              {done === 'existing' ? ' Sign in with your existing password.' : ''}
            </div>
            <button className="btn primary block" onClick={goApp}>{done === 'signed-in' ? 'Open StayManager' : 'Go to sign in'}</button>
          </div>
        ) : (
          <form onSubmit={submit} className="login-form">
            <h1>Join {info.property_name}</h1>
            <p className="muted">You have been invited as an attender (staff). {info.has_account ? 'Confirm below to be added.' : 'Choose your own password to finish.'}</p>
            <label>Your email<input type="email" value={info.email} readOnly /></label>
            {!info.has_account && (
              <>
                <label>Create a password (at least 8 characters)<input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" /></label>
                <label>Type it again<input type="password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></label>
              </>
            )}
            {err && <div className="notice err">{err}</div>}
            <button className="btn primary block" disabled={busy}>{busy ? 'Please wait…' : info.has_account ? 'Accept invitation' : 'Verify and create my login'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
