/**
 * Environment configuration.
 *
 * Every secret lives here and nowhere else. Nothing in this file is ever
 * shipped to the browser — the frontend talks to the API, the API talks to
 * the AI provider.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')

// `.env` first, then `.env.local` so local overrides win.
for (const file of ['.env', '.env.local']) {
  const path = resolve(root, file)
  if (existsSync(path)) process.loadEnvFile(path)
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function int(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

const isProduction = process.env.NODE_ENV === 'production'

/** A stable dev secret keeps you logged in across server restarts. */
function sessionSecret(): string {
  const fromEnv = process.env.SESSION_SECRET
  if (fromEnv && fromEnv.length >= 16) return fromEnv
  if (isProduction) {
    throw new Error('SESSION_SECRET must be set (min 16 chars) in production.')
  }
  console.warn(
    '[env] SESSION_SECRET is not set — using an ephemeral dev secret. ' +
      'Sessions will not survive a server restart.',
  )
  return randomBytes(32).toString('hex')
}

export const config = {
  root,
  isProduction,
  port: int(process.env.PORT, 8787),

  dataFile: resolve(root, process.env.DATA_FILE ?? 'server/data/db.json'),
  archiveDir: resolve(root, process.env.ARCHIVE_DIR ?? 'server/data/archive'),

  session: {
    secret: sessionSecret(),
    cookieName: 'lexora_session',
    maxAgeMs: int(process.env.SESSION_MAX_AGE_HOURS, 12) * 60 * 60 * 1000,
  },

  admin: {
    username: process.env.ADMIN_USERNAME ?? 'asilbek',
    /** Preferred: a scrypt hash produced by `npm run hash-password`. */
    passwordHash: process.env.ADMIN_PASSWORD_HASH ?? '',
    /** Dev convenience: hashed in memory at boot, never persisted as plaintext. */
    password: process.env.ADMIN_PASSWORD ?? '',
  },

  /** Google Gemini (Generative Language API). */
  ai: {
    apiKey: process.env.GEMINI_API_KEY ?? '',
    baseUrl: (
      process.env.GEMINI_BASE_URL ?? 'https://generativelanguage.googleapis.com/v1beta'
    ).replace(/\/$/, ''),
    model: process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite',
    /** "low" skips the thinking budget — right for short lookups, and cheaper. */
    thinkingLevel: process.env.GEMINI_THINKING_LEVEL ?? 'low',
    timeoutMs: int(process.env.AI_TIMEOUT_MS, 20_000),
    maxRetries: int(process.env.AI_MAX_RETRIES, 2),
    get enabled() {
      return this.apiKey.length > 0
    },
  },

  /** Free, keyless illustration lookup for flashcards. */
  images: {
    enabled: bool(process.env.IMAGES_ENABLED, true),
    timeoutMs: int(process.env.IMAGES_TIMEOUT_MS, 8000),
  },

  /** Monthly housekeeping: wipe the vocabulary store on a fixed cadence. */
  autoReset: {
    enabled: bool(process.env.AUTO_RESET_ENABLED, true),
    intervalDays: int(process.env.AUTO_RESET_DAYS, 30),
    /** Keep a timestamped copy before clearing. */
    archive: bool(process.env.AUTO_RESET_ARCHIVE, true),
  },
} as const
