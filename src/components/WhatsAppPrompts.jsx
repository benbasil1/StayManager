// Pop-ups for the PG WhatsApp group:
//  1) right after a tenant is added: "Send welcome on WhatsApp" (welcome + group link + complaint QR link)
//  2) when a tenant who joined the group is moved out: reminder to remove them from the group
import { useState } from 'react'
import { useData } from '../lib/store'
import Icon from './Icon'

// One-tap copy chip: shows the text, copies `value` to the clipboard when tapped.
function CopyChip({ value, children }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Fallback for non-HTTPS pages / older browsers
      const el = document.createElement('textarea')
      el.value = value
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  return (
    <button type="button" className={`copy-chip${copied ? ' copied' : ''}`} onClick={copy} title="Tap to copy">
      {copied ? <><Icon name="check" size={14} /> Copied</> : <>{children}<Icon name="copy" size={14} /></>}
    </button>
  )
}

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
            <div key={t.id} className="copy-row">
              <CopyChip value={t.name}><strong>{t.name}</strong></CopyChip>
              {t.phone && <CopyChip value={String(t.phone)}><span className="muted">{t.phone}</span></CopyChip>}
            </div>
          ))}
          <button type="button" className="btn primary block" onClick={dismissRemoval}>Done</button>
        </div>
      </div>
    )
  }
  return null
}
