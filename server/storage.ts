/**
 * Where the JSON store physically lives.
 *
 * Two drivers, chosen automatically:
 *
 *   file    — a JSON file on disk. Used locally and on any host with a
 *             persistent volume (Render, Railway, Fly).
 *   upstash — Upstash Redis over its REST API. Used on serverless hosts such
 *             as Vercel, whose filesystem is wiped between invocations.
 *
 * The driver only moves an opaque string around; everything above it in
 * `db.ts` is unchanged either way.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { config } from './env.ts'

export interface StorageDriver {
  readonly name: string
  read(): Promise<string | null>
  write(data: string): Promise<void>
  /** Keeps a timestamped copy before the monthly clear. Best-effort. */
  archive(data: string, stamp: string): Promise<void>
}

// ---------------------------------------------------------------------------
// File
// ---------------------------------------------------------------------------

const fileDriver: StorageDriver = {
  name: 'file',

  async read() {
    if (!existsSync(config.dataFile)) return null
    return readFileSync(config.dataFile, 'utf8')
  },

  async write(data) {
    mkdirSync(dirname(config.dataFile), { recursive: true })
    // Temp file + rename, so a crash can never truncate the store.
    const tmp = `${config.dataFile}.${process.pid}.tmp`
    writeFileSync(tmp, data, 'utf8')
    renameSync(tmp, config.dataFile)
  },

  async archive(data, stamp) {
    mkdirSync(config.archiveDir, { recursive: true })
    writeFileSync(join(config.archiveDir, `db-${stamp}.json`), data, 'utf8')
  },
}

// ---------------------------------------------------------------------------
// Upstash Redis (REST)
// ---------------------------------------------------------------------------

const KEY = 'lexora:db'

/**
 * Talks to Upstash over plain HTTP — no SDK, and nothing to bundle.
 *
 * Vercel's Upstash integration injects `KV_REST_API_URL` / `KV_REST_API_TOKEN`;
 * the Upstash dashboard calls them `UPSTASH_REDIS_REST_*`. Both are accepted.
 */
function makeUpstashDriver(url: string, token: string): StorageDriver {
  const base = url.replace(/\/$/, '')
  const headers = { Authorization: `Bearer ${token}` }

  async function command(path: string, body?: string): Promise<unknown> {
    const response = await fetch(`${base}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'text/plain' },
      body,
    })
    if (!response.ok) {
      throw new Error(`Upstash ${path.split('/')[0]} failed: ${response.status}`)
    }
    const payload = (await response.json()) as { result?: unknown }
    return payload.result
  }

  return {
    name: 'upstash',

    async read() {
      const result = await command(`get/${KEY}`)
      return typeof result === 'string' ? result : null
    },

    async write(data) {
      await command(`set/${KEY}`, data)
    },

    async archive(data, stamp) {
      // Snapshots expire after 90 days so they cannot grow without bound.
      await command(`set/${KEY}:archive:${stamp}?EX=7776000`, data)
    },
  }
}

// ---------------------------------------------------------------------------

function detectDriver(): StorageDriver {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN

  if (url && token) return makeUpstashDriver(url, token)

  // A serverless filesystem is wiped between invocations, so a file store
  // there silently loses every account. Fail loudly instead.
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    throw new Error(
      'No persistent storage configured.\n' +
        'This host has an ephemeral filesystem, so the JSON file store cannot be used.\n' +
        'Add an Upstash Redis integration (Vercel dashboard → Storage) and redeploy — ' +
        'it sets KV_REST_API_URL and KV_REST_API_TOKEN automatically.',
    )
  }

  return fileDriver
}

let driver: StorageDriver | null = null

export function storage(): StorageDriver {
  driver ??= detectDriver()
  return driver
}

/** Human-readable description of where data is going, for the boot log. */
export function storageLabel(): string {
  const active = storage()
  return active.name === 'file' ? `file ${config.dataFile}` : 'Upstash Redis'
}
