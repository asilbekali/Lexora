import { Router } from 'express'

import {
  clearSession,
  communityStats,
  currentUser,
  issueSession,
  registerUser,
  requireAuth,
  verifyCredentials,
} from '../auth.ts'
import { loginSchema, validate } from '../validation.ts'

export const authRouter = Router()

/**
 * Public counts for the sign-in screen. Deliberately just totals — no
 * usernames, no per-user detail.
 */
authRouter.get('/community', (_req, res) => {
  res.json(communityStats())
})

authRouter.get('/me', (req, res) => {
  const user = currentUser(req)
  if (!user) {
    res.status(401).json({ error: 'Not signed in.', code: 'unauthorized' })
    return
  }
  res.json({ user })
})

authRouter.post('/login', validate(loginSchema), async (req, res) => {
  const { username, password } = req.body as { username: string; password: string }

  const user = await verifyCredentials(username, password)
  if (!user) {
    // One message for both cases — don't reveal which half was wrong.
    res.status(401).json({ error: 'Incorrect username or password.', code: 'bad_credentials' })
    return
  }

  issueSession(res, user)
  res.json({ user })
})

/** Creates a normal account and signs it straight in. */
authRouter.post('/register', validate(loginSchema), async (req, res) => {
  const { username, password } = req.body as { username: string; password: string }

  const result = await registerUser(username, password)
  if (!result.ok) {
    res.status(409).json({ error: result.error, code: 'registration_failed' })
    return
  }

  issueSession(res, result.user)
  res.status(201).json({ user: result.user })
})

authRouter.post('/logout', requireAuth, (req, res) => {
  clearSession(res, req.user!.id)
  res.json({ ok: true })
})
