/**
 * Lexora API server — long-running process.
 *
 * Used for local development (`npm run dev`) and for hosts that run a real
 * server with a persistent disk (`npm start`). Node executes this TypeScript
 * directly, so there is no build step for the backend.
 *
 * On Vercel the same app is driven by `api/[[...path]].ts` instead.
 */

import { config } from './env.ts'
import { createApp } from './app.ts'
import { ensureAdminUser } from './auth.ts'
import { daysUntilReset, loadDatabase, startResetScheduler } from './db.ts'
import { storageLabel } from './storage.ts'

async function main(): Promise<void> {
  await loadDatabase()
  await ensureAdminUser()
  startResetScheduler()

  createApp().listen(config.port, () => {
    console.log(`[api] listening on http://localhost:${config.port}`)
    console.log(`[api] AI: ${config.ai.enabled ? `enabled (${config.ai.model})` : 'offline mode'}`)
    console.log(
      `[api] store: ${storageLabel()}` +
        (config.autoReset.enabled
          ? ` — auto-clears in ${daysUntilReset()} day(s)`
          : ' — auto-clear disabled'),
    )
  })
}

main().catch((error: unknown) => {
  console.error('[api] failed to start:', error)
  process.exit(1)
})
