import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabase'
import { usePrefs, setPref } from '../lib/prefs'
import { addStaff, loadStaff, removeStaff, sendFeedback } from '../lib/api'
import { useData } from '../lib/store'
import { alertsPref, browserAlertsSupported, setAlertsPref } from '../lib/notify'
import Icon from './Icon'

const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Auto']]
const SIZES = [['sm', 'Small'], ['md', 'Default'], ['lg', 'Large'], ['xl', 'Extra large']]

function Seg({ value, options, onChange, label }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([id, text]) => (
        <button key={id} type="button" className={value === id ? 'active' : ''} aria-pressed={value === id} onClick={() => onChange(id)}>{text}</button>
      ))}
    </div>
  )
}

function PasswordForm({ auth }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })

  async function submit(e) {
    e.preventDefault()
    setMsg({ type: '', text: '' })
    if (next.length < 6) return setMsg({ type: 'err', text: 'New password must be at least 6 characters.' })
    if (next !== again) return setMsg({ type: 'err', text: 'The two new passwords do not match.' })
    if (next === current) return setMsg({ type: 'err', text: 'Choose a password different from the current one.' })
    setBusy(true)
    try {
      await auth.changePassword(current, next)
      setCurrent(''); setNext(''); setAgain('')
      setMsg({ type: 'ok', text: 'Password updated.' })
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Could not change the password.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login-form" style={{ marginTop: 0 }} onSubmit={submit}>
      <label>Current password<input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
      <label>New password<input type="password" required minLength={6} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
      <label>Confirm new password<input type="password" required minLength={6} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></label>
      {msg.text && <div className={'notice ' + msg.type} style={{ marginBottom: 0 }}>{msg.text}</div>}
      <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
    </form>
  )
}

function AlertsCard() {
  const [on, setOn] = useState(alertsPref())
  const [perm, setPerm] = useState(browserAlertsSupported() ? Notification.permission : 'unsupported')
  const toggle = (v) => { setAlertsPref(v); setOn(v) }
  const ask = async () => { try { setPerm(await Notification.requestPermission()) } catch { /* ignore */ } }
  return (
    <>
      <p className="muted">You get a pop-up and a red count on Inbox when your AI voice agent logs a new call, complaint or request.</p>
      <Seg label="Alerts" value={on ? 'on' : 'off'} options={[['on', 'Alerts on'], ['off', 'Alerts off']]} onChange={(v) => toggle(v === 'on')} />
      {perm === 'unsupported' && <p className="muted">This browser cannot show system notifications.</p>}
      {perm === 'default' && <button className="btn ghost" onClick={ask}>Also show system notifications</button>}
      {perm === 'granted' && <p className="muted">System notifications are on. They appear when this app is open in a background tab or window.</p>}
      {perm === 'denied' && <p className="muted">System notifications are blocked in your browser settings for this site.</p>}
      <p className="muted">Alerts only arrive while the app is open. Alerts when it is fully closed would need a push service, which is not set up.</p>
    </>
  )
}

const KINDS = [['idea', 'Idea'], ['bug', 'Problem'], ['praise', 'Praise'], ['other', 'Other']]
const FEEDBACK_EMAIL = import.meta.env.VITE_FEEDBACK_EMAIL || ''

function FeedbackForm({ auth }) {
  const [kind, setKind] = useState('idea')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })
  const mailto = FEEDBACK_EMAIL
    ? `mailto:${FEEDBACK_EMAIL}?subject=${encodeURIComponent('StayManager feedback: ' + kind)}&body=${encodeURIComponent(message)}`
    : ''

  async function submit(e) {
    e.preventDefault()
    setMsg({ type: '', text: '' })
    const text = message.trim()
    if (text.length < 3) return setMsg({ type: 'err', text: 'Please write a few words first.' })
    if (!isSupabaseConfigured) {
      if (mailto) window.location.href = mailto
      else setMsg({ type: 'err', text: 'Demo mode cannot send feedback. Connect Supabase to use this.' })
      return
    }
    setBusy(true)
    try {
      await sendFeedback({ kind, message: text, email: auth.session.email })
      setMessage('')
      setMsg({ type: 'ok', text: 'Thank you! Your feedback was sent to the author.' })
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Could not send feedback.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login-form" style={{ marginTop: 0 }} onSubmit={submit}>
      <Seg label="Feedback type" value={kind} options={KINDS} onChange={setKind} />
      <label>Your message
        <textarea className="textarea" rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Tell the author what to fix or add…" />
      </label>
      {msg.text && <div className={'notice ' + msg.type} style={{ marginBottom: 0 }}>{msg.text}</div>}
      <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send feedback'}</button>
    </form>
  )
}

