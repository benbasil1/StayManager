import { uid, ymd } from './utils'

const hoursAgo = (h, minsOffset = 0) => new Date(Date.now() - h * 3600e3 - minsOffset * 60e3).toISOString()

function makeRoom(propertyId, room_no, floor, price, occupiedFlags) {
  const id = uid()
  return {
    id,
    property_id: propertyId,
    room_no,
    floor,
    price,
    beds: occupiedFlags.map((occupied, i) => ({ id: uid(), room_id: id, label: `Bed ${i + 1}`, occupied })),
  }
}

export function buildDemoDb() {
  const pg = uid()
  const pg2 = uid()
  const rooms = [
    makeRoom(pg, '101', 1, 8000, [false, true]),
    makeRoom(pg, '102', 1, 6500, [true, true, false]),
    makeRoom(pg, '103', 1, 9500, [true]),
    makeRoom(pg, '201', 2, 6000, [true, false, false]),
    makeRoom(pg, '202', 2, 7500, [false, true]),
    makeRoom(pg, '203', 2, 5500, [true, false, true, false]),
    makeRoom(pg2, '101', 1, 7000, [true, false]),
    makeRoom(pg2, '102', 1, 6000, [false, false, true]),
  ]

  const c = (name, message, category, priority, kind, status, h) => ({
    id: uid(), property_id: pg, tenant_name: name, message, category, priority, kind, status, created_at: hoursAgo(h),
  })
  const complaints = [
    c('Rajiv M.', 'Hot water is not available in the morning. Please check the geyser.', 'Maintenance', 'high', 'complaint', 'open', 20),
    c('Rohit Verma', 'Request deep cleaning of bathroom in room 102.', 'Cleaning', 'medium', 'request', 'in_progress', 22),
    c('Megha R.', 'Can I get a monthly discount for 6-month advance payment?', 'Pricing', 'low', 'query', 'in_progress', 23),
    c('Nandini P.', 'Please install a water purifier on 2nd floor.', 'Amenities', 'low', 'request', 'in_progress', 24),
  ]

  const call = (caller_name, summary, intent, sentiment, duration_seconds, h) => ({
    id: uid(), property_id: pg, caller_name, summary, intent, sentiment, duration_seconds, created_at: hoursAgo(h),
  })
  const calls = [
    call('Amit Kumar', 'Caller asked about bed availability for a working professional. Prefers AC room and wants to visit tomorrow evening.', 'bed_vacancy', 'green', 142, 0.3),
    call('Sneha D.', 'Wanted price list for triple sharing. Mentioned budget around ₹7000. Asked about food and laundry charges.', 'price_query', 'orange', 95, 3),
    call('Rajiv M.', 'Existing tenant complained about hot water issue in morning. Asked for a fix within two days.', 'complaint', 'red', 218, 21),
    call('Kavya S.', 'Looking for single-sharing room for 3 months. Will visit this weekend.', 'room_vacancy', 'green', 110, 25),
    call('Rahul A.', 'Asked if any bed is free on the first floor. Wants to move in next week.', 'bed_vacancy', 'green', 75, 28),
    call('Priya N.', 'Asked about monthly rent for double sharing and the security deposit.', 'price_query', 'orange', 88, 33),
    call('Tenant 203', 'Wifi is slow in the evenings. Requested a router check.', 'complaint', 'orange', 130, 47),
    call('Imran S.', 'Requested an extra cupboard in his room.', 'request', 'green', 64, 52),
  ]


  // ---- tenants + payment history for every occupied bed ----
  const NAMES = ['Arjun Mehta', 'Divya Rao', 'Karthik S.', 'Neha Joshi', 'Rohit Verma', 'Sana Khan', 'Vikram Nair', 'Ananya P.', 'Imran Sheikh', 'Pooja Reddy', 'Manoj Kumar', 'Lakshmi V.', 'Aditya B.', 'Meera K.']
  const now = new Date()
  const monthStart = (shift) => new Date(now.getFullYear(), now.getMonth() + shift, 1)
  const ym = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
  const moveIn = ymd(new Date(now.getFullYear(), now.getMonth() - 2, 3))
  const tenants = []
  const payments = []
  let n = 0
  rooms.forEach((room) => {
    room.beds.forEach((bed) => {
      if (!bed.occupied) return
      const phone = '98450' + String(12300 + n * 37)
      const t = {
        id: uid(), property_id: room.property_id, bed_id: bed.id, name: NAMES[n % NAMES.length],
        phone, whatsapp: phone, email: '', rent_amount: room.price, deposit: room.price * 2,
        move_in: moveIn, due_day: 5, notes: '', status: 'active',
      }
      t.email = t.name.split(' ')[0].toLowerCase().replace(/[^a-z]/g, '') + '@example.com'
      tenants.push(t)
      // 0 = overdue (only first month paid), 1 = all paid, 2 = due this month, 3 = partly paid this month
      const kind = n % 4
      const months = kind === 0 ? [-2] : kind === 1 ? [-2, -1, 0] : [-2, -1]
      months.forEach((shift) => {
        const due = new Date(now.getFullYear(), now.getMonth() + shift, 5)
        const paidOn = due > now ? now : due
        payments.push({ id: uid(), property_id: room.property_id, tenant_id: t.id, amount: room.price, paid_on: ymd(paidOn), for_month: ym(monthStart(shift)), method: shift === -1 ? 'Cash' : 'UPI', note: '' })
      })
      if (kind === 3) {
        payments.push({ id: uid(), property_id: room.property_id, tenant_id: t.id, amount: Math.round(room.price / 2), paid_on: ymd(now), for_month: ym(monthStart(0)), method: 'UPI', note: 'Part payment' })
      }
      n += 1
    })
  })


  return { properties: [{ id: pg, name: 'Green Nest PG' }, { id: pg2, name: 'Lake View PG' }], rooms, complaints, calls, tenants, payments }
}
