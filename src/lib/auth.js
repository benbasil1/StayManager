import { useCallback, useEffect, useState } from 'react'
import { isSupabaseConfigured, supabase } from './supabase'

const DEMO_SESSION = 'sm_demo_session'

export function useAuth() {
  const [session, setSession] = useState(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isSupabaseConfigured) {
      setSession(localStorage.getItem(DEMO_SESSION) ? { email: 'demo@staymanager.app', name: 'Demo' } : null)
      setReady(true)
      return
    }
    const toSession = (s) =>
      s ? { email: s.user.email, name: (s.user.email || 'Owner').split('@')[0].replace(/^./, (c) => c.toUpperCase()) } : null
    supabase.auth.getSession().then(({ data }) => {
      setSession(toSession(data.session))
      setReady(true)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setSession(toSession(s)))
    return () => sub.subscription.unsubscribe()
  }, [])

  const demoLogin = useCallback(() => {
    localStorage.setItem(DEMO_SESSION, '1')
    setSession({ email: 'demo@staymanager.app', name: 'Demo' })
  }, [])

  const signIn = useCallback(async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
  }, [])

  const signUp = useCallback(async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    // If email confirmation is ON in Supabase, there is no session yet.
    return { needsConfirmation: !data.session }
  }, [])

  // The server checks the current password itself, then sets the new one.
  const changePassword = useCallback(async (current, next) => {
    if (!isSupabaseConfigured) throw new Error('Demo mode has no password. Turn demo mode off to use this.')
    const { error } = await supabase.auth.updateUser({ password: next, current_password: current })
    if (error) throw error
  }, [])

  const signOut = useCallback(async () => {
    if (!isSupabaseConfigured) {
      localStorage.removeItem(DEMO_SESSION)
      setSession(null)
      return
    }
    await supabase.auth.signOut()
  }, [])

  return { session, ready, demoLogin, signIn, signUp, signOut, changePassword }
}
