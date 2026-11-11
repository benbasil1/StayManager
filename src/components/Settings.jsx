import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured } from '../lib/supabase'
import { usePrefs, setPref } from '../lib/prefs'
import QRCode from 'qrcode'
import { addStaff, getReportCode, loadStaff, removeStaff, resetReportCode, resetStaffPassword, sendFeedback } from '../lib/api'
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

function QrCard() {
  const { property, demo } = useData()
  const pid = property && property.id
  const [url, setUrl] = useState('')
  const [img, setImg] = useState('')
  const [msg, setMsg] = useState('')

  const make = useCallback(async (reset) => {
    if (!pid || demo) return
    setMsg('')
    try {
      const { code } = reset ? await resetReportCode(pid) : await getReportCode(pid)
      const base = (import.meta.env.VITE_PUBLIC_URL || window.location.origin).replace(/\/+$/, '')
      const link = `${base}/#/report/${code}`
      setUrl(link)
      setImg(await QRCode.toDataURL(link, { width: 640, margin: 2 }))
    } catch (e) { setMsg(e.message || 'Could not create the QR code') }
  }, [pid, demo])
  useEffect(() => { make(false) }, [make])

  if (demo) return <p className="muted">Demo mode has no QR code. Connect your server to use this.</p>

  function print() {
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(`<title>Complaint QR</title><body style="font-family:sans-serif;text-align:center;padding:40px"><h1 style="margin:0">${(property.name || '').replace(/</g, '&lt;')}</h1><h2>Scan to report a problem</h2><img src="${img}" style="width:380px;height:380px"><p>Open your phone camera and point it at this code.<br>No app needed.</p></body>`)
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <>
      <p className="muted">Stick this QR in the PG. Tenants scan it, enter their phone number and room number, and describe the problem. It is matched to their profile and appears in Complaints for you and your attenders.</p>
      {img && <img src={img} alt="Complaint QR code" style={{ width: 220, height: 220, borderRadius: 12, background: '#fff' }} />}
      {msg && <div className="notice err">{msg}</div>}
      <div className="status-row">
        <button type="button" className="btn primary" onClick={print} disabled={!img}>Print QR</button>
        <button type="button" className="btn ghost" onClick={() => { if (window.confirm('Make a new QR? The old printed QR will stop working.')) make(true) }}>New QR code</button>
      </div>
      {url && <p className="muted" style={{ wordBreak: 'break-all' }}>{url}</p>}
    </>
  )
}

function GroupCard() {
  const { property, demo, tenantRows, setGroupLink, welcomeLink, markInvited } = useData()
  const saved = (property && property.wa_group_link) || ''
  const [link, setLink] = useState(saved)
  const [msg, setMsg] = useState({ type: '', text: '' })
  useEffect(() => { setLink(saved) }, [saved, property && property.id])

  const pending = saved ? tenantRows.filter((r) => !r.tenant.wa_invited_at) : []

  async function save(e) {
    e.preventDefault()
    setMsg({ type: '', text: '' })
    try {
      await setGroupLink(link)
      setMsg({ type: 'ok', text: link.trim() ? 'Saved.' : 'Group link removed.' })
    } catch (err) { setMsg({ type: 'err', text: err.message || 'Could not save' }) }
  }

  return (
    <>
      <p className="muted">
        Create one WhatsApp group for {property ? property.name : 'this PG'} (you are the admin automatically, and you can let only admins send messages).
        In the group tap the name, then <strong>Invite via link</strong>, copy the link and paste it here. Then every tenant gets a one-tap welcome message with this link.
      </p>
      <form className="login-form" style={{ marginTop: 0 }} onSubmit={save}>
        <label>Group invite link<input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://chat.whatsapp.com/…" autoComplete="off" /></label>
        {msg.text && <div className={'notice ' + msg.type} style={{ marginBottom: 0 }}>{msg.text}</div>}
        <button className="btn primary" disabled={link.trim() === saved}>Save link</button>
      </form>
      {saved && (
        <>
          <h4>{pending.length ? `Not invited yet (${pending.length})` : 'Everyone has been invited'}</h4>
          <div className="list-plain">
            {pending.map((r) => (
              <div key={r.tenant.id} className="set-row pg-row">
                <div><strong>{r.tenant.name}</strong><p className="muted">Room {r.room.room_no} • {r.bed.label}</p></div>
                <a className="btn ghost sm" href={welcomeLink(r)} target="_blank" rel="noreferrer" onClick={() => markInvited(r.tenant.id)}>Send invite</a>
              </div>
            ))}
          </div>
          <p className="muted">When you mark a tenant as moved out, the app reminds you to remove them from the group.</p>
        </>
      )}
      {demo && <p className="muted">Demo mode: the link is saved in this browser only.</p>}
    </>
  )
}

