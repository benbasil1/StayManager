// All Supabase reads/writes live here. Table names match supabase/schema.sql
import { supabase } from './supabase'
import { ymd } from './utils'

const check = ({ data, error }) => {
  if (error) throw error
  return data
}

export async function loadProperties() {
  return check(await supabase.from('properties').select('*').order('created_at'))
}

export async function loadPropertyData(propertyId) {
  const [rooms, complaints, calls, tenants, payments] = await Promise.all([
    supabase.from('rooms').select('*, beds(*)').eq('property_id', propertyId).order('room_no'),
    supabase.from('complaints').select('*').eq('property_id', propertyId).order('created_at', { ascending: false }),
    supabase.from('calls').select('*').eq('property_id', propertyId).order('created_at', { ascending: false }).limit(300),
    supabase.from('tenants').select('*').eq('property_id', propertyId).order('created_at'),
    supabase.from('payments').select('*').eq('property_id', propertyId).order('paid_on', { ascending: false }),
  ])
  const roomRows = check(rooms).map((r) => ({
    ...r,
    beds: [...(r.beds || [])].sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
  }))
  return {
    rooms: roomRows,
    complaints: check(complaints),
    calls: check(calls),
    tenants: check(tenants),
    payments: check(payments),
  }
}

export const createProperty = async (row) => check(await supabase.from('properties').insert(row).select().single())

export const insertRoom = async (room) => {
  const { beds, ...row } = room
  check(await supabase.from('rooms').insert(row))
  if (beds.length) check(await supabase.from('beds').insert(beds))
}
export const removeRoom = async (id) => check(await supabase.from('rooms').delete().eq('id', id))
export const setRoomPrice = async (id, price) => check(await supabase.from('rooms').update({ price }).eq('id', id))

export const insertBed = async (bed) => check(await supabase.from('beds').insert(bed))
export const setBedOccupied = async (id, occupied) => {
  const vacant_since = occupied ? null : ymd(new Date())
  const res = await supabase.from('beds').update({ occupied, vacant_since }).eq('id', id)
  // Older database without the vacant_since column: still save the occupied flag.
  if (res.error && /vacant_since/.test(res.error.message || '')) return check(await supabase.from('beds').update({ occupied }).eq('id', id))
  return check(res)
}
export const removeBed = async (id) => check(await supabase.from('beds').delete().eq('id', id))

export const insertTenant = async (tenant) => check(await supabase.from('tenants').insert(tenant))
export const patchTenant = async (id, patch) => check(await supabase.from('tenants').update(patch).eq('id', id))

export const insertPayment = async (payment) => check(await supabase.from('payments').insert(payment))
export const patchPayment = async (id, patch) => check(await supabase.from('payments').update(patch).eq('id', id))
export const removePayment = async (id) => check(await supabase.from('payments').delete().eq('id', id))

export const setComplaintStatus = async (id, status) =>
  check(await supabase.from('complaints').update({ status }).eq('id', id))

export const loadSampleData = async () => check(await supabase.rpc('seed_demo'))

export async function sendFeedback({ kind, message, email }) {
  check(await supabase.from('feedback').insert({ kind, message, user_email: email }))
}

// ----- roles & attenders (staff) -----
export const myRole = async () => check(await supabase.rpc('my_role'))
export const loadStaffData = async () => check(await supabase.rpc('staff_load'))
export const staffSetComplaintStatus = async (id, status) =>
  check(await supabase.rpc('staff_set_complaint_status', { p_id: id, p_status: status }))
export const loadStaff = async (propertyId) =>
  check(await supabase.from('property_staff').select('*').eq('property_id', propertyId).order('created_at'))
export const addStaff = async (row) => check(await supabase.from('property_staff').insert(row).select().single())
export const removeStaff = async (id) => check(await supabase.from('property_staff').delete().eq('id', id))
