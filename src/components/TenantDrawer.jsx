import { useRef, useState } from 'react'
import Icon from './Icon'
import TenantForm from './TenantForm'
import IdProof from './IdProof'
import { useData } from '../lib/store'
import { getIdDocUrl, isPdf } from '../lib/idDocs'
import { daysUntil, fmtDay, fmtMonth, leavingText, rentStatusLabel, rupees, todayStr, waLink } from '../lib/utils'

function PaymentForm({ row, onSave, onCancel }) {
  const [proof, setProof] = useState(null)
  const proofRef = useRef(null)
  const { summary, tenant } = row
  const [amount, setAmount] = useState(summary.due > 0 ? summary.due : tenant.rent_amount)
  const [paidOn, setPaidOn] = useState(todayStr())
  const [forMonth, setForMonth] = useState((summary.dueDate || todayStr()).slice(0, 7))
  const [method, setMethod] = useState('UPI')
  const [note, setNote] = useState('')

  const submit = (e) => {
    e.preventDefault()
    const n = parseInt(amount, 10)
    if (!n || n <= 0) return
    onSave({ amount: n, paid_on: paidOn, for_month: forMonth, method, note: note.trim() }, proof)
  }

  return (
    <form className="pay-form" onSubmit={submit}>
      <div className="two">
        <label>Amount (₹)<input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></label>
        <label>Paid on<input type="date" value={paidOn} max={todayStr()} onChange={(e) => setPaidOn(e.target.value)} /></label>
      </div>
      <div className="two">
        <label>For month<input type="month" value={forMonth} onChange={(e) => setForMonth(e.target.value)} /></label>
        <label>Method
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {['UPI', 'Cash', 'Bank transfer', 'Card', 'Cheque'].map((m) => <option key={m}>{m}</option>)}
          </select>
        </label>
      </div>
      <label>Note (optional)<input value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="id-pick">
        <div className="set-row">
          <strong>Payment screenshot</strong>
          <button type="button" className="btn ghost sm" onClick={() => proofRef.current.click()}><Icon name="plus" size={16} /> {proof ? 'Change' : 'Add'}</button>
        </div>
        <input ref={proofRef} type="file" accept="image/*,application/pdf" hidden onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f) setProof(f) }} />
        {!proof && <p className="muted">Optional. Keep the UPI or bank screenshot as a receipt for later.</p>}
        {proof && (
          <div className="id-row">
            <span className="clamp1">{proof.name}</span>
            <button type="button" className="icon-btn danger" aria-label="Remove screenshot" onClick={() => setProof(null)}><Icon name="x" size={16} /></button>
          </div>
        )}
      </div>
      <div className="two">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary">Save payment</button>
      </div>
    </form>
  )
}

