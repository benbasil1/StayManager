import { useSyncExternalStore } from 'react'

const KEY = 'sm_prefs'
const DEFAULTS = { theme: 'auto', size: 'md' }
export const SIZES = { sm: '90%', md: '100%', lg: '115%', xl: '130%' }

function load() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') } } catch { return { ...DEFAULTS } }
}

let prefs = load()
const listeners = new Set()
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null

// Writes the chosen theme and text size onto <html>. "auto" follows the device setting.
export function applyPrefs() {
  const dark = prefs.theme === 'dark' || (prefs.theme === 'auto' && !!mq && mq.matches)
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  root.style.fontSize = SIZES[prefs.size] || '100%'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', dark ? '#0f1511' : '#1f3a2b')
}

export function setPref(key, value) {
  prefs = { ...prefs, [key]: value }
  try { localStorage.setItem(KEY, JSON.stringify(prefs)) } catch { /* private mode: keep in memory */ }
  applyPrefs()
  listeners.forEach((fn) => fn())
}

if (mq && mq.addEventListener) mq.addEventListener('change', () => { if (prefs.theme === 'auto') applyPrefs() })

const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn) }
export const usePrefs = () => useSyncExternalStore(subscribe, () => prefs)
