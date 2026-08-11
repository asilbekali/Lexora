/**
 * Typed API client.
 *
 * Every network call in the app goes through `request`, so loading, error and
 * retry handling behave identically everywhere. No secrets live on this side —
 * the browser only ever talks to our own `/api`.
 */

import type {
  CommunityStats,
  SpellingResult,
  Stats,
  StorageMeta,
  User,
  Vocabulary,
  VocabularyInfo,
  VocabularyResponse,
  WordImage,
} from '../../shared/types.ts'

export class ApiError extends Error {
  status: number
  code: string | undefined
  retryable: boolean

  constructor(message: string, status: number, code?: string, retryable = false) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }

  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response

  try {
    response = await fetch(`/api${path}`, {
      credentials: 'same-origin',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
      ...init,
    })
  } catch {
    throw new ApiError(
      'Cannot reach the server. Is it running on port 8787?',
      0,
      'network',
      true,
    )
  }

  if (response.status === 204) return undefined as T

  let payload: unknown
  try {
    payload = await response.json()
  } catch {
    payload = null
  }

  if (!response.ok) {
    const body = (payload ?? {}) as { error?: string; code?: string; retryable?: boolean }
    throw new ApiError(
      body.error ?? `Request failed (${response.status})`,
      response.status,
      body.code,
      body.retryable ?? (response.status === 429 || response.status >= 500),
    )
  }

  return payload as T
}

const json = (body: unknown): RequestInit => ({ body: JSON.stringify(body) })

// ---------------------------------------------------------------------------

export interface MutationResponse {
  vocabulary: Vocabulary
  stats: Stats
  meta: StorageMeta
  source?: 'ai' | 'offline'
  warning?: string
}

export interface AttemptResponse {
  result: SpellingResult
  outcome: 'correct' | 'misspelled' | 'wrong' | 'revealed'
  vocabulary: Vocabulary
  stats: Stats
}

export const api = {
  auth: {
    me: () => request<{ user: User }>('/auth/me'),
    community: () => request<CommunityStats>('/auth/community'),
    login: (username: string, password: string) =>
      request<{ user: User }>('/auth/login', { method: 'POST', ...json({ username, password }) }),
    register: (username: string, password: string) =>
      request<{ user: User }>('/auth/register', {
        method: 'POST',
        ...json({ username, password }),
      }),
    logout: () => request<{ ok: true }>('/auth/logout', { method: 'POST' }),
  },

  vocabulary: {
    list: () => request<VocabularyResponse>('/vocabulary'),
    add: (word: string) =>
      request<MutationResponse>('/vocabulary', { method: 'POST', ...json({ word }) }),
    update: (id: string, patch: Partial<VocabularyInfo> & { memoryTip?: string | null }) =>
      request<MutationResponse>(`/vocabulary/${id}`, { method: 'PATCH', ...json(patch) }),
    remove: (id: string) =>
      request<{ ok: true; stats: Stats; meta: StorageMeta }>(`/vocabulary/${id}`, {
        method: 'DELETE',
      }),
    seed: () =>
      request<VocabularyResponse & { created: number }>('/vocabulary/seed', { method: 'POST' }),
    enrich: (id: string) =>
      request<MutationResponse>(`/vocabulary/${id}/enrich`, { method: 'POST' }),
    reset: () => request<VocabularyResponse>('/vocabulary/reset', { method: 'POST' }),
    image: (id: string) =>
      request<{ image: WordImage | null; cached: boolean }>('/vocabulary/' + id + '/image', {
        method: 'POST',
      }),
  },

  practice: {
    startSession: () => request<{ sessions: number }>('/practice/session', { method: 'POST' }),
    attempt: (vocabularyId: string, answer: string, revealed = false) =>
      request<AttemptResponse>('/practice/attempt', {
        method: 'POST',
        ...json({ vocabularyId, answer, revealed }),
      }),
  },

  ai: {
    status: () =>
      request<{ enabled: boolean; model: string | null; pausedReason: string | null }>(
        '/ai/status',
      ),
    memoryTip: (vocabularyId: string) =>
      request<{ memoryTip: string; source: string; warning?: string }>('/ai/memory-tip', {
        method: 'POST',
        ...json({ vocabularyId }),
      }),
    explain: (vocabularyId: string) =>
      request<{ explanation: string; source: string; warning?: string }>('/ai/explain', {
        method: 'POST',
        ...json({ vocabularyId }),
      }),
  },
}

export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Something went wrong.'
}