function MyPgs() {
  const data = useData()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  async function add(e) {
    e.preventDefault()
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    try { await data.addProperty(n); setName('') } finally { setBusy(false) }
  }

  return (
    <>
      <div className="list-plain">
        {data.properties.map((p) => (
          <div key={p.id} className="set-row pg-row">
            <strong>{p.name}</strong>
            {p.id === data.propertyId
              ? <span className="tag">Current</span>
              : <button type="button" className="btn ghost sm" onClick={() => data.selectProperty(p.id)}>Switch</button>}
          </div>
        ))}
      </div>
      <form className="login-form" style={{ marginTop: 0 }} onSubmit={add}>
        <label>Add another PG<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sunrise Girls PG" /></label>
        <button className="btn primary" disabled={busy || !name.trim()}><Icon name="plus" size={18} /> {busy ? 'Adding…' : 'Add PG'}</button>
      </form>
      <p className="muted">Each PG has its own rooms, tenants, complaints and calls. Switch between them here or from the name at the top of the page.</p>
    </>
  )
}

function StaffManager() {
  const { property, demo } = useData()
  const pid = property && property.id
  const [list, setList] = useState([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })

  const refresh = useCallback(async () => {
    if (!pid || demo) return
    try { setList(await loadStaff(pid)) } catch (e) { setMsg({ type: 'err', text: e.message || 'Could not load attenders' }) }
  }, [pid, demo])
  useEffect(() => { refresh() }, [refresh])

  if (demo) return <p className="muted">Demo mode has no logins. Connect Supabase to add attenders.</p>

  async function add(e) {
    e.preventDefault()
    const em = email.trim().toLowerCase()
    if (!em.includes('@') || busy) return
    setBusy(true)
    setMsg({ type: '', text: '' })
    try {
      await addStaff({ property_id: pid, email: em, name: name.trim() })
      setEmail(''); setName('')
      await refresh()
      setMsg({ type: 'ok', text: 'Added. They can now sign in with this email (first time: tap "Create an account").' })
    } catch (err) {
      setMsg({ type: 'err', text: err.code === '23505' ? 'This email is already added.' : err.message || 'Could not add' })
    } finally {
      setBusy(false)
    }
  }

  async function remove(s) {
    if (!window.confirm(`Remove ${s.name || s.email}? They will lose access.`)) return
    try { await removeStaff(s.id); await refresh() } catch (err) { setMsg({ type: 'err', text: err.message || 'Could not remove' }) }
  }

  return (
    <>
      <p className="muted">Attenders see only complaints and tenant phone numbers for {property ? property.name : 'this PG'}. No rent, payments or ID proofs. They can change a complaint's status and you see it right away.</p>
      <div className="list-plain">
        {list.map((s) => (
          <div key={s.id} className="set-row pg-row">
            <div><strong>{s.name || s.email}</strong>{s.name && <p className="muted">{s.email}</p>}</div>
            <button type="button" className="icon-btn danger" aria-label={`Remove ${s.email}`} onClick={() => remove(s)}><Icon name="trash" size={16} /></button>
          </div>
        ))}
        {list.length === 0 && <p className="muted">No attenders yet.</p>}
      </div>
      <form className="login-form" style={{ marginTop: 0 }} onSubmit={add}>
        <label>Attender name (optional)<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Raju" /></label>
        <label>Attender email<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="attender@gmail.com" autoComplete="off" /></label>
        {msg.text && <div className={'notice ' + msg.type} style={{ marginBottom: 0 }}>{msg.text}</div>}
        <button className="btn primary" disabled={busy || !email.includes('@')}><Icon name="plus" size={18} /> {busy ? 'Adding…' : 'Add attender'}</button>
      </form>
    </>
  )
}

export default function Settings({ auth }) {
  const prefs = usePrefs()
  return (
    <div className="settings">
      <h2 className="page-title">Settings</h2>

      <section className="card set-card">
        <h3>Account</h3>
        <div className="set-row">
          <div><p className="muted">Signed in as</p><strong>{auth.session.email}</strong></div>
        </div>
        <button className="btn ghost" onClick={auth.signOut}><Icon name="switch" size={18} /> Switch account</button>
        <p className="muted">Signs you out so you can sign in with a different email.</p>
      </section>

      <section className="card set-card">
        <h3>My PGs</h3>
        <MyPgs />
      </section>

      <section className="card set-card">
        <h3>Attenders (staff)</h3>
        <StaffManager />
      </section>

      <section className="card set-card">
        <h3>Notifications</h3>
        <AlertsCard />
      </section>

      <section className="card set-card">
        <h3>Appearance</h3>
        <p className="muted">Theme</p>
        <Seg label="Theme" value={prefs.theme} options={THEMES} onChange={(v) => setPref('theme', v)} />
        <p className="muted">Text size</p>
        <Seg label="Text size" value={prefs.size} options={SIZES} onChange={(v) => setPref('size', v)} />
        <div className="size-preview">The quick brown fox: Room 204, Bed 2, rent ₹6,500 due on the 5th.</div>
      </section>

      <section className="card set-card">
        <h3>Change password</h3>
        {isSupabaseConfigured ? <PasswordForm auth={auth} /> : <p className="muted">Demo mode has no password. Connect Supabase to use this.</p>}
      </section>

      <section className="card set-card">
        <h3>Feedback for the author</h3>
        <FeedbackForm auth={auth} />
      </section>

      <section className="card set-card">
        <h3>Sign out</h3>
        <button className="btn danger-ghost" onClick={auth.signOut}><Icon name="logout" size={18} /> Sign out</button>
      </section>
    </div>
  )
}
