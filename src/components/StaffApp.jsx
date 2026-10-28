// Attender (staff) view: complaints + tenant contact info only. No rent, payments or ID proofs.
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from './Icon'
import Toasts from './Toasts'
import * as api from '../lib/api'
import { useInboxAlerts } from '../lib/notify'
import { fmtDate, kindLabel, statusLabel, waLink } from '../lib/utils'

const FILTERS = ['all', 'open', 'in_progress', 'resolved']
const TABS = [
  { id: 'complaints', label: 'Complaints', icon: 'inbox' },
  { id: 'contacts', label: 'Contacts', icon: 'phone' },
]
const PROPERTY_KEY = 'sm_staff_property'
const last10 = (v) => String(v || '').replace(/\D/g, '').slice(-10)

// Which tenant does this complaint belong to? Phone first, then name (+ room number in the message).
function findContact(c, contacts) {
  const phone = last10(c.caller_phone)
  if (phone.length === 10) {
    const hit = contacts.find((t) => last10(t.phone) === phone || last10(t.whatsapp) === phone)
    if (hit) return hit
  }
  const name = String(c.tenant_name || '').trim().toLowerCase()
  if (!name) return null
  const byName = contacts.filter((t) => t.name.trim().toLowerCase() === name)
  if (byName.length <= 1) return byName[0] || null
  const roomNo = (String(c.message || '').match(/\(Room\s+([^)]+)\)/i) || [])[1]
  return (roomNo && byName.find((t) => String(t.room_no).toLowerCase() === roomNo.trim().toLowerCase())) || null
}

const pillStyle = { padding: '9px 16px', fontSize: '0.875rem' }

function ContactButtons({ phone, whatsapp }) {
  if (!phone) return null
  return (
    <div className="status-row">
      <a className="act wa" style={pillStyle} href={`tel:${phone}`}><Icon name="phone" size={16} /> Call</a>
      <a className="act" style={pillStyle} href={waLink(whatsapp || phone)} target="_blank" rel="noreferrer">WhatsApp</a>
    </div>
  )
}

function Complaints({ complaints, contacts, setStatus }) {
  const [filter, setFilter] = useState('all')
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
        {list.length === 0 && <div className="empty">Nothing here. New complaints show up on their own.</div>}
        {list.map((c) => {
          const contact = findContact(c, contacts)
          const phone = (contact && contact.phone) || c.caller_phone
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
                  <button key={s} className={'status' + (c.status === s ? ' active' : '')} onClick={() => setStatus(c.id, s)}>
                    {statusLabel[s]}
                  </button>
                ))}
              </div>
              <ContactButtons phone={phone} whatsapp={contact && contact.whatsapp} />
            </div>
          )
        })}
      </div>
    </>
  )
}

function Contacts({ contacts }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const t = q.trim().toLowerCase()
    return [...contacts]
      .filter((x) => !t || `${x.name} ${x.room_no} ${x.phone}`.toLowerCase().includes(t))
      .sort((a, b) => String(a.room_no).localeCompare(String(b.room_no), undefined, { numeric: true }) || a.name.localeCompare(b.name))
  }, [contacts, q])
  return (
    <>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search name, room or number"
        aria-label="Search contacts"
        style={{ width: '100%', padding: '12px 16px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--card)', color: 'inherit', font: 'inherit', marginBottom: 8 }}
      />
      <div className="list">
        {list.length === 0 && <div className="empty">{contacts.length ? 'No match.' : 'No tenants to show yet.'}</div>}
        {list.map((t) => (
          <div className="item" key={t.id}>
            <div className="item-top">
              <strong>{t.name}</strong>
              <span className="tag">Room {t.room_no}</span>
            </div>
            <p className="meta">{t.bed_label} • {t.phone}</p>
            <ContactButtons phone={t.phone} whatsapp={t.whatsapp} />
          </div>
        ))}
      </div>
    </>
  )
}

