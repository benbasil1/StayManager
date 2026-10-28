import { useEffect, useState } from 'react'
import { useAuth } from './lib/auth'
import { isSupabaseConfigured } from './lib/supabase'
import * as api from './lib/api'
import StaffApp from './components/StaffApp'
import { DataProvider, useData } from './lib/store'
import Icon from './components/Icon'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import Rooms from './components/Rooms'
import Inbox from './components/Inbox'
import Assistant from './components/Assistant'
import Settings from './components/Settings'
import Toasts from './components/Toasts'
import { useInboxAlerts } from './lib/notify'

const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
  { id: 'rooms', label: 'Rooms', icon: 'bed' },
  { id: 'inbox', label: 'Inbox', icon: 'inbox' },
  { id: 'assistant', label: 'Assistant', icon: 'bot' },
]

const readHash = () => {
  const h = window.location.hash.replace('#/', '')
  return h === 'settings' || TABS.some((t) => t.id === h) ? h : 'dashboard'
}

function Shell({ auth }) {
  const data = useData()
  const [tab, setTab] = useState(readHash)
  const [inboxTab, setInboxTab] = useState('complaints')
  const [complaintFilter, setComplaintFilter] = useState('all')
  const [newPg, setNewPg] = useState('')
  const { toasts, dismiss, unread } = useInboxAlerts(data, tab === 'inbox')

  useEffect(() => {
    const onHash = () => setTab(readHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const go = (id) => {
    window.location.hash = '#/' + id
    setTab(id)
    window.scrollTo({ top: 0 })
  }
  const openCalls = () => { setInboxTab('calls'); go('inbox') }
  const openComplaints = () => { setInboxTab('complaints'); setComplaintFilter('open'); go('inbox') }
  const openInbox = () => { setInboxTab('complaints'); setComplaintFilter('all'); go('inbox') }

  const onNav = (id) => (id === 'inbox' ? openInbox() : go(id))

  if (data.loading) return <div className="center-screen">Loading your PG…</div>

  // Signed in but no PG created yet (Supabase mode)
  if (!data.property) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Add your first PG</h1>
          <p className="muted">Give your property a name. You can add more PGs later.</p>
          <form className="login-form" onSubmit={(e) => { e.preventDefault(); if (newPg.trim()) data.addProperty(newPg.trim()) }}>
            <label>PG name<input value={newPg} onChange={(e) => setNewPg(e.target.value)} placeholder="e.g. Green Nest PG" /></label>
            <button className="btn primary block">Create PG</button>
            <button type="button" className="btn ghost block" onClick={data.loadSample}>Load sample data instead</button>
            <button type="button" className="link" onClick={auth.signOut}>Sign out</button>
          </form>
        </div>
      </div>
    )
  }

  const addPg = () => {
    const name = window.prompt('Name of the new PG?')
    if (name && name.trim()) data.addProperty(name.trim())
  }

  return (
    <div className="app">
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div className="brand"><span className="brand-logo"><Icon name="bed" size={22} /></span> StayManager</div>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={'side-link' + (tab === t.id ? ' active' : '')} onClick={() => onNav(t.id)}>
              <Icon name={t.icon} size={20} /> {t.label}
              {t.id === 'inbox' && unread > 0 && <span className="nav-badge side">{unread > 9 ? '9+' : unread}</span>}
            </button>
          ))}
        </nav>
        <div className="side-foot">
          {data.demo && <button className="link-sm" onClick={() => window.confirm('Reset demo data?') && data.resetDemo()}>Reset demo data</button>}
          <button className={'side-link' + (tab === 'settings' ? ' active' : '')} onClick={() => go('settings')}><Icon name="settings" size={20} /> Settings</button>
          <button className="side-link" onClick={auth.signOut}><Icon name="logout" size={20} /> Sign out</button>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="muted">Hello, {auth.session.name}</p>
            <div className="pg-select">
              {data.properties.length > 1 ? (
                <select value={data.propertyId} onChange={(e) => data.selectProperty(e.target.value)} aria-label="Switch PG">
                  {data.properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              ) : (
                <h1>{data.property.name}</h1>
              )}
              <button className="icon-btn" onClick={addPg} aria-label="Add another PG" title="Add another PG"><Icon name="plus" size={16} /></button>
            </div>
          </div>
          <div className="top-actions">
            <button className="logout-btn" onClick={() => go('settings')} aria-label="Settings"><Icon name="settings" /></button>
            <button className="logout-btn" onClick={auth.signOut} aria-label="Sign out"><Icon name="logout" /></button>
          </div>
        </header>

        {data.demo && <div className="notice demo-note">Demo mode: changes are saved in this browser only.</div>}
        {data.error && (
          <div className="notice err" onClick={data.clearError}>{data.error} <span className="muted">(tap to dismiss)</span></div>
        )}

        <div className="content">
          {tab === 'dashboard' && <Dashboard go={go} openCalls={openCalls} openComplaints={openComplaints} />}
          {tab === 'rooms' && <Rooms />}
          {tab === 'inbox' && <Inbox tab={inboxTab} setTab={setInboxTab} complaintFilter={complaintFilter} />}
          {tab === 'assistant' && <Assistant />}
          {tab === 'settings' && <Settings auth={auth} />}
        </div>
      </main>

      <Toasts toasts={toasts} onOpen={openInbox} onDismiss={dismiss} />

      {/* Mobile bottom nav */}
      <nav className="bottom-nav">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => onNav(t.id)}>
            <Icon name={t.icon} size={26} />
            <span>{t.label}</span>
            {t.id === 'inbox' && unread > 0 && <span className="nav-badge">{unread > 9 ? '9+' : unread}</span>}
          </button>
        ))}
      </nav>
    </div>
  )
}

// Decides which app to show: attenders (staff) get the limited view, everyone else the owner app.
function RoleGate({ auth }) {
  const [role, setRole] = useState(isSupabaseConfigured ? null : 'owner')
  useEffect(() => {
    if (!isSupabaseConfigured) return
    let on = true
    api.myRole().then((r) => on && setRole(r)).catch(() => on && setRole('owner'))
    return () => { on = false }
  }, [])
  if (!role) return <div className="center-screen">Loading…</div>
  if (role === 'staff') return <StaffApp auth={auth} />
  return (
    <DataProvider>
      <Shell auth={auth} />
    </DataProvider>
  )
}

export default function App() {
  const auth = useAuth()
  if (!auth.ready) return <div className="center-screen">Loading…</div>
  if (!auth.session) return <Login auth={auth} />
  return <RoleGate key={auth.session.email} auth={auth} />
}
