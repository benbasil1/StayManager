import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import { applyPrefs } from './lib/prefs'

applyPrefs()

// Last safety net: if a screen crashes, show a clear message with a way out instead of a blank page.
class ErrorBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error) {
    console.error(error)
    // After a new version is published, an old open tab can fail to load a screen: reload once to get the new version.
    if (/dynamically imported module|importing a module script failed|loading chunk/i.test(String(error?.message || error))) {
      try {
        if (!sessionStorage.getItem('sm_reloaded')) {
          sessionStorage.setItem('sm_reloaded', '1')
          window.location.reload()
        }
      } catch { /* ignore */ }
    }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="login-wrap">
        <div className="login-card">
          <h1>Something went wrong</h1>
          <p className="muted">Your data is safe. Reload the page to continue.</p>
          <div className="login-form">
            <button className="btn primary block" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      </div>
    )
  }
}

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)

// Makes the website installable as an app (production build only)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}