export default function StaffApp({ auth }) {
  const [tab, setTab] = useState('complaints')
  const [data, setData] = useState({ properties: [], complaints: [], contacts: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pid, setPid] = useState(() => { try { return localStorage.getItem(PROPERTY_KEY) } catch { return null } })

  const load = useCallback(async (first) => {
    try {
      setData(await api.loadStaffData())
    } catch (e) {
      if (first) setError(e.message || 'Could not load')
    } finally {
      setLoading(false)
    }
  }, [])

  // Staff have no realtime channel, so refresh every 15s and whenever the app comes back to the front.
  useEffect(() => {
    load(true)
    const t = setInterval(() => load(false), 15000)
    const onVis = () => { if (!document.hidden) load(false) }
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis) }
  }, [load])

  const propertyId = data.properties.some((p) => p.id === pid) ? pid : (data.properties[0] && data.properties[0].id) || null
  const property = data.properties.find((p) => p.id === propertyId) || null
  const complaints = useMemo(() => data.complaints.filter((c) => c.property_id === propertyId), [data.complaints, propertyId])
  const contacts = useMemo(() => data.contacts.filter((t) => t.property_id === propertyId), [data.contacts, propertyId])
  const { toasts, dismiss, unread } = useInboxAlerts({ loading, propertyId, calls: [], complaints }, tab === 'complaints')

  const selectProperty = (id) => { setPid(id); try { localStorage.setItem(PROPERTY_KEY, id) } catch { /* ignore */ } }

  const setStatus = async (id, status) => {
    setData((d) => ({ ...d, complaints: d.complaints.map((c) => (c.id === id ? { ...c, status } : c)) }))
    try {
      await api.staffSetComplaintStatus(id, status)
    } catch (e) {
      setError(e.message || 'Could not update the status')
      load(false)
    }
  }

  if (loading) return <div className="center-screen">Loading…</div>

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand"><span className="brand-logo"><Icon name="bed" size={22} /></span> StayManager</div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={'side-link' + (tab === t.id ? ' active' : '')} onClick={() => setTab(t.id)}>
              <Icon name={t.icon} size={20} /> {t.label}
              {t.id === 'complaints' && unread > 0 && <span className="nav-badge side">{unread > 9 ? '9+' : unread}</span>}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          <button className="side-link" onClick={auth.signOut}><Icon name="logout" size={20} /> Sign out</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="muted">Hello, {auth.session.name}</p>
            <div className="pg-select">
              {data.properties.length > 1 ? (
                <select value={propertyId || ''} onChange={(e) => selectProperty(e.target.value)} aria-label="Switch PG">
                  {data.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : (
                <h1>{property ? property.name : 'Attender'}</h1>
              )}
            </div>
          </div>
          <div className="top-actions">
            <button className="logout-btn" onClick={auth.signOut} aria-label="Sign out"><Icon name="logout" /></button>
          </div>
        </header>

        {error && <div className="notice err" onClick={() => setError('')}>{error} <span className="muted">(tap to dismiss)</span></div>}

        <div className="content">
          {!property && <div className="empty">You have not been added to a PG yet. Ask the owner to add your email.</div>}
          {property && tab === 'complaints' && (
            <div className="inbox-page">
              <h2 className="page-title">Complaints</h2>
              <Complaints complaints={complaints} contacts={contacts} setStatus={setStatus} />
            </div>
          )}
          {property && tab === 'contacts' && (
            <div className="inbox-page">
              <h2 className="page-title">Contacts</h2>
              <Contacts contacts={contacts} />
            </div>
          )}
        </div>
      </main>

      <Toasts toasts={toasts} onOpen={() => setTab('complaints')} onDismiss={dismiss} />

      <nav className="bottom-nav">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={26} />
            <span>{t.label}</span>
            {t.id === 'complaints' && unread > 0 && <span className="nav-badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
        ))}
      </nav>
    </div>
  )
}