function StaffManager() {
  const { property, demo } = useData()
  const pid = property && property.id
  const [list, setList] = useState([])
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
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
    if (!em.includes('@') || password.length < 8 || busy) return
    setBusy(true)
    setMsg({ type: '', text: '' })
    try {
      await addStaff({ property_id: pid, email: em, name: name.trim(), password })
      setEmail(''); setName(''); setPassword('')
      await refresh()
      setMsg({ type: 'ok', text: 'Attender created. Give them this email and password: they sign in on the normal login screen.' })
    } catch (err) {
      setMsg({ type: 'err', text: err.code === '23505' ? 'This email is already added.' : err.message || 'Could not add' })
    } finally {
      setBusy(false)
    }
  }

  async function resetPw(s) {
    const pw = window.prompt(`New password for ${s.name || s.email} (at least 8 characters)`)
    if (!pw) return
    try { await resetStaffPassword(s.id, pw); setMsg({ type: 'ok', text: 'Password changed. Tell the attender the new password.' }) } catch (err) { setMsg({ type: 'err', text: err.message || 'Could not change the password' }) }
  }

  async function remove(s) {
    if (!window.confirm(`Remove ${s.name || s.email}? They will lose access.`)) return
    try { await removeStaff(s.id); await refresh() } catch (err) { setMsg({ type: 'err', text: err.message || 'Could not remove' }) }
  }

  return (
    <>
      <p className="muted">Attenders get their own login and see only the Complaints and Calls tabs for {property ? property.name : 'this PG'}, with Call and WhatsApp buttons. No rent, payments or ID proofs. They can change a complaint's status and you see it right away.</p>
      <div className="list-plain">
        {list.map((s) => (
          <div key={s.id} className="set-row pg-row">
            <div><strong>{s.name || s.email}</strong>{s.name && <p className="muted">{s.email}</p>}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn ghost sm" onClick={() => resetPw(s)}>New password</button>
              <button type="button" className="icon-btn danger" aria-label={`Remove ${s.email}`} onClick={() => remove(s)}><Icon name="trash" size={16} /></button>
            </div>
          </div>
        ))}
        {list.length === 0 && <p className="muted">No attenders yet.</p>}
      </div>
      <form className="login-form" style={{ marginTop: 0 }} onSubmit={add}>
        <label>Attender name (optional)<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Raju" /></label>
        <label>Attender email (their login)<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="attender@gmail.com" autoComplete="off" /></label>
        <label>Password (at least 8 characters)<input type="text" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Choose a password for them" autoComplete="off" /></label>
        {msg.text && <div className={'notice ' + msg.type} style={{ marginBottom: 0 }}>{msg.text}</div>}
        <button className="btn primary" disabled={busy || !email.includes('@') || password.length < 8}><Icon name="plus" size={18} /> {busy ? 'Creating…' : 'Create attender login'}</button>
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
        <h3>Complaint QR code</h3>
        <QrCard />
      </section>

      <section className="card set-card">
        <h3>PG WhatsApp group</h3>
        <GroupCard />
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
