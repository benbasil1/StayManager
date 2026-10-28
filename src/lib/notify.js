// In-app alerts for new AI calls and new complaints/requests.
// Works while the app is open (also in a background tab or an installed app that is still running).
// Real push while the app is fully closed needs a push server, which is not part of this project.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const PREF_KEY = 'sm_notify'
const seenKey = (pid) => 'sm_seen_' + pid
const FRESH_MS = 10 * 60 * 1000

export const browserAlertsSupported = () => typeof Notification !== 'undefined'
export const alertsPref = () => {
  try { return localStorage.getItem(PREF_KEY) !== 'off' } catch { return true }
}
export const setAlertsPref = (on) => {
  try { localStorage.setItem(PREF_KEY, on ? 'on' : 'off') } catch { /* ignore */ }
}

function readSeen(pid) {
  try {
    const v = localStorage.getItem(seenKey(pid))
    if (v) return v
    const now = new Date().toISOString()
    localStorage.setItem(seenKey(pid), now)
    return now
  } catch {
    return new Date().toISOString()
  }
}

export function useInboxAlerts({ loading, propertyId, calls, complaints }, inboxOpen) {
  const [toasts, setToasts] = useState([])
  const [seen, setSeen] = useState(() => readSeen(propertyId))
  const known = useRef(null)

  const items = useMemo(
    () => [
      ...calls.map((c) => ({ id: 'call-' + c.id, at: c.created_at, title: 'New AI call', text: `${c.caller_name}: ${c.summary}` })),
      ...complaints.map((c) => ({ id: 'cmp-' + c.id, at: c.created_at, title: c.kind === 'request' ? 'New request' : 'New complaint', text: `${c.tenant_name}: ${c.message}` })),
    ],
    [calls, complaints]
  )

  useEffect(() => {
    known.current = null
    setSeen(propertyId ? readSeen(propertyId) : new Date().toISOString())
  }, [propertyId])

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), [])

  useEffect(() => {
    if (loading) return
    const ids = new Set(items.map((i) => i.id))
    if (known.current === null) { known.current = ids; return }
    const fresh = items.filter((i) => !known.current.has(i.id) && Date.now() - new Date(i.at).getTime() < FRESH_MS)
    known.current = ids
    if (!fresh.length || !alertsPref()) return
    fresh.forEach((i) => {
      setToasts((t) => [...t.slice(-3), { id: i.id, title: i.title, text: i.text }])
      setTimeout(() => dismiss(i.id), 8000)
      if (document.hidden && browserAlertsSupported() && Notification.permission === 'granted') {
        try { new Notification(i.title, { body: i.text, tag: i.id }) } catch { /* some browsers need a service worker */ }
      }
    })
  }, [items, loading, dismiss])

  const markSeen = useCallback(() => {
    const now = new Date().toISOString()
    try { if (propertyId) localStorage.setItem(seenKey(propertyId), now) } catch { /* ignore */ }
    setSeen(now)
  }, [propertyId])

  useEffect(() => {
    if (inboxOpen && !loading) markSeen()
  }, [inboxOpen, loading, items.length, markSeen])

  const unread = inboxOpen ? 0 : items.filter((i) => i.at && i.at > seen).length
  return { toasts, dismiss, unread }
}
