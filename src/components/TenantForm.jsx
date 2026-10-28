import { useRef, useState } from 'react'
import Icon from './Icon'
import { todayStr } from '../lib/utils'

const ID_TYPES = ['Aadhaar', 'PAN', 'Driving licence', 'Voter ID', 'Passport', 'College / Company ID']

// Used both to add a new tenant to a bed and to edit an existing one.
export default function TenantForm({ title, initial, defaultRent, onSave, onClose }) {
  const [f, setF] = useState({
    name: initial?.name || '',
    phone: initial?.phone || '',
    whatsapp: initial?.whatsapp && initial.whatsapp !== initial.phone ? initial.whatsapp : '',
    email: initial?.email || '',
    rent_amount: initial?.rent_amount ?? defaultRent ?? 0,
    deposit: initial?.deposit ?? 0,
    move_in: initial?.move_in || todayStr(),
    due_day: initial?.due_day || 5,
    notes: initial?.notes || '',
    id_type: initial?.id_type || '',
    id_last4: initial?.id_last4 || '',
    leaving_on: initial?.leaving_on || '',
  })
  const [files, setFiles] = useState([])
  const fileRef = useRef(null)
  const [err, setErr] = useState('')
  const set = (k) => (e) => setF((p) => ({ ...p, [k]: e.target.value }))

  const submit = (e) => {
    e.preventDefault()
    if (!f.name.trim()) return setErr('Enter the tenant name.')
    if (f.phone.replace(/\D/g, '').length < 10) return setErr('Enter a valid 10-digit phone number.')
    const due = Math.min(28, Math.max(1, parseInt(f.due_day, 10) || 5))
    onSave({
      name: f.name.trim(),
      phone: f.phone.trim(),
      whatsapp: (f.whatsapp || f.phone).trim(),
      email: f.email.trim(),
      rent_amount: Math.max(0, parseInt(f.rent_amount, 10) || 0),
      deposit: Math.max(0, parseInt(f.deposit, 10) || 0),
      move_in: f.move_in || todayStr(),
      due_day: due,
      notes: f.notes.trim(),
      id_type: f.id_type,
      id_last4: f.id_last4.replace(/\D/g, '').slice(-4),
      ...(f.leaving_on || initial?.leaving_on ? { leaving_on: f.leaving_on || null } : {}),
    }, files)
    onClose()
  }

  return (
    <div className="modal-back top" onClick={onClose}>
      <form className="modal tall" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="panel-head">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </div>
        <label>Full name<input autoFocus value={f.name} onChange={set('name')} placeholder="e.g. Rohit Verma" /></label>
        <div className="two">
          <label>Phone<input type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} placeholder="98450 12345" /></label>
          <label>WhatsApp<input type="tel" inputMode="tel" value={f.whatsapp} onChange={set('whatsapp')} placeholder="Same as phone" /></label>
        </div>
        <label>Email (optional)<input type="email" value={f.email} onChange={set('email')} /></label>
        <div className="two">
          <label>Rent per month (₹)<input type="number" min="0" value={f.rent_amount} onChange={set('rent_amount')} /></label>
          <label>Security deposit (₹)<input type="number" min="0" value={f.deposit} onChange={set('deposit')} /></label>
        </div>
        <div className="two">
          <label>Move-in date<input type="date" value={f.move_in} onChange={set('move_in')} /></label>
          <label>Rent due on day<input type="number" min="1" max="28" value={f.due_day} onChange={set('due_day')} /></label>
        </div>
        <div className="two">
          <label>ID type
            <select value={f.id_type} onChange={set('id_type')}>
              <option value="">Select…</option>
              {ID_TYPES.map((t) => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label>Last 4 digits of ID<input inputMode="numeric" maxLength={4} value={f.id_last4} onChange={set('id_last4')} placeholder="1234" /></label>
        </div>
        {!initial && (
          <div className="id-pick">
            <div className="set-row">
              <strong>ID proof (photo or PDF)</strong>
              <button type="button" className="btn ghost sm" onClick={() => fileRef.current.click()}><Icon name="plus" size={16} /> Add</button>
            </div>
            <input
              ref={fileRef} type="file" accept="image/*,application/pdf" multiple hidden
              onChange={(e) => { const picked = Array.from(e.target.files || []); e.target.value = ''; setFiles((p) => [...p, ...picked].slice(0, 4)) }}
            />
            {files.length === 0 && <p className="muted">Optional. On a phone you can take the photo with the camera. Saved privately with the tenant.</p>}
            {files.map((file, i) => (
              <div className="id-row" key={file.name + i}>
                <span className="clamp1">{file.name}</span>
                <button type="button" className="icon-btn danger" aria-label="Remove file" onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>
              </div>
            ))}
          </div>
        )}
        {initial && <p className="muted">Add or view ID photos from the tenant's details screen.</p>}
        <label>Leaving on (if the tenant has given notice)<input type="date" value={f.leaving_on} min={f.move_in} onChange={set('leaving_on')} /></label>
        <label>Notes (work place, emergency contact, etc.)<input value={f.notes} onChange={set('notes')} /></label>
        {err && <div className="notice err">{err}</div>}
        <button className="btn primary block">{initial ? 'Save changes' : 'Add tenant'}</button>
      </form>
    </div>
  )
}
