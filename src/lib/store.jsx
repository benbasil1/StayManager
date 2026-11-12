import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { isSupabaseConfigured } from './supabase'
import * as api from './api'
import { buildDemoDb } from './demoData'
import { computeStats, rentSummary, reportUrl, todayStr, uid, waLink, welcomeText } from './utils'
import { addIdDoc, removeIdDoc } from './idDocs'

const DEMO_KEY = 'sm_demo_db_v2'
const PROPERTY_KEY = 'sm_property'
const Ctx = createContext(null)
export const useData = () => useContext(Ctx)

// localStorage can throw (private mode, blocked storage): never let that break the app
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
  del: (k) => { try { localStorage.removeItem(k) } catch { /* ignore */ } },
}

const EMPTY = { properties: [], rooms: [], complaints: [], calls: [], tenants: [], payments: [] }

function loadDemo() {
  try {
    const raw = store.get(DEMO_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore corrupted storage */
  }
  return buildDemoDb()
}

export function DataProvider({ children }) {
  const demo = !isSupabaseConfigured
  const [db, setDb] = useState(() => (demo ? loadDemo() : EMPTY))
  const [propertyId, setPropertyId] = useState(() => store.get(PROPERTY_KEY))
  const [loading, setLoading] = useState(!demo)
  const [error, setError] = useState('')
  const [reportCode, setReportCode] = useState('')
  const [welcomeId, setWelcomeId] = useState(null) // tenant just added: offer the WhatsApp welcome
  const [removal, setRemoval] = useState([]) // tenants who left but are still in the WhatsApp group
  const seq = useRef(0) // counts changes made on this screen, so an older background refresh can never undo them
  const pulseRef = useRef(null) // fingerprint of the calls/complaints we last loaded

  // ---- keep a valid selected property (demo mode) ----
  useEffect(() => {
    if (!demo) return
    if (!db.properties.some((p) => p.id === propertyId)) setPropertyId(db.properties[0]?.id || null)
  }, [demo, db.properties, propertyId])

  useEffect(() => {
    if (propertyId) store.set(PROPERTY_KEY, propertyId)
  }, [propertyId])

  // ---- persist demo data in the browser ----
  useEffect(() => {
    if (demo) store.set(DEMO_KEY, JSON.stringify(db))
  }, [demo, db])

  // ---- load everything from the server (silent = background refresh, no error banner) ----
  const reload = useCallback(async (silent = false) => {
    if (demo) return
    const startedAt = seq.current
    try {
      const properties = await api.loadProperties()
      let pid = propertyId
      if (!properties.some((p) => p.id === pid)) pid = properties[0]?.id || null
      const { pulse, ...data } = pid
        ? await api.loadPropertyData(pid)
        : { rooms: [], complaints: [], calls: [], tenants: [], payments: [] }
      // a background refresh that started before the user changed something would put the old data back: drop it
      if (silent === true && startedAt !== seq.current) return
      pulseRef.current = pulse ? pulse.v : null
      setDb({ properties, ...data })
      if (pid !== propertyId) setPropertyId(pid)
    } catch (e) {
      if (silent !== true) setError(e.message || 'Could not load data from the server')
    } finally {
      setLoading(false)
    }
  }, [demo, propertyId])

  useEffect(() => {
    reload()
  }, [reload])

  // ---- link of the complaint QR page (put in the welcome message) ----
  useEffect(() => {
    if (demo || !propertyId) { setReportCode(''); return }
    let on = true
    api.getReportCode(propertyId).then((r) => on && setReportCode(r.code)).catch(() => on && setReportCode(''))
    return () => { on = false }
  }, [demo, propertyId])

  // ---- new calls / complaints appear within about 15 seconds ----
  // Turso has no realtime, so we ask a tiny "did anything change?" question every 15 seconds and only reload
  // everything when the answer is yes (plus a full refresh every 2 minutes to pick up edits from another phone).
  useEffect(() => {
    if (demo || !propertyId) return
    let ticks = 0
    let busy = false
    const tick = async () => {
      if (document.visibilityState !== 'visible' || busy) return
      busy = true
      ticks += 1
      try {
        const { v } = await api.loadPulse(propertyId)
        if (v !== pulseRef.current || ticks % 8 === 0) await reload(true)
      } catch {
        /* offline or server busy: try again next time */
      } finally {
        busy = false
      }
    }
    const timer = setInterval(tick, 15000)
    document.addEventListener('visibilitychange', tick) // check right away when the app comes back to the front
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', tick)
    }
  }, [demo, propertyId, reload])

  // ---- current PG slices ----
  const rooms = useMemo(() => db.rooms.filter((r) => r.property_id === propertyId), [db.rooms, propertyId])
  const complaints = useMemo(() => db.complaints.filter((c) => c.property_id === propertyId), [db.complaints, propertyId])
  const calls = useMemo(() => db.calls.filter((c) => c.property_id === propertyId), [db.calls, propertyId])
  const tenants = useMemo(() => (db.tenants || []).filter((t) => t.property_id === propertyId), [db.tenants, propertyId])
  const payments = useMemo(() => (db.payments || []).filter((p) => p.property_id === propertyId), [db.payments, propertyId])
  const property = db.properties.find((p) => p.id === propertyId) || null

  // bed.id -> { tenant, room, bed, summary }   (only current, active tenants)
  const rowByBed = useMemo(() => {
    const bedIndex = {}
    rooms.forEach((r) => r.beds.forEach((b) => { bedIndex[b.id] = { room: r, bed: b } }))
    const byTenant = {}
    payments.forEach((p) => { (byTenant[p.tenant_id] ||= []).push(p) })
    const map = {}
    tenants.forEach((t) => {
      if (t.status !== 'active' || !t.bed_id || !bedIndex[t.bed_id]) return
      map[t.bed_id] = { tenant: t, ...bedIndex[t.bed_id], summary: rentSummary(t, byTenant[t.id] || []) }
    })
    return map
  }, [rooms, tenants, payments])

  const tenantRows = useMemo(() => Object.values(rowByBed), [rowByBed])
  const stats = useMemo(() => computeStats(rooms, calls, complaints, rowByBed), [rooms, calls, complaints, rowByBed])
  const paymentsFor = useCallback(
    (tenantId) => payments.filter((p) => p.tenant_id === tenantId).sort((a, b) => (a.paid_on < b.paid_on ? 1 : a.paid_on > b.paid_on ? -1 : 0)),
    [payments]
  )

  // ---- optimistic update + remote write (rolls back by reloading on error) ----
  const mutate = useCallback(
    async (apply, remote) => {
      seq.current += 1
      setDb(apply)
      if (demo) return true
      try {
        await remote()
        return true
      } catch (e) {
        setError(e.message || 'Something went wrong')
        reload()
        return false
      }
    },
    [demo, reload]
  )

  const patchRoom = (roomId, fn) => (d) => ({ ...d, rooms: d.rooms.map((r) => (r.id === roomId ? fn(r) : r)) })
  const setOccupied = (roomId, bedId, occupied) =>
    patchRoom(roomId, (r) => ({ ...r, beds: r.beds.map((b) => (b.id === bedId ? { ...b, occupied, vacant_since: occupied ? null : todayStr() } : b)) }))
  const releaseTenants = (bedIds) => (d) => ({
    ...d,
    tenants: d.tenants.map((t) => (bedIds.includes(t.bed_id) ? { ...t, bed_id: null, status: 'left' } : t)),
  })

  // tenants who were invited to the WhatsApp group and are about to be moved out: remind the owner to remove them
  const remindRemoval = (bedIds) => {
    if (!property?.wa_group_link) return
    const list = tenants.filter((t) => t.status === 'active' && bedIds.includes(t.bed_id) && t.wa_invited_at)
    if (list.length) setRemoval(list.map((t) => ({ id: t.id, name: t.name, phone: t.phone })))
  }

  const actions = {
    // ----- beds & rooms -----
    addBed(roomId) {
      const room = rooms.find((r) => r.id === roomId)
      if (!room) return
      const max = room.beds.reduce((m, b) => Math.max(m, parseInt(b.label.replace(/\D/g, '')) || 0), 0)
      const bed = { id: uid(), room_id: roomId, label: `Bed ${max + 1}`, occupied: false }
      mutate(patchRoom(roomId, (r) => ({ ...r, beds: [...r.beds, bed] })), () => api.insertBed(bed))
    },
    deleteBed(roomId, bedId) {
      remindRemoval([bedId])
      mutate(
        (d) => releaseTenants([bedId])(patchRoom(roomId, (r) => ({ ...r, beds: r.beds.filter((b) => b.id !== bedId) }))(d)),
        () => api.removeBed(bedId)
      )
    },
    addRoom({ room_no, floor, price, bedCount }) {
      const id = uid()
      const beds = Array.from({ length: bedCount }, (_, i) => ({ id: uid(), room_id: id, label: `Bed ${i + 1}`, occupied: false }))
      const room = { id, property_id: propertyId, room_no, floor, price, beds }
      mutate((d) => ({ ...d, rooms: [...d.rooms, room] }), () => api.insertRoom(room))
    },
    deleteRoom(roomId) {
      const bedIds = rooms.find((r) => r.id === roomId)?.beds.map((b) => b.id) || []
      remindRemoval(bedIds)
      mutate(
        (d) => releaseTenants(bedIds)({ ...d, rooms: d.rooms.filter((r) => r.id !== roomId) }),
        () => api.removeRoom(roomId)
      )
    },
    updatePrice(roomId, price) {
      mutate(patchRoom(roomId, (r) => ({ ...r, price })), () => api.setRoomPrice(roomId, price))
    },

    // ----- tenants -----
    async addTenant(roomId, bedId, form, files = []) {
      const tenant = { id: uid(), property_id: propertyId, bed_id: bedId, status: 'active', ...form }
      setWelcomeId(tenant.id)
      // the server saves the tenant and marks the bed occupied in one step
      const saved = await mutate(
        (d) => ({ ...setOccupied(roomId, bedId, true)(d), tenants: [...d.tenants, tenant] }),
        () => api.insertTenant(tenant)
      )
      if (!saved) { setWelcomeId(null); return }
      // ID proof picked in the form: upload after the tenant exists, then link the files to the tenant
      if (files.length) {
        const paths = []
        let failed = ''
        for (const file of files) {
          try { paths.push(await addIdDoc(tenant.id, file)) } catch (e) { failed = e.message || 'ID upload failed' }
        }
        if (paths.length) actions.updateTenant(tenant.id, { id_doc_paths: paths })
        if (failed) setError(`Tenant saved, but an ID file was not uploaded: ${failed}`)
      }
    },
    updateTenant(id, patch) {
      mutate(
        (d) => ({ ...d, tenants: d.tenants.map((t) => (t.id === id ? { ...t, ...patch } : t)) }),
        () => api.patchTenant(id, patch)
      )
    },
    vacateTenant(tenant) {
      remindRemoval([tenant.bed_id])
      const row = rowByBed[tenant.bed_id]
      const patch = { status: 'left', bed_id: null, move_out: todayStr() }
      mutate(
        (d) => {
          const next = { ...d, tenants: d.tenants.map((t) => (t.id === tenant.id ? { ...t, ...patch } : t)) }
          return row ? setOccupied(row.room.id, tenant.bed_id, false)(next) : next
        },
        () => api.patchTenant(tenant.id, patch) // the server frees the bed in the same step
      )
    },

    // ----- WhatsApp group -----
    welcomeLink(row) {
      return waLink(
        row.tenant.whatsapp || row.tenant.phone,
        welcomeText({ tenant: row.tenant, room: row.room, bed: row.bed, property, groupLink: property?.wa_group_link || '', reportLink: reportCode ? reportUrl(reportCode) : '' })
      )
    },
    markInvited(tenantId) {
      if (property?.wa_group_link) actions.updateTenant(tenantId, { wa_invited_at: new Date().toISOString() })
    },
    async setGroupLink(link) {
      const value = String(link || '').trim()
      if (value && !/^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9_-]+(\?[^\s]*)?$/.test(value)) {
        throw new Error('This does not look like a WhatsApp group invite link. It starts with https://chat.whatsapp.com/')
      }
      setDb((d) => ({ ...d, properties: d.properties.map((p) => (p.id === propertyId ? { ...p, wa_group_link: value || null } : p)) }))
      if (demo) return
      try {
        await api.setPropertyWaLink(propertyId, value)
      } catch (e) {
        reload()
        throw e
      }
    },
    dismissWelcome: () => setWelcomeId(null),
    dismissRemoval: () => setRemoval([]),

    // ----- payments -----
    async recordPayment(tenantId, form, proofFile) {
      const payment = { id: uid(), property_id: propertyId, tenant_id: tenantId, ...form }
      let uploadError = ''
      if (proofFile) {
        try { payment.proof_path = await addIdDoc(tenantId, proofFile) } catch (e) { uploadError = e.message || 'Screenshot upload failed' }
      }
      const saved = await mutate((d) => ({ ...d, payments: [...d.payments, payment] }), () => api.insertPayment(payment))
      if (saved && uploadError) setError(`Payment saved, but the screenshot was not uploaded: ${uploadError}`)
    },
    // Add or replace the screenshot on an existing payment
    async setPaymentProof(payment, file) {
      try {
        const path = await addIdDoc(payment.tenant_id, file)
        if (payment.proof_path) removeIdDoc(payment.proof_path).catch(() => {})
        await mutate((d) => ({ ...d, payments: d.payments.map((p) => (p.id === payment.id ? { ...p, proof_path: path } : p)) }), () => api.patchPayment(payment.id, { proof_path: path }))
      } catch (e) {
        setError(e.message || 'Screenshot upload failed')
      }
    },
    deletePayment(id) {
      const old = payments.find((p) => p.id === id)
      mutate((d) => ({ ...d, payments: d.payments.filter((p) => p.id !== id) }), () => api.removePayment(id))
      if (old?.proof_path) removeIdDoc(old.proof_path).catch(() => {})
    },

    // ----- complaints -----
    setComplaintStatus(id, status) {
      mutate(
        (d) => ({ ...d, complaints: d.complaints.map((c) => (c.id === id ? { ...c, status } : c)) }),
        () => api.setComplaintStatus(id, status)
      )
    },

    // ----- PGs -----
    async addProperty(name) {
      if (demo) {
        const p = { id: uid(), name }
        setDb((d) => ({ ...d, properties: [...d.properties, p] }))
        setPropertyId(p.id)
        return
      }
      try {
        const p = await api.createProperty({ name })
        setPropertyId(p.id)
        await reload()
      } catch (e) {
        setError(e.message)
      }
    },
    async loadSample() {
      if (demo) {
        setDb(buildDemoDb())
        return
      }
      try {
        await api.loadSampleData()
        await reload()
      } catch (e) {
        setError(e.message)
      }
    },
    resetDemo() {
      store.del(DEMO_KEY)
      setDb(buildDemoDb())
    },
    reload,
    selectProperty: setPropertyId,
    clearError: () => setError(''),
  }

  const value = {
    demo, loading, error, properties: db.properties, property, propertyId,
    rooms, complaints, calls, tenants, payments, rowByBed, tenantRows, paymentsFor, stats, welcomeId, removal, ...actions,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
