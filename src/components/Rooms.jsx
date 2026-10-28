import { useMemo, useRef, useState } from 'react'
import Icon from './Icon'
import { useData } from '../lib/store'
import TenantDrawer from './TenantDrawer'
import TenantForm from './TenantForm'
import { fmtShort, rupees, sharingName } from '../lib/utils'

function BedChip({ bed, row, onOpen, onDelete }) {
  const timer = useRef(null)
  const fired = useRef(false)

  const ask = () => {
    fired.current = true
    clearTimeout(timer.current)
    const who = row ? ` (${row.tenant.name} will be moved out)` : ''
    if (window.confirm(`Delete ${bed.label}?${who}`)) onDelete()
  }
  const start = () => {
    fired.current = false
    timer.current = setTimeout(ask, 500) // long-press (touch)
  }
  const cancel = () => clearTimeout(timer.current)

  return (
    <button
      className={'bed' + (row ? ' on' : '')}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onClick={() => {
        if (!fired.current) onOpen()
      }}
      onContextMenu={(e) => {
        e.preventDefault() // right-click (desktop)
        if (!fired.current) ask()
      }}
      title={row ? `${row.tenant.name}: tap for details` : 'Vacant: tap to add a tenant'}
    >
      {row ? (
        <>
          <span className={'dot ' + { paid: 'dot-green', due: 'dot-orange', overdue: 'dot-red' }[row.summary.status]} />
          <span className="bed-text"><strong>{row.tenant.name}</strong><small>{bed.label}{row.tenant.leaving_on ? ` • leaving ${fmtShort(row.tenant.leaving_on)}` : ''}</small></span>
        </>
      ) : (
        <>
          <Icon name="bed" size={16} />
          <span className="bed-text"><strong>{bed.label}</strong><small>{bed.vacant_since ? `Vacant since ${fmtShort(bed.vacant_since)}` : 'Vacant: add tenant'}</small></span>
        </>
      )}
    </button>
  )
}

function PricePill({ price, onSave }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(price)

  const commit = () => {
    const n = parseInt(value, 10)
    if (!Number.isNaN(n) && n >= 0 && n !== price) onSave(n)
    setEditing(false)
  }

  if (editing) {
    return (
      <span className="price-pill editing">
        ₹
        <input
          autoFocus
          type="number"
          min="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') setEditing(false)
          }}
        />
      </span>
    )
  }
  return (
    <button className="price-pill" onClick={() => { setValue(price); setEditing(true) }} title="Edit price per bed">
      {rupees(price)} <Icon name="pencil" size={14} />
    </button>
  )
}

function AddRoomModal({ onClose, onSave, defaultFloor }) {
  const [roomNo, setRoomNo] = useState('')
  const [floor, setFloor] = useState(defaultFloor || 1)
  const [beds, setBeds] = useState(2)
  const [price, setPrice] = useState(7000)

  const submit = (e) => {
    e.preventDefault()
    if (!roomNo.trim()) return
    onSave({ room_no: roomNo.trim(), floor: Number(floor), price: Number(price), bedCount: Number(beds) })
    onClose()
  }

  return (
    <div className="modal-back" onClick={onClose}>
      <form className="modal" onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <div className="panel-head">
          <h3>Add room</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={18} /></button>
        </div>
        <label>Room number<input autoFocus value={roomNo} onChange={(e) => setRoomNo(e.target.value)} placeholder="e.g. 104" /></label>
        <div className="two">
          <label>Floor<input type="number" min="0" value={floor} onChange={(e) => setFloor(e.target.value)} /></label>
          <label>Beds
            <select value={beds} onChange={(e) => setBeds(e.target.value)}>
              {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        </div>
        <label>Price per bed (₹ / month)<input type="number" min="0" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
        <button className="btn primary block">Save room</button>
      </form>
    </div>
  )
}

export default function Rooms() {
  const { rooms, rowByBed, addTenant, addBed, deleteBed, addRoom, deleteRoom, updatePrice } = useData()
  const [floor, setFloor] = useState('all')
  const [showAdd, setShowAdd] = useState(false)
  const [sel, setSel] = useState(null) // { roomId, bedId }

  const floors = useMemo(() => [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b), [rooms])
  const list = useMemo(
    () =>
      rooms
        .filter((r) => floor === 'all' || r.floor === floor)
        .sort((a, b) => a.room_no.localeCompare(b.room_no, undefined, { numeric: true })),
    [rooms, floor]
  )

  const selRoom = sel && rooms.find((r) => r.id === sel.roomId)
  const selBed = selRoom && selRoom.beds.find((b) => b.id === sel.bedId)
  const selRow = selBed && rowByBed[selBed.id]

  return (
    <div>
      <div className="page-head">
        <h2>Rooms &amp; Beds</h2>
        <button className="btn primary" onClick={() => setShowAdd(true)}><Icon name="plus" size={18} /> Room</button>
      </div>

      <div className="chips">
        <button className={'chip' + (floor === 'all' ? ' active' : '')} onClick={() => setFloor('all')}>All</button>
        {floors.map((f) => (
          <button key={f} className={'chip' + (floor === f ? ' active' : '')} onClick={() => setFloor(f)}>Floor {f}</button>
        ))}
      </div>

      {list.length === 0 && <div className="card empty">No rooms here yet. Tap <strong>+ Room</strong> to add your first one.</div>}

      <div className="room-grid">
        {list.map((r) => {
          const occ = r.beds.filter((b) => b.occupied).length
          return (
            <article className="card room" key={r.id}>
              <div className="room-top">
                <div>
                  <h3>Room {r.room_no}</h3>
                  <p className="muted">Floor {r.floor} • {sharingName(r.beds.length)} • {occ}/{r.beds.length} Occupied</p>
                </div>
                <PricePill price={r.price} onSave={(n) => updatePrice(r.id, n)} />
              </div>
              <div className="beds">
                {r.beds.map((b) => (
                  <BedChip key={b.id} bed={b} row={rowByBed[b.id]} onOpen={() => setSel({ roomId: r.id, bedId: b.id })} onDelete={() => deleteBed(r.id, b.id)} />
                ))}
                <button className="bed add" onClick={() => addBed(r.id)}><Icon name="plus" size={16} /> Add bed</button>
              </div>
              <div className="room-foot">
                <span>Tap a bed for tenant details • Long-press to delete</span>
                <button
                  className="icon-btn danger"
                  aria-label={`Delete room ${r.room_no}`}
                  onClick={() => window.confirm(`Delete Room ${r.room_no} and all its beds?`) && deleteRoom(r.id)}
                >
                  <Icon name="trash" size={18} />
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {selRow && <TenantDrawer row={selRow} onClose={() => setSel(null)} />}
      {selRoom && selBed && !selRow && (
        <TenantForm
          title={`Add tenant: Room ${selRoom.room_no}, ${selBed.label}`}
          defaultRent={selRoom.price}
          onSave={(form, files) => addTenant(selRoom.id, selBed.id, form, files)}
          onClose={() => setSel(null)}
        />
      )}
      {showAdd && <AddRoomModal onClose={() => setShowAdd(false)} onSave={addRoom} defaultFloor={floor === 'all' ? 1 : floor} />}
    </div>
  )
}
