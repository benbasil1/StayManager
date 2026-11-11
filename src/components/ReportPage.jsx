// Public page a tenant sees after scanning the PG's QR code. No login.
import { useEffect, useState } from 'react'
import { reportInfo, sendReport } from '../lib/api'
import Icon from './Icon'

export default function ReportPage({ code }) {
  const [info, setInfo] = useState(null)
  const [loadErr, setLoadErr] = useState('')
  const [f, setF] = useState({ name: '', phone: '', room: '', category: 'Maintenance', message: '', website: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    reportInfo(code).then(setInfo).catch((e) => setLoadErr(e.message || 'This link is not valid.'))
  }, [code])

  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))

  async function submit(e) {
    e.preventDefault()
    setBusy(true)
    setErr('')
    try {
      await sendReport(code, f)
      setDone(true)
      setF((x) => ({ ...x, message: '' }))
    } catch (ex) {
      setErr(ex.message || 'Could not send. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo"><Icon name="bed" size={30} /></div>
        <h1>{info ? info.name : 'Report a problem'}</h1>
        {loadErr && <div className="notice err">{loadErr}</div>}
        {info && done && (
          <div className="login-form">
            <div className="notice ok">Thank you. Your complaint has been sent to the PG team. They will contact you on your phone number.</div>
            <button className="btn primary block" onClick={() => setDone(false)}>Report another problem</button>
          </div>
        )}
        {info && !done && (
          <form className="login-form" onSubmit={submit}>
            <p className="muted">Tell us what is wrong. The PG team will call you back.</p>
            <label>Your phone number<input type="tel" inputMode="numeric" required value={f.phone} onChange={set('phone')} placeholder="The number you gave the PG" autoComplete="tel" /></label>
            <label>Room number<input required value={f.room} onChange={set('room')} placeholder="e.g. 203" /></label>
            <label>Your name (optional)<input value={f.name} onChange={set('name')} autoComplete="name" /></label>
            <label>Type of problem
              <select value={f.category} onChange={set('category')}>
                {info.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label>What is the problem?<textarea required rows={4} value={f.message} onChange={set('message')} placeholder="e.g. No hot water since morning" style={{ font: 'inherit' }} /></label>
            {/* hidden trap for bots */}
            <input name="website" value={f.website} onChange={set('website')} tabIndex={-1} autoComplete="off" aria-hidden="true" style={{ position: 'absolute', left: '-9999px', height: 0, width: 0, opacity: 0 }} />
            {err && <div className="notice err">{err}</div>}
            <button className="btn primary block" disabled={busy}>{busy ? 'Sending…' : 'Send complaint'}</button>
          </form>
        )}
      </div>
    </div>
  )
}
