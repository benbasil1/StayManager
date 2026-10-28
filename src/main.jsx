import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyPrefs } from './lib/prefs'

applyPrefs()

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)

// Makes the website installable as an app (production build only)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
