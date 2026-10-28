import { useState } from 'react'
import { useData } from '../lib/store'
import TenantDrawer from './TenantDrawer'
import { fmtDate, fmtDateTime, fmtDuration, intentLabel, kindLabel, statusLabel } from '../lib/utils'

const FILTERS = ['all', 'open', 'in_progress', 'resolved']

const last10 = (v) => String(v || '').replace(/\D/g, '').slice(-10)

// Find the tenant a complaint belongs to: by caller phone first, then by name (+ room number in the message).
function findTenantRow(c, tenantRows) {
  const phone = last10(c.caller_phone)
  if (phone.length === 10) {
    const hit = tenantRows.find((r) => last10(r.tenant.phone) === phone || last10(r.tenant.whatsapp) === phone)
    if (hit) return hit
  }
  const name = String(c.tenant_name || '').trim().toLowerCase()
  if (!name) return null
  const byName = tenantRows.filter((r) => r.tenant.name.trim().toLowerCase() === name)
  if (byName.length <= 1) return byName[0] || null
  const roomNo = (String(c.message || '').match(/\(Room\s+([^)]+)\)/i) || [])[1]
  return (roomNo && byName.find((r) => String(r.room.room_no).toLowerCase() === roomNo.trim().toLowerCase())) || null
}

function Complaints({ initialFilter }) {
  const { complaints, setComplaintStatus, tenantRows } = useData()
  const [filter, setFilter] = useState(initialFilter)
  const [openTenantId, setOpenTenantId] = useState(null)
  const openRow = openTenantId && tenantRows.find((r) => r.tenant.id === openTenantId)
  const list = complaints.filter((c) => filter === 'all' || c.status === filter)

  return (
    <>
      <div className="chips">
        {FILTERS.map((f) => (
          <button key={f} className={'chip' + (filter === f ? ' active' : '')} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : statusLabel[f]}
          </button>
        ))}
      </div>
      <div className="list">
        {list.length === 0 && <div className="empty">Nothing here. Complaints from tenants appear when your voice agent logs them.</div>}
        {list.map((c) => {
          const row = findTenantRow(c, tenantRows)
          return (
          <div className="item" key={c.id}>
            <div className="item-top">
              <span className={'dot ' + (c.priority === 'high' ? 'dot-red' : 'dot-orange')} />
              <strong>{c.tenant_name}</strong>
              <span className="tag">{kindLabel[c.kind] || c.kind}</span>
            </div>
            <p>{c.message}</p>
            <p className="meta">{c.category} • {c.priority.charAt(0).toUpperCase() + c.priority.slice(1)} • {fmtDate(c.created_at)}</p>
            <div className="status-row">
              {['open', 'in_progress', 'resolved'].map((s) => (
                <button key={s} className={'status' + (c.status === s ? ' active' : '')} onClick={() => setComplaintStatus(c.id, s)}>
                  {statusLabel[s]}
                </button>
              ))}
              {row && (
                <button className="status" style={{ marginLeft: 'auto' }} onClick={() => setOpenTenantId(row.tenant.id)}>
                  Tenant details
                </button>
              )}
            </div>
          </div>
          )
        })}
      </div>
      {openRow && <TenantDrawer row={openRow} onClose={() => setOpenTenantId(null)} />}
    </>
  )
}

function Calls() {
  const { calls } = useData()
  const [openId, setOpenId] = useState(null)
  const dot = { green: 'dot-green', orange: 'dot-orange', red: 'dot-red' }

  return (
    <div className="list">
      {calls.length === 0 && <div className="empty">No calls yet. Calls handled by your AI voice agent will show up here.</div>}
      {calls.map((c) => (
        <button className="item call-item" key={c.id} onClick={() => setOpenId(openId === c.id ? null : c.id)}>
          <div className="item-top">
            <span className={'dot ' + (dot[c.sentiment] || 'dot-green')} />
            <strong>{c.caller_name}</strong>
            <span className="tag">{intentLabel[c.intent] || c.intent}</span>
          </div>
          <p className={openId === c.id ? '' : 'clamp2'}>{c.summary}</p>
          <p className="meta">{fmtDuration(c.duration_seconds)} • {fmtDateTime(c.created_at)}</p>
        </button>
      ))}
    </div>
  )
}

export default function Inbox({ tab, setTab, complaintFilter }) {
  return (
    <div className="inbox-page">
      <h2 className="page-title">Inbox</h2>
      <div className="seg">
        <button className={tab === 'complaints' ? 'active' : ''} onClick={() => setTab('complaints')}>Complaints</button>
        <button className={tab === 'calls' ? 'active' : ''} onClick={() => setTab('calls')}>Calls</button>
      </div>
      {tab === 'complaints' ? <Complaints key={complaintFilter} initialFilter={complaintFilter} /> : <Calls />}
    </div>
  )
}