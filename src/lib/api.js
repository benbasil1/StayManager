// All database reads/writes go through the StayManager API (Cloudflare Pages Functions -> Turso).
// Login still uses Supabase Auth: every request carries the user's login token.
import { supabase } from './supabase'
import { ymd } from './utils'

// Website: leave VITE_API_BASE empty (same domain). Android/iOS app: set it to your site, e.g. https://staymanager.pages.dev
const BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '')

async function call(method, path, body) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  let res
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Could not reach the server. Check your internet connection.')
  }
  let payload = null
  try { payload = await res.json() } catch { /* empty body */ }
  if (!res.ok) {
    const err = new Error(payload?.error || `Request failed (${res.status})`)
    if (payload?.code) err.code = payload.code
    throw err
  }
  return payload
}

export const loadProperties = () => call('GET', '/properties')

export async function loadPropertyData(propertyId) {
  const d = await call('GET', `/properties/${propertyId}/data`)
  return {
    ...d,
    rooms: d.rooms.map((r) => ({
      ...r,
      beds: [...(r.beds || [])].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
    })),
  }
}

export const createProperty = (row) => call('POST', '/properties', row)

export const insertRoom = (room) => call('POST', '/rooms', room) // room includes its beds
export const removeRoom = (id) => call('DELETE', `/rooms/${id}`)
export const setRoomPrice = (id, price) => call('PATCH', `/rooms/${id}`, { price })

export const insertBed = (bed) => call('POST', '/beds', bed)
export const setBedOccupied = (id, occupied) =>
  call('PATCH', `/beds/${id}`, { occupied, vacant_since: occupied ? null : ymd(new Date()) })
export const removeBed = (id) => call('DELETE', `/beds/${id}`)

export const insertTenant = (tenant) => call('POST', '/tenants', tenant)
export const patchTenant = (id, patch) => call('PATCH', `/tenants/${id}`, patch)

export const insertPayment = (payment) => call('POST', '/payments', payment)
export const patchPayment = (id, patch) => call('PATCH', `/payments/${id}`, patch)
export const removePayment = (id) => call('DELETE', `/payments/${id}`)

export const setComplaintStatus = (id, status) => call('PATCH', `/complaints/${id}`, { status })

export const loadSampleData = () => call('POST', '/seed')

export const sendFeedback = ({ kind, message }) => call('POST', '/feedback', { kind, message })

// ----- files (ID photos, payment screenshots) stored in Turso -----
const fileId = (path) => path.replace(/^turso:/, '') // "turso:<id>.jpg" -> "<id>.jpg"

export async function uploadFile(tenantId, blob, name = 'file') {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  let res
  try {
    res = await fetch(`${BASE}/api/files?tenant_id=${encodeURIComponent(tenantId)}&name=${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: { 'content-type': blob.type || 'application/octet-stream', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: blob,
    })
  } catch {
    throw new Error('Could not reach the server. Check your internet connection.')
  }
  let payload = null
  try { payload = await res.json() } catch { /* empty body */ }
  if (!res.ok) throw new Error(payload?.error || `Upload failed (${res.status})`)
  return payload.path // saved on the tenant / payment
}

// Returns a temporary local link (blob:) that works in <img src> and window.open
export async function downloadFileUrl(path) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  let res
  try {
    res = await fetch(`${BASE}/api/files/${encodeURIComponent(fileId(path))}`, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  } catch {
    throw new Error('Could not reach the server. Check your internet connection.')
  }
  if (!res.ok) throw new Error(res.status === 404 ? 'This file was not found.' : `Could not open the file (${res.status})`)
  return URL.createObjectURL(await res.blob())
}

export const deleteFile = (path) => call('DELETE', `/files/${encodeURIComponent(fileId(path))}`)

// ----- roles & attenders (staff) -----
export const myRole = () => call('GET', '/role')
export const loadStaffData = () => call('GET', '/staff/load')
export const staffSetComplaintStatus = (id, status) => call('PATCH', `/staff/complaints/${id}`, { status })
export const loadStaff = (propertyId) => call('GET', `/staff?property_id=${encodeURIComponent(propertyId)}`)
export const addStaff = (row) => call('POST', '/staff', row)
export const removeStaff = (id) => call('DELETE', `/staff/${id}`)
