// "Tell tenant on WhatsApp": appears once a complaint is In progress or Resolved. Opens WhatsApp with the message already written;
// the sender only presses Send. The complaint is then marked "Tenant informed" for that status (shared by the owner and attender screens).
import Icon from './Icon'
import { complaintUpdateText, waLink } from '../lib/utils'

const pillStyle = { padding: '9px 16px', fontSize: '0.875rem' }
const doneStyle = { display: 'inline-flex', alignItems: 'center', padding: '9px 14px', borderRadius: 999, background: 'var(--ok-bg)', color: 'var(--ok-ink)', fontWeight: 700, fontSize: '0.875rem' }

export default function NotifyTenant({ complaint, phone, pgName, onSent }) {
  const c = complaint
  if (!['in_progress', 'resolved'].includes(c.status)) return null
  if (String(phone || '').replace(/\D/g, '').length < 10) return null
  const href = waLink(phone, complaintUpdateText({ complaint: c, status: c.status, pgName }))
  const sent = () => { if (onSent) onSent(c.id, c.status) }
  if (c.notified_status === c.status) {
    return (
      <div className="status-row">
        <span style={doneStyle}>✓ Tenant informed</span>
        <a className="act" style={pillStyle} href={href} target="_blank" rel="noreferrer" onClick={sent}>Send again</a>
      </div>
    )
  }
  return (
    <div className="status-row">
      <a className="act wa" style={pillStyle} href={href} target="_blank" rel="noreferrer" onClick={sent}>
        <Icon name="phone" size={16} /> Tell tenant on WhatsApp
      </a>
    </div>
  )
}
