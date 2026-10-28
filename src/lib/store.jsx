import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { isSupabaseConfigured, supabase } from './supabase'
import * as api from './api'
import { buildDemoDb } from './demoData'
import { computeStats, rentSummary, todayStr, uid } from './utils'
import { addIdDoc, removeIdDoc } from './idDocs'

const DEMO_KEY = 'sm_demo_db_v2'
const PROPERTY_KEY = 'sm_property'
const Ctx = createContext(null)
export const useData = () => useContext(Ctx)

const EMPTY = { properties: [], rooms: [], complaints: [], calls: [], tenants: [], payments: [] }

function loadDemo() {
  try {
    const raw = localStorage.getItem(DEMO_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    /* ignore corrupted storage */
  }
  return buildDemoDb()
}

export function DataProvider({ children }) {
  const demo = !isSupabaseConfigured
  const [db, setDb] = useState(() => (demo ? loadDemo() : EMPTY))
  const [propertyId, setPropertyId] = useState(() => localStorage.getItem(PROPERTY_KEY))
  const [loading, setLoading] = useState(!demo)
  const [error, setError] = useState('')

  // ---- keep a valid selected property (demo mode) ----
  useEffect(() => {
    if (!demo) return
    if (!db.properties.some((p) => p.id === propertyId)) setPropertyId(db.properties[0]?.id || null)
  }, [demo, db.properties, propertyId])

  useEffect(() => {
    if (propertyId) localStorage.setItem(PROPERTY_KEY, propertyId)
  }, [propertyId])

  // ---- persist demo data in the browser ----
  useEffect(() => {
    if (demo) localStorage.setItem(DEMO_KEY, JSON.stringify(db))
  }, [demo, db])

  // ---- load everything from Supabase ----
  const reload = useCallback(async () => {
    if (demo) return
    try {
      const properties = await api.loadProperties()
      let pid = propertyId
      if (!properties.some((p) => p.id === pid)) pid = properties[0]?.id || null
      const data = pid
        ? await api.loadPropertyData(pid)
        : { rooms: [], complaints: [], calls: [], tenants: [], payments: [] }
      setDb({ properties, ...data })
      if (pid !== propertyId) setPropertyId(pid)
    } catch (e) {
      setError(e.message || 'Could not load data from Supabase')
    } finally {
      setLoading(false)
    }
  }, [demo, propertyId])

  useEffect(() => {
    reload()
  }, [reload])

  // ---- realtime: new calls / complaints / payments appear instantly ----
  useEffect(() => {
    if (demo || !propertyId) return
    const filter = `property_id=eq.${propertyId}`
    const channel = supabase
      .channel('pg-' + propertyId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calls', filter }, () => reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints', filter }, () => reload())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tenants', filter }, () => reload())
      .subscribe()
    return () => {
      supabase.removeChannel(channel)
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
      setDb(apply)
      if (demo) return
      try {
        await remote()
      } catch (e) {
        setError(e.message || 'Something went wrong')
        reload()
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
      await mutate(
        (d) => ({ ...setOccupied(roomId, bedId, true)(d), tenants: [...d.tenants, tenant] }),
        async () => {
          await api.insertTenant(tenant)
          await api.setBedOccupied(bedId, true)
        }
      )
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
      const row = rowByBed[tenant.bed_id]
      const patch = { status: 'left', bed_id: null, move_out: todayStr() }
      mutate(
        (d) => {
          const next = { ...d, tenants: d.tenants.map((t) => (t.id === tenant.id ? { ...t, ...patch } : t)) }
          return row ? setOccupied(row.room.id, tenant.bed_id, false)(next) : next
        },
        async () => {
          await api.patchTenant(tenant.id, patch)
          if (row) await api.setBedOccupied(tenant.bed_id, false)
        }
      )
    },

    // ----- payments -----
    async recordPayment(tenantId, form, proofFile) {
      const payment = { id: uid(), property_id: propertyId, tenant_id: tenantId, ...form }
      let uploadError = ''
      if (proofFile) {
        try { payment.proof_path = await addIdDoc(tenantId, proofFile) } catch (e) { uploadError = e.message || 'Screenshot upload failed' }
      }
      await mutate((d) => ({ ...d, payments: [...d.payments, payment] }), () => api.insertPayment(payment))
      if (uploadError) setError(`Payment saved, but the screenshot was not uploaded: ${uploadError}`)
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
      localStorage.removeItem(DEMO_KEY)
      setDb(buildDemoDb())
    },
    reload,
    selectProperty: setPropertyId,
    clearError: () => setError(''),
  }

  const value = {
    demo, loading, error, properties: db.properties, property, propertyId,
    rooms, complaints, calls, tenants, payments, rowByBed, tenantRows, paymentsFor, stats, ...actions,
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}
