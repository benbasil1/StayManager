import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { usePrefs, setPref } from '../lib/prefs'
import QRCode from 'qrcode'
import { addStaff, getReportCode, loadStaff, removeStaff, resetReportCode, sendFeedback, setPropertyPhones } from '../lib/api'
import { posterHtml } from '../lib/poster'
import { useData } from '../lib/store'
import { alertsPref, browserAlertsSupported, setAlertsPref } from '../lib/notify'
import Icon from './Icon'
import { SectionHead } from './InfoTip'

// Button that locks for a while after it is used, with the countdown shown inside it.
// The unlock time is kept in localStorage, so refreshing the page does not bypass it.
function CooldownButton({ id, secs = 60, onSend, children }) {
  const key = 'sm_cd_' + id
  const readLeft = () => {
    try { return Math.max(0, Math.ceil((Number(localStorage.getItem(key)) - Date.now()) / 1000)) } catch { return 0 }
  }
  const [left, setLeft] = useState(readLeft)
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft(readLeft()), 1000)
    return () => clearTimeout(t)
  }, [left]) // eslint-disable-line react-hooks/exhaustive-deps
  const click = () => {
    if (left > 0) return
    try { localStorage.setItem(key, String(Date.now() + secs * 1000)) } catch { /* ignore */ }
    setLeft(secs)
    onSend()
  }
  const locked = left > 0
  return (
    <button type="button" className={'btn ghost sm cd-btn' + (locked ? ' locked' : '')} onClick={click} aria-disabled={locked}
      aria-label={locked ? `${children}. Available again in ${left} seconds` : undefined}>
      {locked && <span className="cd-fill" style={{ width: `${(left / secs) * 100}%` }} />}
      <span className="cd-label">{locked ? <><Icon name="check" size={14} /> Sent · {left}s</> : children}</span>
    </button>
  )
}

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

