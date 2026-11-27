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
import { supabase } from '../lib/supabase'

export default function AuthPopup({ code, auth }) {
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!code) return
      const { error } = await supabase.auth.exchangeOauthCode(code, true)
      if (!alive) return
      // exchangeOauthCode saves the session; reload so the app picks it up
      window.location.hash = error ? '#/login?error=' + encodeURIComponent(error.message || 'Could not finish signing in.') : ''
      window.location.reload()
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
