/**
 * Vercel serverless entry point.
 *
 * Vercel serves `dist/` statically and routes every `/api/*` request here.
 * This file is the reason the API exists in production — without it Vercel
 * only sees a static site and answers 404 to every endpoint.
 *
 * Three things differ from the long-running server:
 *
 *   1. The store is re-read on every request. Instances are recycled and run
 *      concurrently, so in-memory state from a previous invocation cannot be
 *      trusted.
 *   2. Pending writes are flushed *before* the handler resolves. Vercel may
 *      freeze the instance the moment the response finishes, which would
 *      otherwise drop the write.
 *   3. Express does not serve static files — Vercel already did.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'

import { createApp } from '../server/app.ts'
import { ensureAdminUser } from '../server/auth.ts'
import { flush, loadDatabase } from '../server/db.ts'

const app = createApp({ serveStatic: false, flushBeforeRespond: true })

/** The admin bootstrap only needs to run once per warm instance. */
let adminReady: Promise<void> | null = null

function ensureAdmin(): Promise<void> {
  adminReady ??= ensureAdminUser().catch((error: unknown) => {
    // Let the next request try again rather than caching the failure.
    adminReady = null
    throw error
  })
  return adminReady
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  try {
    await loadDatabase()
    await ensureAdmin()
  } catch (error) {
    console.error('[api] startup failed:', error)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : 'The server could not start.',
        code: 'startup_failed',
      }),
    )
    return
  }

  // Hand off to Express, then wait for the response to be fully written.
  await new Promise<void>((resolve) => {
    res.on('finish', resolve)
    res.on('close', resolve)
    app(req as never, res as never)
  })

  // The response middleware already waited for the store; this is the
  // belt-and-braces pass for anything queued after the response was sent.
  await flush()
}