// Two-step change password: the server emails a code first, then you supply that code
// with your current password and the new one.
function PasswordForm({ auth }) {
  const [step, setStep] = useState('check') // 'check' | 'code' | 'done'
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })

  async function start(e) {
    e.preventDefault()
    setMsg({ type: '', text: '' })
    if (!current) return setMsg({ type: 'err', text: 'Enter your current password.' })
    setBusy(true)
    try {
      const { error } = await auth.startPasswordChange({ current_password: current })
      if (error) throw error
      setStep('code')
      setMsg({ type: 'ok', text: 'A code has been emailed to your account. Enter it below.' })
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Could not send the code.' })
    } finally {
      setBusy(false)
    }
  }

  async function finish(e) {
    e.preventDefault()
    setMsg({ type: '', text: '' })
    if (next.length < 8) return setMsg({ type: 'err', text: 'New password must be at least 8 characters.' })
    if (next !== again) return setMsg({ type: 'err', text: 'The two new passwords do not match.' })
    if (next === current) return setMsg({ type: 'err', text: 'Choose a password different from the current one.' })
    if (!/^\d{6}$/.test(code)) return setMsg({ type: 'err', text: 'Enter the 6-digit code from the email.' })
    setBusy(true)
    try {
      const { error } = await auth.finishPasswordChange({ current_password: current, new_password: next, code })
      if (error) throw error
      setCurrent(''); setNext(''); setAgain(''); setCode('')
      setStep('done')
      setMsg({ type: 'ok', text: 'Password updated.' })
    } catch (err) {
      setMsg({ type: 'err', text: err.message || 'Could not change the password.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="login-form" style={{ marginTop: 0 }} onSubmit={step === 'code' ? finish : start}>
      {step === 'check' ? (
        <>
          <label>Current password<input type="password" required value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
          {msg.text && <div className={'notice ' + msg.type} style={{ marginBottom: 0 }}>{msg.text}</div>}
          <button className="btn primary" disabled={busy}>{busy ? 'Sending…' : 'Send code to my email'}</button>
        </>
      ) : step === 'done' ? (
        <div className="notice ok">Password updated.</div>
      ) : (
        <>
          <label>Code from your email<input type="text" required minLength={6} maxLength={6} pattern="[0-9]{6}" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" placeholder="123456" /></label>
          <label>New password<input type="password" required minLength={8} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
          <label>Confirm new password<input type="password" required minLength={8} value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" /></label>
          {msg.text && <div className={'notice ' + msg.type} style={{ marginBottom: 0 }}>{msg.text}</div>}
          <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
          <button type="button" className="link" onClick={() => setStep('check')}>Cancel</button>
        </>
      )}
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
      <SectionHead
        title="Notifications"
        info={(
          <>
            <p className="muted">You get a pop-up and a red count on Inbox when your AI voice agent logs a new call, complaint or request.</p>
            <p className="muted">Alerts only arrive while the app is open. Alerts when it is fully closed would need a push service, which is not set up.</p>
          </>
        )}
      />
      <Seg label="Alerts" value={on ? 'on' : 'off'} options={[['on', 'Alerts on'], ['off', 'Alerts off']]} onChange={(v) => toggle(v === 'on')} />
      {perm === 'unsupported' && <p className="muted">This browser cannot show system notifications.</p>}
      {perm === 'default' && <button className="btn ghost" onClick={ask}>Also show system notifications</button>}
      {perm === 'granted' && <p className="muted">System notifications are on. They appear when this app is open in a background tab or window.</p>}
      {perm === 'denied' && <p className="muted">System notifications are blocked in your browser settings for this site.</p>}
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
      else setMsg({ type: 'err', text: 'Demo mode cannot send feedback. Sign in to a live account to use this.' })
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
      <SectionHead
        title="My PGs"
        info={<p className="muted">Each PG has its own rooms, tenants, complaints and calls. Switch between them here or from the name at the top of the page.</p>}
      />
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
    </>
  )
}

function ContactCard() {
  const { property, demo, reload } = useData()
  const pid = property && property.id
  const savedOwner = (property && property.owner_phone) || ''
  const savedAttender = (property && property.attender_phone) || ''
  const [owner, setOwner] = useState(savedOwner)
  const [attender, setAttender] = useState(savedAttender)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })
  useEffect(() => { setOwner(savedOwner); setAttender(savedAttender) }, [savedOwner, savedAttender, pid])
  useEffect(() => { setMsg({ type: '', text: '' }) }, [pid])

  const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10)
  const unchanged = digits(owner) === digits(savedOwner) && digits(attender) === digits(savedAttender)

  async function save(e) {
    e.preventDefault()
    setMsg({ type: '', text: '' })
    setBusy(true)
    try {
      await setPropertyPhones(pid, owner, attender)
      await reload(true)
      setMsg({ type: 'ok', text: 'Saved. These numbers will print on your QR poster.' })
    } catch (err) { setMsg({ type: 'err', text: err.message || 'Could not save' }) }
    setBusy(false)
  }

  return (
    <>
      <SectionHead
        title="Contact numbers (for the QR poster)"
        info={<p className="muted">These two numbers are printed on the QR poster under “Urgent? Call us directly”, so tenants can phone you or your attender. Leave a box empty to leave that number off the poster.</p>}
      />
      {demo ? (
        <p className="muted">Demo mode cannot save numbers. Connect your server to use this.</p>
      ) : (
        <form className="login-form" style={{ marginTop: 0 }} onSubmit={save}>
          <label>Owner number<input type="tel" inputMode="numeric" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="10-digit mobile number" autoComplete="off" /></label>
          <label>Attender number<input type="tel" inputMode="numeric" value={attender} onChange={(e) => setAttender(e.target.value)} placeholder="10-digit mobile number" autoComplete="off" /></label>
          {msg.text && <div className={'notice ' + msg.type} style={{ marginBottom: 0 }}>{msg.text}</div>}
          <button className="btn primary" disabled={busy || unchanged}>{busy ? 'Saving…' : 'Save numbers'}</button>
        </form>
      )}
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

  if (demo) {
    return (
      <>
        <SectionHead title="Complaint QR code" />
        <p className="muted">Demo mode has no QR code. Connect your server to use this.</p>
      </>
    )
  }

  function print() {
    const w = window.open('', '_blank')
    if (!w) { setMsg('Your browser blocked the print window. Allow pop-ups for this site and try again.'); return }
    w.document.write(posterHtml({ name: property.name, qrImage: img, link: url, ownerPhone: property.owner_phone, attenderPhone: property.attenderPhone }))
    w.document.close() // the poster prints itself once its fonts have loaded
  }

  return (
    <>
      <SectionHead
        title="Complaint QR code"
        info={<p className="muted">Stick this QR in the PG. Tenants scan it, enter their phone number and room number, and describe the problem. It is matched to their profile and appears in Complaints for you and your attenders.</p>}
      />
      {img && <img src={img} alt="Complaint QR code" style={{ width: 220, height: 220, borderRadius: 12, background: '#fff' }} />}
      {msg && <div className="notice err">{msg}</div>}
      <div className="status-row">
        <button type="button" className="btn primary" onClick={print} disabled={!img}>Print QR</button>
        <button type="button" className="btn ghost" onClick={() => { if (window.confirm('Make a new QR? The old printed QR will stop working.')) make(true) }}>New QR code</button>
      </div>
      {!(property.owner_phone || property.attender_phone) && <p className="muted">Tip: add the owner and attender numbers in the card above so people can call you directly from the poster.</p>}
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
      <SectionHead
        title="PG WhatsApp group"
        info={(
          <>
            <p className="muted">
              Create one WhatsApp group for {property ? property.name : 'this PG'} (you are the admin automatically, and you can let only admins send messages).
              In the group tap the name, then <strong>Invite via link</strong>, copy the link and paste it here. Then every tenant gets a one-tap welcome message with this link.
            </p>
            <p className="muted">When you mark a tenant as moved out, the app reminds you to remove them from the group.</p>
          </>
        )}
      />
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
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState({ type: '', text: '' })

  const refresh = useCallback(async () => {
    if (!pid || demo) return
    try { setList(await loadStaff(pid)) } catch (e) { setMsg({ type: 'err', text: e.message || 'Could not load attenders' }) }
  }, [pid, demo])
  useEffect(() => { refresh() }, [refresh])

  if (demo) {
    return (
      <>
        <SectionHead title="Attenders (staff)" />
        <p className="muted">Demo mode has no logins. Connect Supabase to add attenders.</p>
      </>
    )
  }

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
      setMsg({ type: 'ok', text: `Invitation sent to ${em}. They will appear in the list as soon as they verify their email and create their password.` })
    } catch (err) {
      setMsg({ type: 'err', text: err.code === '23505' ? 'This email is already added.' : err.message || 'Could not send the invitation' })
    } finally {
      setBusy(false)
    }
  }

  async function resend(s) {
    setMsg({ type: '', text: '' })
    try {
      await addStaff({ property_id: pid, email: s.email, name: s.name || '' })
      setMsg({ type: 'ok', text: `Invitation sent again to ${s.email}.` })
    } catch (err) { setMsg({ type: 'err', text: err.message || 'Could not send the invitation' }) }
  }

  // Attenders choose their own password, so "new password" now emails them a reset link instead of the owner typing one.
  async function sendReset(s) {
    const { error } = await supabase.auth.resetPasswordForEmail(s.email)
    setMsg(error ? { type: 'err', text: error.message || 'Could not send the reset link' } : { type: 'ok', text: `A password reset link was emailed to ${s.email}.` })
  }

  async function remove(s) {
    if (!window.confirm(s.pending ? `Cancel the invitation to ${s.email}?` : `Remove ${s.name || s.email}? They will lose access.`)) return
    try { await removeStaff(s.id); await refresh() } catch (err) { setMsg({ type: 'err', text: err.message || 'Could not remove' }) }
  }

  return (
    <>
      <SectionHead
        title="Attenders (staff)"
        info={<p className="muted">You invite an attender by email. They verify their email, choose their own password, and then get their own login. They see only the Complaints and Calls tabs for {property ? property.name : 'this PG'}, with Call and WhatsApp buttons. No rent, payments or ID proofs. They can change a complaint's status and you see it right away.</p>}
      />
      <div className="list-plain">
        {list.map((s) => (
          <div key={s.id} className="set-row pg-row">
            <div><strong>{s.name || s.email}</strong>{s.name && <p className="muted">{s.email}</p>}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              {s.pending
                ? <><span className="tag">Pending</span><CooldownButton id={`invite_${s.id}`} onSend={() => resend(s)}>Resend</CooldownButton></>
                : <CooldownButton id={`reset_${s.id}`} onSend={() => sendReset(s)}>Send reset link</CooldownButton>}
              <button type="button" className="icon-btn danger" aria-label={`${s.pending ? 'Cancel invitation for' : 'Remove'} ${s.email}`} onClick={() => remove(s)}><Icon name="trash" size={16} /></button>
            </div>
          </div>
        ))}
        {list.length === 0 && <p className="muted">No attenders yet.</p>}
      </div>
      <form className="login-form" style={{ marginTop: 0 }} onSubmit={add}>
        <label>Attender name (optional)<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Raju" /></label>
        <label>Attender email (their login)<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="attender@gmail.com" autoComplete="off" /></label>
        <p className="muted" style={{ margin: 0 }}>We email them a link to verify their email and choose their own password. They are added to the list once they do.</p>
        {msg.text && <div className={'notice ' + msg.type} style={{ marginBottom: 0 }}>{msg.text}</div>}
        <button className="btn primary" disabled={busy || !email.includes('@')}><Icon name="plus" size={18} /> {busy ? 'Sending…' : 'Send invitation'}</button>
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
        <SectionHead title="Account" info={<p className="muted">Signs you out so you can sign in with a different email.</p>} />
        <div className="set-row">
          <div><p className="muted">Signed in as</p><strong>{auth.session.email}</strong></div>
        </div>
        <button className="btn ghost" onClick={auth.signOut}><Icon name="switch" size={18} /> Switch account</button>
      </section>

      <section className="card set-card">
        <MyPgs />
      </section>

      <section className="card set-card">
        <StaffManager />
      </section>

      <section className="card set-card">
        <ContactCard />
      </section>

      <section className="card set-card">
        <QrCard />
      </section>

      <section className="card set-card">
        <GroupCard />
      </section>

      <section className="card set-card">
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
