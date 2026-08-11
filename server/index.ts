/**
 * Lexora API server.
 *
 * Run with `npm run server` (or `npm run dev` for API + Vite together).
 * Node executes this TypeScript directly — no build step.
 */

import express, { type NextFunction, type Request, type Response } from 'express'
import cookieParser from 'cookie-parser'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

import { config } from './env.ts'
import { currentUser, ensureAdminUser } from './auth.ts'
import { daysUntilReset, loadDatabase, startResetScheduler } from './db.ts'
import { aiRouter } from './routes/ai.ts'
import { authRouter } from './routes/auth.ts'
import { practiceRouter } from './routes/practice.ts'
import { vocabularyRouter } from './routes/vocabulary.ts'

const app = express()

app.disable('x-powered-by')
// Behind a reverse proxy (Render, Railway, Fly, nginx), so `req.ip` is the
// real client address rather than the proxy's.
app.set('trust proxy', 1)
app.use(express.json({ limit: '64kb' }))
app.use(cookieParser())

// Simple in-memory rate limiter — enough to blunt runaway loops and to keep
// AI spend bounded. Keyed per signed-in user so that many people sharing one
// IP (a school, an office, a mobile carrier) never throttle each other.
const WINDOW_MS = 60_000
const MAX_REQUESTS = 300
const hits = new Map<string, { count: number; resetAt: number }>()

// Drop expired buckets periodically so the map cannot grow without bound.
setInterval(() => {
  const now = Date.now()
  for (const [key, record] of hits) if (record.resetAt < now) hits.delete(key)
}, WINDOW_MS).unref()

app.use('/api', (req, res, next) => {
  const user = currentUser(req)
  const key = user ? `u:${user.id}` : `ip:${req.ip ?? 'unknown'}`
  const now = Date.now()
  const record = hits.get(key)

  if (!record || record.resetAt < now) {
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

// In production the API also serves the built frontend.
const dist = resolve(config.root, 'dist')
if (existsSync(dist)) {
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

async function main(): Promise<void> {
  loadDatabase()
  await ensureAdminUser()
  startResetScheduler()

  app.listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port}`)
    console.log(`[api] AI: ${config.ai.enabled ? `enabled (${config.ai.model})` : 'offline mode'}`)
    console.log(
      `[api] store: ${config.dataFile}` +
        (config.autoReset.enabled
          ? ` — auto-clears in ${daysUntilReset()} day(s)`
          : ' — auto-clear disabled'),
    )
  })
}

main().catch((error) => {
  console.error('[api] failed to start:', error)
  process.exit(1)
})
