/**
 * The Express application.
 *
 * Kept free of any `listen()` call so it can be driven two ways:
 *   - `server/index.ts` — a long-running process (local dev, Render, Railway)
 *   - `api/[[...path]].ts` — a serverless function (Vercel)
 */

import express, { type NextFunction, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { config } from './env.ts'
import { currentUser } from './auth.ts'
import { daysUntilReset, flush } from './db.ts'
import { storageLabel } from './storage.ts'
import { aiRouter } from './routes/ai.ts'
import { authRouter } from './routes/auth.ts'
import { practiceRouter } from './routes/practice.ts'
import { vocabularyRouter } from './routes/vocabulary.ts'

export interface AppOptions {
  /**
   * Serve the built frontend from Express. Off on Vercel, which serves the
   * static files itself and routes only `/api/*` to the function.
   */
  serveStatic?: boolean
  /**
   * Hold the response until pending writes have landed.
   *
   * On serverless the next request may hit a different instance, which would
   * then read the store before this one finished writing. Waiting costs a few
   * milliseconds and guarantees that anything the client has been told about
   * is already durable.
   */
  flushBeforeRespond?: boolean
}

export function createApp({
  serveStatic = true,
  flushBeforeRespond = false,
}: AppOptions = {}) {
  const app = express()

  app.disable('x-powered-by')
  // Behind a reverse proxy (Vercel, Render, Railway, nginx), so `req.ip` is
  // the real client address rather than the proxy's.
  app.set('trust proxy', 1)
  app.use(express.json({ limit: '64kb' }))
  app.use(cookieParser())

  if (flushBeforeRespond) {
    app.use((_req, res, next) => {
      const end = res.end.bind(res) as (...args: unknown[]) => unknown
      res.end = ((...args: unknown[]) => {
        // Send only once the store is durable; a failed write must still not
        // leave the request hanging.
        void flush().then(
          () => end(...args),
          () => end(...args),
        )
        return res
      }) as typeof res.end
      next()
    })
  }

  // Simple in-memory rate limiter — enough to blunt runaway loops and to keep
  // AI spend bounded. Keyed per signed-in user so that many people sharing one
  // IP (a school, an office, a mobile carrier) never throttle each other.
  //
  // On serverless this is per-instance rather than global, which makes it a
  // safety net rather than a hard guarantee. That is the right trade-off here:
  // its job is to stop bugs, not to fend off attackers.
  const WINDOW_MS = 60_000
  const MAX_REQUESTS = 300
  const hits = new Map<string, { count: number; resetAt: number }>()

  app.use('/api', (req, res, next) => {
    const user = currentUser(req)
    const key = user ? `u:${user.id}` : `ip:${req.ip ?? 'unknown'}`
    const now = Date.now()
    const record = hits.get(key)

    if (!record || record.resetAt < now) {
      // Opportunistic cleanup — cheap, and keeps the map bounded.
      if (hits.size > 5000) {
        for (const [existing, value] of hits) if (value.resetAt < now) hits.delete(existing)
      }
      hits.set(key, { count: 1, resetAt: now + WINDOW_MS })
    } else if (++record.count > MAX_REQUESTS) {
      res.status(429).json({
        error: 'Too many requests — give it a moment.',
        code: 'rate_limited',
        retryable: true,
      })
      return
    }
    next()
  })

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      ai: config.ai.enabled,
      storage: storageLabel(),
      daysUntilReset: daysUntilReset(),
    })
  })

  app.use('/api/auth', authRouter)
  app.use('/api/vocabulary', vocabularyRouter)
  app.use('/api/practice', practiceRouter)
  app.use('/api/ai', aiRouter)

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown endpoint.', code: 'not_found' })
  })

  // Outside serverless, the same process also serves the built frontend.
  const dist = resolve(config.root, 'dist')
  if (serveStatic && existsSync(dist)) {
    app.use(express.static(dist))
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(resolve(dist, 'index.html'))
    })
  }

  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[api] unhandled error:', error)
    if (res.headersSent) return
    res.status(500).json({ error: 'Something went wrong on the server.', code: 'internal' })
  })

  return app
}
