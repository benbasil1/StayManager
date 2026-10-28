import { useEffect, useRef, useState } from 'react'
import Icon from './Icon'
import { useData } from '../lib/store'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { fmtDay, intentLabel, parseNaturalDate, rupees, sharingName, statusLabel } from '../lib/utils'

const SUGGESTIONS = [
  'Which rooms have vacant beds?',
  'Summarize open complaints',
  'What is my monthly revenue?',
  'What are callers asking about?',
  'Occupancy by floor',
]

const USE_AI_FUNCTION = import.meta.env.VITE_USE_AI_FUNCTION === 'true'

const STOP = new Set(('show list give tell me the all only any of in on for to a an is are was what which who how many much my our and or with about please can you do does have has there their them those these this that '
  + 'complaint complaints complain compalints compalint request requests issue issues problem problems pending open progress resolved closed done fixed status high medium low priority').split(' '))

// Pulls status, priority and topic words out of a question like "show hot water complaints".
function parseComplaintQuery(t) {
  const status = /in[- ]?progress|progress|working/.test(t) ? 'in_progress'
    : /resolved|closed|done|fixed/.test(t) ? 'resolved'
    : /pending|unresolved|not resolved/.test(t) ? 'unresolved'
    : /\bopen\b|\bnew\b/.test(t) ? 'open' : null
  const priority = (t.match(/\b(high|medium|low)\b/) || [])[1] || null
  const words = t.replace(/[^a-z0-9₹ ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w))
  return { status, priority, words }
}

const complaintText = (c) => `${c.message} ${c.category || ''} ${c.tenant_name || ''}`.toLowerCase()
const wordHits = (c, words) => words.length > 0 && words.every((w) => complaintText(c).includes(w.length > 4 ? w.slice(0, 4) : w))

function looksLikeComplaintQuery(t, complaints) {
  if (/compl|compalint|issue|pending|open|progress|resolve|problem|request|maintenance|cleaning|priority|urgent/.test(t)) return true
  const { words } = parseComplaintQuery(t)
  return words.length > 0 && complaints.some((c) => wordHits(c, words))
}

function complaintAnswer(t, complaints) {
  if (!complaints.length) return 'There are no complaints or requests yet.'
  const { status, priority, words } = parseComplaintQuery(t)
  let list = complaints
  if (status === 'unresolved') list = list.filter((c) => c.status !== 'resolved')
  else if (status) list = list.filter((c) => c.status === status)
  if (priority) list = list.filter((c) => c.priority === priority)
  if (words.length) {
    const matched = list.filter((c) => wordHits(c, words))
    list = matched.length ? matched : list.filter((c) => words.some((w) => complaintText(c).includes(w.length > 4 ? w.slice(0, 4) : w)))
    if (!list.length) return `I found no complaints matching "${words.join(' ')}".`
  }
  if (!list.length) return 'Nothing matches that filter.'
  const count = (st) => list.filter((c) => c.status === st).length
  const head = status || priority || words.length
    ? `${list.length} matching: ${count('open')} open, ${count('in_progress')} in progress, ${count('resolved')} resolved.`
    : `${count('open')} open, ${count('in_progress')} in progress, ${count('resolved')} resolved.`
  return head + '\n' + list.map((c) => `• ${c.tenant_name} (${statusLabel[c.status]}): ${c.message}`).join('\n')
}

// "Rohit is leaving on 25 Oct" -> saves the leaving date on that tenant.
function leavingCommand(q, tenantRows, updateTenant) {
  const t = q.toLowerCase()
  if (!/leav|vacat|move out|moving out|shift out|check ?out/.test(t)) return null
  const date = parseNaturalDate(q)
  if (!date) return null
  const scored = tenantRows
    .map((r) => {
      const name = r.tenant.name.toLowerCase()
      const full = t.includes(name)
      const parts = name.split(/\s+/).filter((w) => w.length > 2 && t.includes(w))
      return { r, score: full ? 100 : parts.length }
    })
    .filter((x) => x.score > 0)
  if (!scored.length) return 'I could not tell which tenant that is. Say the name, for example: "Rohit is leaving on 25 Oct".'
  const best = Math.max(...scored.map((x) => x.score))
  const top = scored.filter((x) => x.score === best)
  if (top.length > 1) return `More than one tenant matches: ${top.map((x) => x.r.tenant.name).join(', ')}. Please use the full name.`
  const { tenant, room, bed } = top[0].r
  updateTenant(tenant.id, { leaving_on: date })
  return `Done. ${tenant.name} (Room ${room.room_no}, ${bed.label}) is leaving on ${fmtDay(date)}. The bed will show as free from that date.`
}

