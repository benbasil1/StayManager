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

  // Re-checks the current password, then sets the new one (Supabase accounts only).
  const changePassword = useCallback(async (current, next) => {
    if (!isSupabaseConfigured) throw new Error('Demo mode has no password. Connect Supabase to use this.')
    const { data } = await supabase.auth.getSession()
    const email = data.session?.user?.email
    if (!email) throw new Error('You are signed out. Please sign in again.')
    const { error: bad } = await supabase.auth.signInWithPassword({ email, password: current })
    if (bad) throw new Error('Current password is incorrect.')
    const { error } = await supabase.auth.updateUser({ password: next })
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
