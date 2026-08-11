import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { ApiError, api, errorMessage } from '../lib/api.ts'
import { AuthContext, type AuthState } from './auth-context.ts'
import type { User } from '../../shared/types.ts'

/**
 * Session state. The session itself lives in an httpOnly cookie the browser
 * can't read — this only tracks who the server says we are.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<AuthState['status']>('loading')
  const [error, setError] = useState<string | null>(null)

  // Restore the session on load.
  useEffect(() => {
    let cancelled = false

    api.auth
      .me()
      .then(({ user: restored }) => {
        if (cancelled) return
        setUser(restored)
        setStatus('authenticated')
      })
      .catch((cause) => {
        if (cancelled) return
        setUser(null)
        setStatus('anonymous')
        // A 401 here is the normal "not signed in yet" case, not an error.
        if (cause instanceof ApiError && !cause.isUnauthorized) setError(cause.message)
      })

    return () => {
      cancelled = true
    }
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    setError(null)
    try {
      const { user: signedIn } = await api.auth.login(username, password)
      setUser(signedIn)
      setStatus('authenticated')
    } catch (cause) {
      setError(errorMessage(cause))
      throw cause
    }
  }, [])

  const register = useCallback(async (username: string, password: string) => {
    setError(null)
    try {
      const { user: created } = await api.auth.register(username, password)
      setUser(created)
      setStatus('authenticated')
    } catch (cause) {
      setError(errorMessage(cause))
      throw cause
    }
  }, [])

  const logout = useCallback(async () => {
    try {
      await api.auth.logout()
    } finally {
      setUser(null)
      setStatus('anonymous')
    }
  }, [])

  const value = useMemo<AuthState>(
    () => ({ user, status, error, login, register, logout }),
    [user, status, error, login, register, logout],
  )

  return <AuthContext value={value}>{children}</AuthContext>
}
