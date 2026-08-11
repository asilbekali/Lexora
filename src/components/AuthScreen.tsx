import { useEffect, useState, type FormEvent } from 'react'

import { api } from '../lib/api.ts'
import { useAuth } from '../hooks/useAuth.ts'
import { Button } from './ui/Button.tsx'
import { Card } from './ui/Card.tsx'
import { Input } from './ui/Input.tsx'
import { Alert } from './ui/Alert.tsx'
import { Logo } from './Logo.tsx'
import { Footer } from './Footer.tsx'
import type { CommunityStats } from '../../shared/types.ts'

type Mode = 'login' | 'register'

export function AuthScreen() {
  const { login, register, error } = useAuth()

  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [community, setCommunity] = useState<CommunityStats | null>(null)

  // Public counts — how many people are learning here.
  useEffect(() => {
    let cancelled = false
    api.auth
      .community()
      .then((stats) => {
        if (!cancelled) setCommunity(stats)
      })
      .catch(() => {
        // Purely decorative; silence is fine.
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return

    setSubmitting(true)
    try {
      if (mode === 'login') await login(username, password)
      else await register(username, password)
    } catch {
      // The provider surfaces the message; keep the form usable.
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  const isRegister = mode === 'register'

  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm animate-rise">
          <div className="mb-7 flex flex-col items-center text-center">
            <Logo className="size-11" />
            <h1 className="mt-4 text-2xl font-semibold tracking-tight">Lexora</h1>
            <p className="mt-1.5 text-sm text-ink-2">Learn the meaning. Nail the spelling.</p>

            {community && (
              <p className="mt-4 flex items-center gap-2 rounded-full bg-surface-2 px-3.5 py-1.5 text-xs text-ink-2">
                <span
                  aria-hidden="true"
                  className="inline-block size-1.5 rounded-full bg-success"
                />
                <strong className="font-semibold text-ink tabular-nums">
                  {community.users}
                </strong>
                {community.users === 1 ? 'learner' : 'learners'}
                <span aria-hidden="true" className="text-ink-3">
                  ·
                </span>
                <strong className="font-semibold text-ink tabular-nums">
                  {community.words}
                </strong>
                words
              </p>
            )}
          </div>

          <Card className="p-6">
            {/* Mode switch */}
            <div
              role="tablist"
              aria-label="Sign in or create an account"
              className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1"
            >
              {(['login', 'register'] as Mode[]).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={mode === value}
                  onClick={() => setMode(value)}
                  className={`rounded-lg py-2 text-sm font-medium transition-colors ${
                    mode === value
                      ? 'bg-surface text-ink shadow-sm'
                      : 'text-ink-2 hover:text-ink'
                  }`}
                >
                  {value === 'login' ? 'Sign in' : 'Create account'}
                </button>
              ))}
            </div>

            <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="username" className="text-sm font-medium">
                  Username
                </label>
                <Input
                  id="username"
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  required
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder={isRegister ? 'pick a username' : 'your username'}
                />
                {isRegister && (
                  <p className="text-xs text-ink-3">
                    At least 3 characters — letters, numbers, . _ -
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-1.5">
                <label htmlFor="password" className="text-sm font-medium">
                  Password
                </label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                />
                {isRegister && (
                  <p className="text-xs text-ink-3">At least 8 characters.</p>
                )}
              </div>

              {error && <Alert tone="error">{error}</Alert>}

              <Button
                type="submit"
                size="lg"
                loading={submitting}
                disabled={!username || !password}
                className="mt-1 w-full"
              >
                {submitting
                  ? isRegister
                    ? 'Creating account…'
                    : 'Signing in…'
                  : isRegister
                    ? 'Create account'
                    : 'Sign in'}
              </Button>
            </form>
          </Card>

          <p className="mt-5 text-center text-xs leading-relaxed text-ink-3">
            {isRegister
              ? 'Your word list is private to your account.'
              : 'Passwords are verified on the server and stored as scrypt hashes.'}
          </p>
        </div>
      </main>

      <Footer />
    </div>
  )
}
