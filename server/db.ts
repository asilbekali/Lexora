/**
 * JSON-file persistence layer.
 *
 * Everything the app knows lives in a single JSON document on disk, so a page
 * refresh (or a server restart) never loses data. The shape is deliberately
 * user-scoped (`userId` on every record) so this can be swapped for a real
 * database later without touching the route handlers.
 */

import { randomUUID } from 'node:crypto'

import { config } from './env.ts'
import { storage } from './storage.ts'
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

/**
 * Saves are coalesced rather than queued.
 *
 * Callers stay synchronous: they mutate `db` and mark it dirty. One write then
 * persists whatever the latest state is, so seeding ten words costs a single
 * round-trip instead of ten — and, more importantly, there is never a backlog
 * of stale snapshots waiting to overwrite newer data.
 */
let dirty = false
let writing: Promise<void> = Promise.resolve()

function writeIfDirty(): Promise<void> {
  if (!dirty) return Promise.resolve()
  dirty = false

  return storage()
    .write(JSON.stringify(db, null, 2))
    .catch((error: unknown) => {
      console.error('[db] failed to persist:', error)
    })
    // Anything marked dirty *during* the write gets its own pass.
    .then(() => writeIfDirty())
}

export function persist(): Promise<void> {
  dirty = true
  writing = writing.then(writeIfDirty)
  return writing
}

/** Resolves once every pending write has landed. */
export function flush(): Promise<void> {
  return writing
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

async function archive(): Promise<void> {
  if (!config.autoReset.archive) return
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    await storage().archive(JSON.stringify(db, null, 2), stamp)
  } catch (error) {
    console.error('[db] archive failed, continuing with reset:', error)
  }
}

/**
 * Clears vocabulary, attempts and counters while keeping user accounts.
 * Called automatically once the retention window elapses, and manually from
 * the admin endpoint.
 */
export async function resetStore(reason: 'scheduled' | 'manual'): Promise<void> {
  await archive()
  const now = new Date().toISOString()
  db.vocabulary = []
  db.attempts = []
  for (const user of db.users) {
    user.sessions = 0
    user.streak = { current: 0, lastPracticeDay: null }
  }
  db.lastResetAt = now
  await persist()
  console.log(`[db] store cleared (${reason}); next clear in ${config.autoReset.intervalDays} days`)
}

/** Clears the store if the retention window has already elapsed. */
export async function runScheduledResetIfDue(): Promise<boolean> {
  if (!config.autoReset.enabled) return false
  if (Date.now() < nextResetAt().getTime()) return false
  await resetStore('scheduled')
  return true
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

/**
 * Reads the store into memory.
 *
 * On a serverless host this runs on every request, so a warm instance never
 * serves state that another instance has already changed.
 */
export async function loadDatabase(): Promise<Database> {
  // Land anything still in flight before re-reading, or we would read our own
  // stale state and then write it back over the newer version.
  await flush()

  // Resolved outside the try: a misconfigured host must fail loudly rather
  // than quietly hand back an empty database and lose everyone's data.
  const driver = storage()

  try {
    const raw = await driver.read()
    db = raw === null ? emptyDatabase() : normalise(JSON.parse(raw))
  } catch (error) {
    console.error('[db] store is unreadable, starting fresh:', error)
    db = emptyDatabase()
  }

  // Only write when something actually changed — a plain read must never
  // touch the store.
  await runScheduledResetIfDue()
  return db
}

/** Checks the retention window hourly so long-running servers reset on time. */
export function startResetScheduler(): NodeJS.Timeout {
  const timer = setInterval(() => void runScheduledResetIfDue(), 60 * 60 * 1000)
  timer.unref()
  return timer
}

export function newId(): string {
  return randomUUID()
}
