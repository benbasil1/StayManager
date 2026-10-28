import Icon from './Icon'
import { useData } from '../lib/store'
import { daysUntil, fmtDay, intentLabel, leavingText, rupees } from '../lib/utils'

const dotClass = { green: 'dot-green', orange: 'dot-orange', red: 'dot-red' }

export default function Dashboard({ go, openCalls, openComplaints }) {
  const { stats, calls, reload, tenantRows } = useData()
  const leaving = tenantRows.filter((r) => r.tenant.leaving_on).sort((a, b) => (a.tenant.leaving_on < b.tenant.leaving_on ? -1 : 1))
  const maxDay = Math.max(1, ...stats.days.map((d) => d.count))
  const maxIntent = Math.max(1, ...stats.intents.map(([, n]) => n))

  return (
    <div className="dash">
      <section className="hero">
        <p className="hero-label">Est. Monthly Revenue</p>
        <p className="hero-value">{rupees(stats.revenue)}</p>
        <div className="hero-row">
          <div><strong>{stats.occupancy}%</strong><span>Occupancy</span></div>
          <div className="hero-sep" />
          <div><strong>{stats.filled}/{stats.totalBeds}</strong><span>Beds filled</span></div>
        </div>
      </section>

      <section className="stat-grid">
        <button className="card stat" onClick={() => go('rooms')}>
          <span className="stat-icon"><Icon name="door" /></span>
          <strong>{stats.totalRooms}</strong><span>Rooms</span>
        </button>
        <button className="card stat" onClick={() => go('rooms')}>
          <span className="stat-icon"><Icon name="bed" /></span>
          <strong>{stats.vacant}</strong><span>Vacant Beds</span>
        </button>
        <button className="card stat" onClick={openCalls}>
          <span className="stat-icon"><Icon name="phone" /></span>
          <strong>{stats.totalCalls}</strong><span>Total Calls</span>
        </button>
        <button className="card stat" onClick={openComplaints}>
          <span className="stat-icon warn"><Icon name="alert" /></span>
          <strong>{stats.openIssues}</strong><span>Open Issues</span>
        </button>
      </section>

      {leaving.length > 0 && (
        <section className="card panel recent-card">
          <div className="panel-head">
            <h3>Leaving soon</h3>
            <button className="link-sm" onClick={() => go('rooms')}>Open rooms</button>
          </div>
          {leaving.map(({ tenant, room, bed }) => (
            <button className="recent-row" key={tenant.id} onClick={() => go('rooms')}>
              <span className={'dot ' + (daysUntil(tenant.leaving_on) <= 7 ? 'dot-orange' : 'dot-green')} />
              <div className="recent-text">
                <strong>{tenant.name}</strong>
                <span>Room {room.room_no} • {bed.label} • {leavingText(tenant.leaving_on)}</span>
              </div>
              <span className="tag">Free {fmtDay(tenant.leaving_on)}</span>
            </button>
          ))}
        </section>
      )}

      <section className="card panel chart-card">
        <div className="panel-head">
          <h3>Calls (last 7 days)</h3>
          <button className="icon-btn" onClick={reload} aria-label="Refresh"><Icon name="refresh" size={18} /></button>
        </div>
        <div className="bars">
          {stats.days.map((d) => (
            <div className="bar-col" key={d.key}>
              <div className="bar-track">
                <div className="bar" style={{ height: d.count ? `${Math.max(14, (d.count / maxDay) * 100)}%` : '6px' }} />
              </div>
              <span className="bar-date">{d.label}</span>
              <strong>{d.count}</strong>
            </div>
          ))}
        </div>
      </section>

      <section className="card panel intent-card">
        <h3>Call Intent Breakdown</h3>
        {stats.intents.length === 0 && <p className="muted">No calls yet.</p>}
        {stats.intents.map(([intent, n]) => (
          <div className="intent-row" key={intent}>
            <span>{intentLabel[intent] || intent}</span>
            <div className="intent-track"><div style={{ width: `${(n / maxIntent) * 100}%` }} /></div>
            <strong>{n}</strong>
          </div>
        ))}
      </section>

      <section className="card panel recent-card">
        <div className="panel-head">
          <h3>Recent AI Calls</h3>
          <button className="link-sm" onClick={openCalls}>See all</button>
        </div>
        {calls.slice(0, 4).map((c) => (
          <button className="recent-row" key={c.id} onClick={openCalls}>
            <span className={'dot ' + (dotClass[c.sentiment] || 'dot-green')} />
            <div className="recent-text">
              <strong>{c.caller_name}</strong>
              <span className="clamp1">{c.summary}</span>
            </div>
            <span className="tag">{intentLabel[c.intent] || c.intent}</span>
          </button>
        ))}
        {calls.length === 0 && <p className="muted">When your voice agent takes a call, it shows up here.</p>}
      </section>
    </div>
  )
}
