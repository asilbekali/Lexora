/**
 * Authentication.
 *
 * Intentionally small and provider-shaped: a `verifyCredentials` function, a
 * stateless signed session cookie, and a `requireAuth` middleware. Swapping in
 * Auth0/Clerk/NextAuth later means replacing this file, not the routes.
 *
 * Passwords are stored as scrypt hashes — never plaintext, never in the client.
 */

import {
  createHmac,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto'
import { promisify } from 'node:util'
import type { NextFunction, Request, Response } from 'express'

import { config } from './env.ts'
import { getDb, newId, persist, type StoredUser } from './db.ts'
import type { CommunityStats, User } from '../shared/types.ts'

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64

declare module 'express-serve-static-core' {
  interface Request {
    user?: User
  }
}

// ---------------------------------------------------------------------------
// Password hashing
// ---------------------------------------------------------------------------

/** Produces `scrypt$<saltHex>$<hashHex>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scrypt(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false

  const expected = Buffer.from(hashHex, 'hex')
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

// ---------------------------------------------------------------------------
// Admin bootstrap
// ---------------------------------------------------------------------------

/**
 * Ensures the configured administrator exists, hashing `ADMIN_PASSWORD` at
 * boot when a pre-computed `ADMIN_PASSWORD_HASH` isn't supplied.
 */
export async function ensureAdminUser(): Promise<void> {
  const db = getDb()
  const username = config.admin.username.toLowerCase()

  let passwordHash = config.admin.passwordHash
  if (!passwordHash) {
    if (!config.admin.password) {
      console.warn(
        '[auth] Neither ADMIN_PASSWORD_HASH nor ADMIN_PASSWORD is set — login is disabled. ' +
          'Copy .env.example to .env to fix this.',
      )
      return
    }
    if (config.isProduction) {
      throw new Error(
        'ADMIN_PASSWORD (plaintext) is not allowed in production. Generate a hash with:\n' +
          "  npm run hash-password -- 'your-password'\n" +
          'then set ADMIN_PASSWORD_HASH in .env and remove ADMIN_PASSWORD.',
      )
    }
    passwordHash = await hashPassword(config.admin.password)
  }

  const existing = db.users.find((user) => user.username === username)
  if (existing) {
    // Keep the stored hash in step with the environment.
    if (config.admin.passwordHash && existing.passwordHash !== config.admin.passwordHash) {
      existing.passwordHash = config.admin.passwordHash
      persist()
    } else if (config.admin.password && !config.admin.passwordHash) {
      existing.passwordHash = passwordHash
      persist()
    }
    return
  }

  db.users.push(makeUser(username, passwordHash, true))
  persist()
  console.log(`[auth] administrator "${username}" ready`)
}

function makeUser(username: string, passwordHash: string, isAdmin: boolean): StoredUser {
  return {
    id: newId(),
    username,
    passwordHash,
    createdAt: new Date().toISOString(),
    isAdmin,
    sessionEpoch: 1,
    sessions: 0,
    streak: { current: 0, lastPracticeDay: null },
  }
}

export type RegisterResult =
  | { ok: true; user: User }
  | { ok: false; error: string }

/**
 * Creates a normal (non-admin) account.
 *
 * Usernames are lower-cased and must be unique. Everything a user owns is
 * keyed to the id generated here, so accounts never see each other's words.
 */
export async function registerUser(
  username: string,
  password: string,
): Promise<RegisterResult> {
  const db = getDb()
  const normalised = username.trim().toLowerCase()

  if (normalised.length < 3) {
    return { ok: false, error: 'Username must be at least 3 characters.' }
  }
  if (!/^[a-z0-9._-]+$/.test(normalised)) {
    return {
      ok: false,
      error: 'Username can use letters, numbers, dots, dashes and underscores only.',
    }
  }
  if (password.length < 8) {
    return { ok: false, error: 'Password must be at least 8 characters.' }
  }
  if (db.users.some((user) => user.username === normalised)) {
    return { ok: false, error: 'That username is taken.' }
  }

  const user = makeUser(normalised, await hashPassword(password), false)
  db.users.push(user)
  persist()

  console.log(`[auth] new account "${normalised}"`)
  return { ok: true, user: { id: user.id, username: user.username, isAdmin: false } }
}

/** Public counts for the sign-in screen. */
export function communityStats(): CommunityStats {
  const db = getDb()
  return { users: db.users.length, words: db.vocabulary.length }
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<User | null> {
  const db = getDb()
  const record = db.users.find((user) => user.username === username.trim().toLowerCase())

  if (!record) {
    // Constant-ish work for unknown users to avoid trivial user enumeration.
    await hashPassword(password)
    return null
  }
  if (!(await verifyPassword(password, record.passwordHash))) return null
  return { id: record.id, username: record.username, isAdmin: record.isAdmin }
}

// ---------------------------------------------------------------------------
// Sessions — stateless, HMAC-signed cookie
// ---------------------------------------------------------------------------

interface SessionPayload {
  sub: string
  username: string
  /** Session epoch at issue time; invalidated when the user logs out. */
  ep: number
  exp: number
}

function sign(data: string): string {
  return createHmac('sha256', config.session.secret).update(data).digest('base64url')
}

function createToken(user: User): string {
  const record = getDb().users.find((candidate) => candidate.id === user.id)
  const payload: SessionPayload = {
    sub: user.id,
    username: user.username,
    ep: record?.sessionEpoch ?? 1,
    exp: Date.now() + config.session.maxAgeMs,
  }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${body}.${sign(body)}`
}

function readToken(token: string | undefined): User | null {
  if (!token) return null
  const [body, signature] = token.split('.')
  if (!body || !signature) return null

  const expected = Buffer.from(sign(body))
  const provided = Buffer.from(signature)
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return null

  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionPayload
    if (!payload.exp || payload.exp < Date.now()) return null

    // Reject tokens issued before the last logout.
    const record = getDb().users.find((candidate) => candidate.id === payload.sub)
    if (!record || (payload.ep ?? 0) !== record.sessionEpoch) return null

    return { id: record.id, username: record.username, isAdmin: record.isAdmin }
  } catch {
    return null
  }
}

export function issueSession(res: Response, user: User): void {
  res.cookie(config.session.cookieName, createToken(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: config.session.maxAgeMs,
    path: '/',
  })
}

export function clearSession(res: Response, userId?: string): void {
  res.clearCookie(config.session.cookieName, { path: '/' })

  // Invalidate every token already issued for this user.
  if (userId) {
    const record = getDb().users.find((candidate) => candidate.id === userId)
    if (record) {
      record.sessionEpoch += 1
      persist()
    }
  }
}

export function currentUser(req: Request): User | null {
  return readToken(req.cookies?.[config.session.cookieName])
}

/** Guards every route that touches user data. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const user = currentUser(req)
  if (!user) {
    res.status(401).json({ error: 'Not signed in.', code: 'unauthorized' })
    return
  }
  req.user = user
  next()
}
