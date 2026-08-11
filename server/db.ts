/**
 * JSON-file persistence layer.
 *
 * Everything the app knows lives in a single JSON document on disk, so a page
 * refresh (or a server restart) never loses data. The shape is deliberately
 * user-scoped (`userId` on every record) so this can be swapped for a real
 * database later without touching the route handlers.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { config } from './env.ts'
import type { PracticeAttempt, Vocabulary } from '../shared/types.ts'

export interface StoredUser {
  id: string
  username: string
  passwordHash: string
  createdAt: string
  /** The bootstrap account configured in .env. */
  isAdmin: boolean
  /**
   * Bumped on logout (and on a password change) so any session token issued
   * earlier stops being accepted, even though tokens are otherwise stateless.
   */
  sessionEpoch: number

  /* Per-user progress. Never shared between accounts. */
  sessions: number
  streak: {
    current: number
    /** ISO date (YYYY-MM-DD) of this user's most recent practice. */
    lastPracticeDay: string | null
  }
}

export interface Database {
  version: number
  createdAt: string
  /** Start of the current retention window; drives the monthly auto-clear. */
  lastResetAt: string
  users: StoredUser[]
  vocabulary: Vocabulary[]
  attempts: PracticeAttempt[]
}

const DAY_MS = 24 * 60 * 60 * 1000

function emptyDatabase(): Database {
  const now = new Date().toISOString()
  return {
    version: 1,
    createdAt: now,
    lastResetAt: now,
    users: [],
    vocabulary: [],
    attempts: [],
  }
}

let db: Database = emptyDatabase()
let writeChain: Promise<void> = Promise.resolve()

function ensureDir(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
}

/** Write via a temp file + rename so a crash can never truncate the store. */
function writeNow(): void {
  ensureDir(config.dataFile)
  const tmp = `${config.dataFile}.${process.pid}.tmp`
  writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8')
  renameSync(tmp, config.dataFile)
}

/** Queues a save; callers may await it but usually don't need to. */
export function persist(): Promise<void> {
  writeChain = writeChain.then(
    () =>
      new Promise<void>((resolve) => {
        try {
          writeNow()
        } catch (error) {
          console.error('[db] failed to persist:', error)
        }
        resolve()
      }),
  )
  return writeChain
}

export function getDb(): Database {
  return db
}

function normalise(raw: unknown): Database {
  const base = emptyDatabase()
  if (!raw || typeof raw !== 'object') return base
  const value = raw as Partial<Database>
  return {
    ...base,
    ...value,
    // Fill in fields added after a store was first written.
    users: (Array.isArray(value.users) ? value.users : []).map((user) => ({
      ...user,
      isAdmin: user.isAdmin ?? false,
      sessionEpoch: typeof user.sessionEpoch === 'number' ? user.sessionEpoch : 1,
      sessions: typeof user.sessions === 'number' ? user.sessions : 0,
      streak: user.streak ?? { current: 0, lastPracticeDay: null },
    })),
    vocabulary: (Array.isArray(value.vocabulary) ? value.vocabulary : []).map((word) => ({
      ...word,
      image: word.image ?? null,
      imageSearched: word.imageSearched ?? false,
    })),
    attempts: Array.isArray(value.attempts) ? value.attempts : [],
    lastResetAt: value.lastResetAt ?? base.lastResetAt,
  }
}

// ---------------------------------------------------------------------------
// Monthly auto-clear
// ---------------------------------------------------------------------------

export function nextResetAt(): Date {
  return new Date(
    new Date(db.lastResetAt).getTime() + config.autoReset.intervalDays * DAY_MS,
  )
}

export function daysUntilReset(): number {
  const ms = nextResetAt().getTime() - Date.now()
  return Math.max(0, Math.ceil(ms / DAY_MS))
}

function archive(): void {
  if (!config.autoReset.archive) return
  try {
    mkdirSync(config.archiveDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    writeFileSync(
      join(config.archiveDir, `db-${stamp}.json`),
      JSON.stringify(db, null, 2),
      'utf8',
    )
  } catch (error) {
    console.error('[db] archive failed, continuing with reset:', error)
  }
}

/**
 * Clears vocabulary, attempts and counters while keeping user accounts.
 * Called automatically once the retention window elapses, and manually from
 * the admin endpoint.
 */
export function resetStore(reason: 'scheduled' | 'manual'): void {
  archive()
  const now = new Date().toISOString()
  db.vocabulary = []
  db.attempts = []
  for (const user of db.users) {
    user.sessions = 0
    user.streak = { current: 0, lastPracticeDay: null }
  }
  db.lastResetAt = now
  persist()
  console.log(`[db] store cleared (${reason}); next clear in ${config.autoReset.intervalDays} days`)
}

/** Clears the store if the retention window has already elapsed. */
export function runScheduledResetIfDue(): boolean {
  if (!config.autoReset.enabled) return false
  if (Date.now() < nextResetAt().getTime()) return false
  resetStore('scheduled')
  return true
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function loadDatabase(): Database {
  if (existsSync(config.dataFile)) {
    try {
      db = normalise(JSON.parse(readFileSync(config.dataFile, 'utf8')))
    } catch (error) {
      console.error('[db] store is unreadable, starting fresh:', error)
      db = emptyDatabase()
    }
  } else {
    db = emptyDatabase()
  }

  runScheduledResetIfDue()
  persist()
  return db
}

/** Checks the retention window hourly so long-running servers reset on time. */
export function startResetScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => runScheduledResetIfDue(), 60 * 60 * 1000)
  timer.unref()
  return timer
}

export function newId(): string {
  return randomUUID()
}