export default function TenantDrawer({ row, onClose }) {
  const { property, paymentsFor, recordPayment, deletePayment, setPaymentProof, updateTenant, vacateTenant } = useData()
  const [view, setView] = useState(null)
  const [proofMsg, setProofMsg] = useState('')
  const proofFileRef = useRef(null)
  const proofTarget = useRef(null)

  async function openProof(p) {
    setProofMsg('')
    try {
      const url = await getIdDocUrl(p.proof_path)
      if (isPdf(p.proof_path)) window.open(url, '_blank', 'noopener')
      else setView({ url, title: `Payment screenshot • ${fmtDay(p.paid_on)}` })
    } catch (err) {
      setProofMsg(err.message || 'Could not open the screenshot')
    }
  }
  const [showPay, setShowPay] = useState(false)
  const [editing, setEditing] = useState(false)
  const { tenant, room, bed, summary } = row
  const history = paymentsFor(tenant.id)

  const reminder =
    `Hi ${tenant.name.split(' ')[0]}, a gentle reminder from ${property?.name || 'your PG'}: ` +
    `your rent of ${rupees(summary.due)} is pending` +
    (summary.dueDate ? ` (due ${fmtDay(summary.dueDate)})` : '') +
    '. Please pay at the earliest. Thank you!'

  return (
    <div className="drawer-back" onClick={onClose}>
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${tenant.name} details`}>
        <div className="t-head">
          <span className="avatar">{tenant.name.charAt(0).toUpperCase()}</span>
          <div className="t-title">
            <h3>{tenant.name}</h3>
            <p className="muted">Room {room.room_no} • {bed.label} • since {fmtDay(tenant.move_in)}</p>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={20} /></button>
        </div>

        <div className={'status-banner ' + summary.status}>
          <div>
            <strong>{rentStatusLabel[summary.status]}</strong>
            <span>
              {summary.status === 'paid'
                ? 'All rent received'
                : `${rupees(summary.due)} pending${summary.unpaidMonths > 1 ? ` (${summary.unpaidMonths} months)` : ''} • ${summary.status === 'overdue' ? 'was due' : 'due'} ${fmtDay(summary.dueDate)}`}
            </span>
          </div>
          <span className="badge">{rentStatusLabel[summary.status]}</span>
        </div>

        <section className={'leave-box' + (tenant.leaving_on && daysUntil(tenant.leaving_on) < 0 ? ' past' : '')}>
          <div className="set-row">
            <div>
              <strong>{tenant.leaving_on ? `Bed free from ${fmtDay(tenant.leaving_on)}` : 'Leaving date'}</strong>
              <p className="muted">
                {tenant.leaving_on
                  ? `${tenant.name.split(' ')[0]} is ${leavingText(tenant.leaving_on)}.${daysUntil(tenant.leaving_on) < 0 ? ' Mark the bed vacant when they have left.' : ''}`
                  : 'Set it when the tenant gives notice (or let your AI voice agent set it).'}
              </p>
            </div>
          </div>
          <div className="leave-controls">
            <input type="date" aria-label="Leaving date" value={tenant.leaving_on || ''} min={tenant.move_in} onChange={(e) => updateTenant(tenant.id, { leaving_on: e.target.value || null })} />
            {tenant.leaving_on && <button className="btn ghost sm" onClick={() => updateTenant(tenant.id, { leaving_on: null })}>Clear</button>}
          </div>
        </section>

        <div className="actions">
          <a className="act" href={`tel:${tenant.phone}`}><Icon name="phone" size={18} /> Call</a>
          <a className="act wa" href={waLink(tenant.whatsapp || tenant.phone)} target="_blank" rel="noreferrer">WhatsApp</a>
          {summary.due > 0 && (
            <a className="act wa" href={waLink(tenant.whatsapp || tenant.phone, reminder)} target="_blank" rel="noreferrer">Send reminder</a>
          )}
        </div>

        <section className="t-section">
          <h4>Rent</h4>
          <dl className="kv">
            <div><dt>Monthly rent</dt><dd>{rupees(tenant.rent_amount)}</dd></div>
            <div><dt>Due now</dt><dd className={summary.due > 0 ? 'bad' : ''}>{rupees(summary.due)}</dd></div>
            <div><dt>Total paid</dt><dd>{rupees(summary.paid)}</dd></div>
            <div><dt>Rent due on</dt><dd>Day {tenant.due_day} of month</dd></div>
            <div><dt>Security deposit</dt><dd>{rupees(tenant.deposit)}</dd></div>
            <div><dt>Move-in</dt><dd>{fmtDay(tenant.move_in)}</dd></div>
          </dl>
        </section>

        <section className="t-section">
          <h4>Contact</h4>
          <dl className="kv one">
            <div><dt>Phone</dt><dd>{tenant.phone}</dd></div>
            <div><dt>WhatsApp</dt><dd>{tenant.whatsapp || tenant.phone}</dd></div>
            {tenant.email && <div><dt>Email</dt><dd>{tenant.email}</dd></div>}
            {tenant.notes && <div><dt>Notes</dt><dd>{tenant.notes}</dd></div>}
          </dl>
        </section>

        <IdProof tenant={tenant} />

        <section className="t-section">
          <div className="panel-head">
            <h4>Payment history</h4>
            {!showPay && <button className="btn primary sm" onClick={() => setShowPay(true)}><Icon name="plus" size={16} /> Record payment</button>}
          </div>
          {showPay && (
            <PaymentForm
              row={row}
              onCancel={() => setShowPay(false)}
              onSave={(form, file) => { recordPayment(tenant.id, form, file); setShowPay(false) }}
            />
          )}
          <input
            ref={proofFileRef} type="file" accept="image/*,application/pdf" hidden
            onChange={(e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; if (f && proofTarget.current) setPaymentProof(proofTarget.current, f) }}
          />
          {proofMsg && <div className="notice err">{proofMsg}</div>}
          {history.length === 0 && <p className="muted">No payments recorded yet.</p>}
          {history.map((p) => (
            <div className="pay-row" key={p.id}>
              <div>
                <strong>{rupees(p.amount)}</strong>
                <span className="muted"> for {fmtMonth(p.for_month)}</span>
                <p className="meta">{fmtDay(p.paid_on)} • {p.method}{p.note ? ` • ${p.note}` : ''}</p>
                {p.proof_path
                  ? <button className="link-sm" onClick={() => openProof(p)}>View screenshot</button>
                  : <button className="link-sm" onClick={() => { proofTarget.current = p; proofFileRef.current.click() }}>Add screenshot</button>}
              </div>
              <button
                className="icon-btn danger"
                aria-label="Delete payment"
                onClick={() => window.confirm('Delete this payment record?') && deletePayment(p.id)}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
        </section>

        <div className="t-foot">
          <button className="btn ghost" onClick={() => setEditing(true)}><Icon name="pencil" size={16} /> Edit details</button>
          <button
            className="btn danger-ghost"
            onClick={() => {
              if (window.confirm(`Mark ${bed.label} as vacant? ${tenant.name} will be moved out (payment history is kept).`)) {
                vacateTenant(tenant)
                onClose()
              }
            }}
          >
            Mark bed vacant
          </button>
        </div>
      </aside>

      {view && (
        <div className="lightbox" onClick={(e) => { e.stopPropagation(); setView(null) }}>
          <div className="lightbox-bar">
            <span>{view.title}</span>
            <button className="icon-btn" aria-label="Close" onClick={() => setView(null)}><Icon name="x" size={22} /></button>
          </div>
          <img src={view.url} alt={view.title} onClick={(e) => e.stopPropagation()} />
        </div>
      )}

      {editing && (
        <TenantForm title="Edit tenant" initial={tenant} onSave={(patch) => updateTenant(tenant.id, patch)} onClose={() => setEditing(false)} />
      )}
    </div>
  )
}
