import { lazy, Suspense, useEffect, useState } from 'react'
import { useAuth } from './lib/auth'
import { isSupabaseConfigured } from './lib/supabase'
import * as api from './lib/api'
import { DataProvider, useData } from './lib/store'
import Icon from './components/Icon'
import Login from './components/Login'
import Dashboard from './components/Dashboard'
import Rooms from './components/Rooms'
import Inbox from './components/Inbox'
import Toasts from './components/Toasts'
import WhatsAppPrompts from './components/WhatsAppPrompts'
import { useInboxAlerts } from './lib/notify'

// Screens that are not needed on first open load only when used (smaller first download = faster start on phones)
const Assistant = lazy(() => import('./components/Assistant'))
const Settings = lazy(() => import('./components/Settings'))
const StaffApp = lazy(() => import('./components/StaffApp'))
const ReportPage = lazy(() => import('./components/ReportPage'))
const ResetPassword = lazy(() => import('./components/ResetPassword'))
const Loading = ({ text = 'Loading…' }) => <div className="center-screen">{text}</div>

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

  if (data.loading) return <Loading text="Loading your PG…" />

  // The server could not be reached: say so (never show "Add your first PG" for a failed load)
  if (!data.property && data.error) {
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Could not load your PG</h1>
          <p className="muted">{data.error}</p>
          <div className="login-form">
            <button className="btn primary block" onClick={() => { data.clearError(); data.reload() }}>Try again</button>
            <button type="button" className="link" onClick={auth.signOut}>Sign out</button>
          </div>
        </div>
      </div>
    )
  }

  // Signed in but no PG created yet
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
          <Suspense fallback={<Loading />}>
            {tab === 'assistant' && <Assistant />}
            {tab === 'settings' && <Settings auth={auth} />}
          </Suspense>
        </div>
      </main>

      <Toasts toasts={toasts} onOpen={openInbox} onDismiss={dismiss} />
      <WhatsAppPrompts />

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
  if (!role) return <Loading />
  if (role === 'staff') return <Suspense fallback={<Loading />}><StaffApp auth={auth} /></Suspense>
  return (
    <DataProvider>
      <Shell auth={auth} />
    </DataProvider>
  )
}

function SignedInApp() {
  const auth = useAuth()
  if (!auth.ready) return <Loading />
  if (!auth.session) return <Login auth={auth} />
  return <RoleGate key={auth.session.email} auth={auth} />
}

export default function App() {
  const [hash, setHash] = useState(window.location.hash)
  useEffect(() => {
    const onHash = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  // public QR page for tenants: works without any login
  const report = hash.match(/^#\/report\/([\w-]+)/)
  if (report) return <Suspense fallback={<Loading />}><ReportPage code={report[1]} /></Suspense>
  // emailed "forgot password" link: works for owners and attenders, signed in or not
  const reset = hash.match(/^#\/reset\/([\w-]+)/)
  if (reset) return <Suspense fallback={<Loading />}><ResetPassword token={reset[1]} /></Suspense>
  return <SignedInApp />
}