// Works offline with no AI key: answers straight from your own data.
function localAnswer(q, { rooms, complaints, calls, stats, property }) {
  const t = q.toLowerCase()

  if (/occupan|floor/.test(t)) {
    const floors = [...new Set(rooms.map((r) => r.floor))].sort((a, b) => a - b)
    const lines = floors.map((f) => {
      const beds = rooms.filter((r) => r.floor === f).flatMap((r) => r.beds)
      const filled = beds.filter((b) => b.occupied).length
      return `Floor ${f}: ${filled}/${beds.length} beds filled`
    })
    return `${property?.name || 'Your PG'} is ${stats.occupancy}% occupied (${stats.filled}/${stats.totalBeds} beds).\n${lines.join('\n')}`
  }

  if (/revenue|income|earn|money|rent collect/.test(t)) {
    return `Estimated monthly revenue is ${rupees(stats.revenue)} from ${stats.filled} occupied beds. If all ${stats.totalBeds} beds were filled it would be ${rupees(
      rooms.reduce((s, r) => s + r.price * r.beds.length, 0)
    )}.`
  }

  if (/vacan|free|empty|availab|bed/.test(t) && !/call|caller/.test(t)) {
    const withVacancy = rooms.filter((r) => r.beds.some((b) => !b.occupied))
    if (!withVacancy.length) return 'Every bed is filled right now.'
    return (
      `${stats.vacant} vacant beds across ${withVacancy.length} rooms:\n` +
      withVacancy
        .map((r) => `Room ${r.room_no} (Floor ${r.floor}, ${sharingName(r.beds.length)}): ${r.beds.filter((b) => !b.occupied).length} vacant, ${rupees(r.price)}/bed`)
        .join('\n')
    )
  }

  if (looksLikeComplaintQuery(t, complaints)) return complaintAnswer(t, complaints)

  if (/call|caller|intent|enquir|ask/.test(t)) {
    if (!calls.length) return 'No calls have been logged yet.'
    return (
      `${calls.length} calls logged. Top reasons people call:\n` +
      stats.intents.map(([i, n]) => `• ${intentLabel[i] || i}: ${n}`).join('\n')
    )
  }

  if (/price|cost|charge/.test(t)) {
    if (!rooms.length) return 'No rooms added yet.'
    const prices = rooms.map((r) => r.price)
    return `Rent per bed ranges from ${rupees(Math.min(...prices))} to ${rupees(Math.max(...prices))}.`
  }

  return 'I did not understand that. Without the AI service I can answer about vacancies, complaints (try "hot water complaints" or "only in progress"), revenue, occupancy, prices and call intents.'
}

export default function Assistant() {
  const data = useData()
  const [messages, setMessages] = useState([
    { from: 'bot', text: "Hi! I'm StayManager AI. Ask me anything about your PG: vacancies, complaints, revenue trends, call intents and more." },
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, busy])

  async function ask(question) {
    const q = question.trim()
    if (!q || busy) return
    setMessages((m) => [...m, { from: 'me', text: q }])
    setInput('')
    setBusy(true)
    let answer
    try {
      const leaveReply = leavingCommand(q, data.tenantRows, data.updateTenant)
      if (leaveReply) {
        answer = leaveReply
      } else if (USE_AI_FUNCTION && isSupabaseConfigured) {
        const context = {
          property: data.property?.name,
          stats: { ...data.stats, days: undefined },
          rooms: data.rooms.map((r) => ({ room: r.room_no, floor: r.floor, price: r.price, beds: r.beds.map((b) => b.occupied) })),
          complaints: data.complaints.slice(0, 40),
          calls: data.calls.slice(0, 40),
        }
        const { data: res, error } = await supabase.functions.invoke('assistant', { body: { question: q, context } })
        if (error) throw error
        answer = res.answer
      } else {
        await new Promise((r) => setTimeout(r, 450))
        answer = localAnswer(q, data)
      }
    } catch (e) {
      answer = 'I could not reach the AI service, so here is what I can see in your data:\n' + localAnswer(q, data)
    }
    setMessages((m) => [...m, { from: 'bot', text: answer }])
    setBusy(false)
  }

  return (
    <div className="assistant">
      <div className="assistant-head">
        <span className="assistant-logo"><Icon name="bot" size={26} /></span>
        <div>
          <h2>AI Assistant</h2>
          <p className="muted">Ask about your PG data</p>
        </div>
      </div>

      <div className="chat">
        {messages.map((m, i) => (
          <div key={i} className={'bubble ' + m.from}>{m.text}</div>
        ))}
        {busy && <div className="bubble bot typing"><i /><i /><i /></div>}
        <div ref={endRef} />
      </div>

      <div className="suggest">
        {SUGGESTIONS.map((s) => (
          <button key={s} className="suggest-chip" onClick={() => ask(s)}>{s}</button>
        ))}
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); ask(input) }}>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…" />
        <button className="send" aria-label="Send" disabled={!input.trim() || busy}><Icon name="send" size={22} /></button>
      </form>
    </div>
  )
}
