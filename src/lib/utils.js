// Always returns a valid RFC 4122 v4 UUID (the database columns are type uuid).
// crypto.randomUUID only exists on HTTPS/localhost, so fall back to
// getRandomValues (works on plain http too), then to Math.random.
export const uid = () => {
  const c = typeof crypto !== 'undefined' ? crypto : null
  if (c && c.randomUUID) return c.randomUUID()
  const b = new Uint8Array(16)
  if (c && c.getRandomValues) c.getRandomValues(b)
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256)
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

export const rupees = (n) => '₹' + Number(n || 0).toLocaleString('en-IN')

export const sharingName = (count) =>
  ({ 1: 'Single Sharing', 2: 'Double Sharing', 3: 'Triple Sharing', 4: 'Quad Sharing' }[count] ||
  `${count} Sharing`)

export const intentLabel = {
  bed_vacancy: 'Bed Vacancy',
  room_vacancy: 'Room Vacancy',
  price_query: 'Price Query',
  complaint: 'Complaint',
  request: 'Request',
  other: 'Other',
}

export const statusLabel = { open: 'Open', in_progress: 'In progress', resolved: 'Resolved' }
export const kindLabel = { request: 'Request', query: 'Query', complaint: 'Complaint' }
export const rentStatusLabel = { paid: 'Paid', due: 'Due', overdue: 'Overdue' }

export function fmtDuration(sec = 0) {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

export function fmtDateTime(iso) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}, ${d.toLocaleTimeString('en-US')}`
}

export function fmtDate(iso) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`
}

// ---------- plain dates (YYYY-MM-DD) ----------
const pad = (n) => String(n).padStart(2, '0')
export const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const todayStr = () => ymd(new Date())
export const parseDay = (s) => new Date(String(s).slice(0, 10) + 'T00:00:00')
export const fmtDay = (s) => (s ? parseDay(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '-')
export const fmtMonth = (ym) =>
  new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: 'numeric' })

// ---------- phone / WhatsApp ----------
export function waLink(phone, text) {
  const digits = String(phone || '').replace(/\D/g, '')
  const num = digits.length === 10 ? '91' + digits : digits
  return `https://wa.me/${num}` + (text ? `?text=${encodeURIComponent(text)}` : '')
}

// ---------- rent maths ----------
// Rent is due every month from the move-in month up to the current month.
// Payments are applied to the oldest unpaid month first.
export function rentSummary(tenant, payments) {
  const today = parseDay(todayStr())
  const rent = Number(tenant.rent_amount) || 0
  const dueDay = tenant.due_day || 5
  const start = parseDay(tenant.move_in || todayStr())

  const dueDates = []
  let y = start.getFullYear()
  let m = start.getMonth()
  while (y < today.getFullYear() || (y === today.getFullYear() && m <= today.getMonth())) {
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    dueDates.push(new Date(y, m, Math.min(dueDay, daysInMonth)))
    m += 1
    if (m > 11) { m = 0; y += 1 }
  }

  const paid = payments.reduce((s, p) => s + Number(p.amount), 0)
  const expected = rent * dueDates.length
  let left = paid
  let firstUnpaid = null
  let pastUnpaid = false
  let unpaidMonths = 0
  dueDates.forEach((d) => {
    if (left >= rent) {
      left -= rent
    } else {
      unpaidMonths += 1
      if (!firstUnpaid) firstUnpaid = d
      if (d < today) pastUnpaid = true
    }
  })

  const due = Math.max(0, expected - paid)
  const status = due <= 0 ? 'paid' : pastUnpaid ? 'overdue' : 'due'
  return { paid, expected, due, status, dueDate: firstUnpaid ? ymd(firstUnpaid) : null, unpaidMonths }
}

const dayKey = (d) => {
  const x = new Date(d)
  return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}`
}

export function computeStats(rooms, calls, complaints, rowByBed = {}) {
  const beds = rooms.flatMap((r) => r.beds)
  const filled = beds.filter((b) => b.occupied).length
  // Revenue: each occupied bed pays its tenant's rent (falls back to the room price if no tenant is recorded)
  const revenue = rooms.reduce(
    (sum, r) =>
      sum + r.beds.filter((b) => b.occupied).reduce((s, b) => s + (Number(rowByBed[b.id]?.tenant.rent_amount) || r.price), 0),
    0
  )

  // Last 7 days (oldest -> today)
  const days = []
  for (let i = 6; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    days.push({ key: dayKey(d), label: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, count: 0 })
  }
  calls.forEach((c) => {
    const slot = days.find((d) => d.key === dayKey(c.created_at))
    if (slot) slot.count += 1
  })
  const totalCalls = days.reduce((s, d) => s + d.count, 0)

  const intents = {}
  calls.forEach((c) => {
    intents[c.intent] = (intents[c.intent] || 0) + 1
  })

  return {
    totalRooms: rooms.length,
    totalBeds: beds.length,
    filled,
    vacant: beds.length - filled,
    occupancy: beds.length ? Math.round((filled / beds.length) * 100) : 0,
    revenue,
    days,
    totalCalls,
    intents: Object.entries(intents).sort((a, b) => b[1] - a[1]),
    openIssues: complaints.filter((c) => c.status === 'open').length,
  }
}

// ---------- leaving dates ----------
export const daysUntil = (s) => Math.round((parseDay(s) - parseDay(todayStr())) / 86400000)
export function leavingText(s) {
  const d = daysUntil(s)
  if (d < 0) return `left date passed (${fmtDay(s)})`
  if (d === 0) return 'leaving today'
  if (d === 1) return 'leaving tomorrow'
  return `leaving ${fmtDay(s)} (in ${d} days)`
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
// Understands "25 oct", "oct 25 2026", "2026-10-25", "25/10/2026", "today", "tomorrow", "in 10 days"
export function parseNaturalDate(text) {
  const t = text.toLowerCase()
  const today = parseDay(todayStr())
  const make = (y, m, d) => {
    const dt = new Date(y, m, d)
    return dt.getMonth() === m && dt.getDate() === d ? dt : null
  }
  const fix = (dt, hadYear) => {
    if (!dt) return null
    if (!hadYear && dt < today) dt.setFullYear(dt.getFullYear() + 1)
    return ymd(dt)
  }
  let m
  if ((m = t.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))) return fix(make(+m[1], +m[2] - 1, +m[3]), true)
  if ((m = t.match(/\b(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2,4})\b/))) return fix(make(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[2] - 1, +m[1]), true)
  if ((m = t.match(new RegExp('\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:of\\s+)?(' + MONTHS.join('|') + ')[a-z]*\\.?(?:,?\\s*(\\d{4}))?')))) {
    return fix(make(m[3] ? +m[3] : today.getFullYear(), MONTHS.indexOf(m[2]), +m[1]), !!m[3])
  }
  if ((m = t.match(new RegExp('\\b(' + MONTHS.join('|') + ')[a-z]*\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s*(\\d{4}))?')))) {
    return fix(make(m[3] ? +m[3] : today.getFullYear(), MONTHS.indexOf(m[1]), +m[2]), !!m[3])
  }
  const add = (n) => { const dt = new Date(today); dt.setDate(dt.getDate() + n); return ymd(dt) }
  if (/day after tomorrow/.test(t)) return add(2)
  if (/tomorrow/.test(t)) return add(1)
  if (/\btoday\b/.test(t)) return add(0)
  if ((m = t.match(/in (\d{1,3}) days?/))) return add(+m[1])
  return null
}
export const fmtShort = (s) => (s ? parseDay(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '')