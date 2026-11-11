// Pop-ups for the PG WhatsApp group:
//  1) right after a tenant is added: "Send welcome on WhatsApp" (welcome + group link + complaint QR link)
//  2) when a tenant who joined the group is moved out: reminder to remove them from the group
import { useData } from '../lib/store'
import Icon from './Icon'

export default function WhatsAppPrompts() {
  const { welcomeId, removal, tenantRows, property, welcomeLink, markInvited, dismissWelcome, dismissRemoval } = useData()
  const row = welcomeId ? tenantRows.find((r) => r.tenant.id === welcomeId) : null
  const hasGroup = !!(property && property.wa_group_link)

  if (row) {
    const first = row.tenant.name.split(' ')[0]
    return (
      <div className="modal-back top" onClick={dismissWelcome}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="panel-head">
            <h3>{first} added</h3>
            <button type="button" className="icon-btn" onClick={dismissWelcome} aria-label="Close"><Icon name="x" size={18} /></button>
          </div>
          <p className="muted">
            Send {first} a welcome message on WhatsApp
            {hasGroup ? ' with the PG group link' : ''} and the link to report problems.
            {!hasGroup && ' Tip: add your PG WhatsApp group link in Settings to include it.'}
          </p>
          <a
            className="btn primary block"
            href={welcomeLink(row)}
            target="_blank"
            rel="noreferrer"
            onClick={() => { markInvited(row.tenant.id); dismissWelcome() }}
          >
            Send welcome on WhatsApp
          </a>
          <button type="button" className="btn ghost block" onClick={dismissWelcome}>Skip for now</button>
        </div>
      </div>
    )
  }

  if (removal.length) {
    return (
      <div className="modal-back top" onClick={dismissRemoval}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="panel-head">
            <h3>Remove from WhatsApp group</h3>
            <button type="button" className="icon-btn" onClick={dismissRemoval} aria-label="Close"><Icon name="x" size={18} /></button>
          </div>
          <p className="muted">WhatsApp does not let an app remove people. Open the PG group, tap the group name, find the person below and choose Remove:</p>
          {removal.map((t) => (
            <p key={t.id}><strong>{t.name}</strong> <span className="muted">{t.phone}</span></p>
          ))}
          <button type="button" className="btn primary block" onClick={dismissRemoval}>Done</button>
        </div>
      </div>
    )
  }
  return null
}
