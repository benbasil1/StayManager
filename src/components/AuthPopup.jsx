// Handles the last step of a Google / Apple sign-in.
//
// Flow: the login page sends the browser to /api/auth/google/start (or /apple/start).
// The server talks to Google/Apple, then redirects back to /#/oauth?code=<single-use code>.
// This screen trades that code for a real session token and then reloads so the app
// sees the signed-in user.
//
// It is a full-page redirect, not a popup, because popups are blocked or broken in
// Android WebView (Capacitor) and in some installed-PWA contexts.
import { useEffect } from 'react'

export default function AuthPopup({ code, auth }) {
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!code) return
      try {
        const res = await fetch('/api/auth/oauth/exchange', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code }),
        })
        if (!res.ok) throw new Error('Could not finish signing in.')
        if (alive) {
          window.location.hash = ''
          window.location.reload()
        }
      } catch { /* fall back to a plain reload so the app can show an error */ }
    })()
    return () => { alive = false }
  }, [code])

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-logo" />
        <h1>Signing you in…</h1>
        <p className="muted">One moment while we finish setting up your account.</p>
      </div>
    </div>
  )
}
