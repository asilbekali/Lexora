/**
 * AI service — Google Gemini (Generative Language API).
 *
 * The API key is read from the environment on the server and never leaves this
 * process. Requests go to `:generateContent` exactly as documented, with no
 * SDK in between.
 *
 * Three rules hold everywhere in this file:
 *   1. Ask for a JSON *schema* (`responseSchema`), never prose — Gemini then
 *      guarantees the shape, and zod re-checks it before we trust it.
 *   2. Validate and clamp everything before it reaches the store.
 *   3. Degrade to an offline result rather than failing the request.
 */

import { z } from 'zod'

import { config } from './env.ts'
import { offlineEntry, offlineMemoryTip } from './dictionary.ts'
import type { VocabularyInfo } from '../shared/types.ts'

export type AiSource = 'ai' | 'offline'

export interface AiResult<T> {
  data: T
  source: AiSource
  /** Present when we fell back — surfaced to the UI as a soft warning. */
  warning?: string
}

export class AiError extends Error {
  status: number | undefined
  retryable: boolean
  /** Retrying will not help — pause the provider instead. */
  fatal: boolean

  constructor(message: string, status?: number, retryable = false, fatal = false) {
    super(message)
    this.name = 'AiError'
    this.status = status
    this.retryable = retryable
    this.fatal = fatal
  }
}

// ---------------------------------------------------------------------------
// Circuit breaker
//
// Some failures are pointless to retry — a rejected key, a model this project
// can't reach, an exhausted daily quota. When one comes back we stop calling
// Gemini for a while so adding a word stays instant instead of burning seconds
// on doomed retries every single time.
// ---------------------------------------------------------------------------

const FATAL_COOLDOWN_MS = 10 * 60 * 1000
const QUOTA_COOLDOWN_MS = 2 * 60 * 1000
/** A per-day cap only clears at midnight, so back off for a long while. */
const DAILY_COOLDOWN_MS = 60 * 60 * 1000

let circuit: { reason: string; until: number } | null = null

function tripCircuit(reason: string, cooldownMs: number): void {
  circuit = { reason, until: Date.now() + cooldownMs }
  console.warn(`[ai] pausing Gemini calls for ${Math.round(cooldownMs / 60000)}m — ${reason}`)
}

function circuitOpen(): string | null {
  if (!circuit) return null
  if (Date.now() >= circuit.until) {
    circuit = null
    return null
  }
  return circuit.reason
}

/** Exposed so `/api/ai/status` can tell the UI what's going on. */
export function aiStatus(): {
  provider: 'gemini'
  enabled: boolean
  model: string | null
  pausedReason: string | null
} {
  return {
    provider: 'gemini',
    enabled: config.ai.enabled,
    model: config.ai.enabled ? config.ai.model : null,
    pausedReason: circuitOpen(),
  }
}

// ---------------------------------------------------------------------------
// Schemas
//
// Gemini takes an OpenAPI-flavoured schema; zod validates what comes back.
// Bounds live in `clamp`, since responseSchema has no length constraints.
// ---------------------------------------------------------------------------

interface GeminiSchema {
  type: 'OBJECT' | 'STRING' | 'ARRAY'
  properties?: Record<string, GeminiSchema>
  items?: GeminiSchema
  required?: string[]
  propertyOrdering?: string[]
  enum?: string[]
}

const STRING: GeminiSchema = { type: 'STRING' }

const VOCABULARY_SCHEMA: GeminiSchema = {
  type: 'OBJECT',
  properties: {
    word: STRING,
    meaning: STRING,
    simpleMeaning: STRING,
    partOfSpeech: STRING,
    pronunciation: STRING,
    example: STRING,
    synonyms: { type: 'ARRAY', items: STRING },
    difficulty: { type: 'STRING', enum: ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] },
  },
  required: [
    'word',
    'meaning',
    'simpleMeaning',
    'partOfSpeech',
    'pronunciation',
    'example',
    'synonyms',
    'difficulty',
  ],
  propertyOrdering: [
    'word',
    'meaning',
    'simpleMeaning',
    'partOfSpeech',
    'pronunciation',
    'example',
    'synonyms',
    'difficulty',
  ],
}

const vocabularySchema = z.object({
  word: z.string(),
  meaning: z.string(),
  simpleMeaning: z.string(),
  partOfSpeech: z.string(),
  pronunciation: z.string(),
  example: z.string(),
  synonyms: z.array(z.string()),
  difficulty: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']),
})

const TEXT_FIELD_SCHEMA = (field: string): GeminiSchema => ({
  type: 'OBJECT',
  properties: { [field]: STRING },
  required: [field],
})

const memoryTipSchema = z.object({ memoryTip: z.string() })
const explanationSchema = z.object({ explanation: z.string() })

function clamp(value: string, max: number): string {
  return value.trim().slice(0, max)
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

interface QuotaViolation {
  quotaId?: string
  quotaValue?: string
  quotaMetric?: string
}

/** Shape of the slice of the Gemini response we actually read. */
interface GenerateContentResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] }
    finishReason?: string
  }[]
  promptFeedback?: { blockReason?: string }
  error?: {
    code?: number
    message?: string
    status?: string
    details?: { '@type'?: string; violations?: QuotaViolation[] }[]
  }
}

/**
 * Pulls the per-day quota out of a 429, if that is what was hit.
 *
 * Gemini's free tier caps requests *per day per model*. Retrying that in two
 * minutes is pointless, so it needs a much longer pause than a per-minute
 * burst limit.
 */
function dailyQuota(payload: GenerateContentResponse | null): QuotaViolation | null {
  const failure = payload?.error?.details?.find((detail) =>
    String(detail['@type']).includes('QuotaFailure'),
  )
  return (
    failure?.violations?.find((violation) => /PerDay/i.test(violation.quotaId ?? '')) ?? null
  )
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Turns a provider error into something a human can act on. */
function friendlyError(status: number, googleStatus: string, message: string): string {
  if (googleStatus === 'PERMISSION_DENIED' || status === 403) {
    return 'Gemini rejected the key — check GEMINI_API_KEY in .env, or that the Generative Language API is enabled for the project'
  }
  if (status === 401 || /API key not valid|API_KEY_INVALID/i.test(message)) {
    return 'the GEMINI_API_KEY in .env was rejected — check or regenerate it'
  }
  if (status === 404 || googleStatus === 'NOT_FOUND') {
    return `the model "${config.ai.model}" is not available to this key — set GEMINI_MODEL in .env to one that is`
  }
  if (status === 429 || googleStatus === 'RESOURCE_EXHAUSTED') {
    return 'Gemini quota is exhausted for now — it will retry automatically in a couple of minutes'
  }
  return message || `Gemini error ${status}`
}

/** True for failures where trying again shortly is worthwhile. */
function isRetryable(status: number): boolean {
  return status === 429 || status >= 500
}

/** True for failures that should pause AI entirely for a while. */
function isFatal(status: number, googleStatus: string): boolean {
  return (
    status === 401 ||
    status === 403 ||
    status === 404 ||
    googleStatus === 'PERMISSION_DENIED' ||
    googleStatus === 'UNAUTHENTICATED' ||
    /API_KEY_INVALID/i.test(googleStatus)
  )
}

interface AskOptions<T> {
  schema: z.ZodType<T>
  responseSchema: GeminiSchema
  system: string
  user: string
  maxTokens?: number
}

/** A single call to Gemini. Throws `AiError`. */
async function callGemini<T>({
  schema,
  responseSchema,
  system,
  user,
  maxTokens = 800,
}: AskOptions<T>): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.ai.timeoutMs)

  try {
    const response = await fetch(
      `${config.ai.baseUrl}/models/${config.ai.model}:generateContent`,
      {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'X-goog-api-key': config.ai.apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: maxTokens,
            thinkingConfig: { thinkingLevel: config.ai.thinkingLevel },
            responseMimeType: 'application/json',
            responseSchema,
          },
        }),
      },
    )

    const payload = (await response.json().catch(() => null)) as GenerateContentResponse | null

    if (!response.ok) {
      const googleStatus = payload?.error?.status ?? ''
      const message = payload?.error?.message ?? `HTTP ${response.status}`

      // A daily cap will not clear by retrying; treat it like a fatal error so
      // the circuit breaker holds off properly.
      const daily = response.status === 429 ? dailyQuota(payload) : null
      if (daily) {
        throw new AiError(
          `the free Gemini quota for "${config.ai.model}" is used up for today ` +
            `(${daily.quotaValue ?? 'daily'} requests/day). It resets tomorrow — or switch ` +
            'GEMINI_MODEL in .env to another model, or enable billing.',
          429,
          false,
          true,
        )
      }

      const fatal = isFatal(response.status, googleStatus)
      throw new AiError(
        friendlyError(response.status, googleStatus, message),
        response.status,
        !fatal && isRetryable(response.status),
        fatal,
      )
    }

    if (payload?.promptFeedback?.blockReason) {
      throw new AiError(
        `Gemini blocked the request (${payload.promptFeedback.blockReason})`,
        undefined,
        false,
      )
    }

    const candidate = payload?.candidates?.[0]
    if (candidate?.finishReason && !['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) {
      throw new AiError(`Gemini stopped early (${candidate.finishReason})`, undefined, false)
    }

    // Thinking models can emit several parts; the JSON is the text ones joined.
    const text = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim()

    if (!text) throw new AiError('Gemini returned an empty response', 502, true)

    const parsed = schema.safeParse(JSON.parse(text))
    if (!parsed.success) {
      throw new AiError(
        `Gemini returned an unexpected shape: ${parsed.error.issues
          .map((issue) => `${issue.path.join('.')} ${issue.message}`)
          .join('; ')}`,
        undefined,
        true,
      )
    }

    circuit = null
    return parsed.data
  } catch (error) {
    if (error instanceof AiError) throw error
    if (error instanceof SyntaxError) {
      throw new AiError('Gemini returned malformed JSON', undefined, true)
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new AiError(`Gemini timed out after ${config.ai.timeoutMs}ms`, 504, true)
    }
    throw new AiError(
      error instanceof Error ? error.message : 'Unknown failure contacting Gemini',
      undefined,
      true,
    )
  } finally {
    clearTimeout(timeout)
  }
}

/** Wraps `callGemini` with the circuit breaker and exponential backoff. */
async function ask<T>(options: AskOptions<T>): Promise<T> {
  if (!config.ai.enabled) throw new AiError('AI is not configured', undefined, false)

  const paused = circuitOpen()
  if (paused) throw new AiError(paused, undefined, false)

  let lastError: AiError | undefined

  for (let attempt = 0; attempt <= config.ai.maxRetries; attempt++) {
    try {
      return await callGemini(options)
    } catch (error) {
      lastError = error instanceof AiError ? error : new AiError(String(error))

      if (lastError.fatal) {
        const daily = lastError.status === 429
        tripCircuit(lastError.message, daily ? DAILY_COOLDOWN_MS : FATAL_COOLDOWN_MS)
        throw lastError
      }
      if (!lastError.retryable || attempt === config.ai.maxRetries) break

      await sleep(500 * 2 ** attempt)
    }
  }

  // Out of retries — back off from the provider briefly if it was a quota wall.
  if (lastError?.status === 429) tripCircuit(lastError.message, QUOTA_COOLDOWN_MS)
  throw lastError ?? new AiError('Unknown Gemini failure')
}

function fallbackWarning(error: unknown): string {
  if (!config.ai.enabled) {
    return 'AI is not configured (no GEMINI_API_KEY), so this entry was filled in offline.'
  }
  const detail = error instanceof Error ? error.message : 'unknown error'
  return `AI is unavailable right now (${detail}). Saved with offline details instead.`
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const VOCAB_SYSTEM = `You are a precise English lexicographer helping a learner build vocabulary.
For the given word provide:
- word: the correctly spelled headword (fix the spelling if the input is misspelled)
- meaning: a full dictionary definition
- simpleMeaning: plain English, at most 8 words
- partOfSpeech: e.g. "adjective"
- pronunciation: IPA wrapped in slashes, e.g. "/juːˈbɪkwɪtəs/"
- example: one natural sentence that uses the word
- synonyms: 2 to 4 close synonyms
- difficulty: the CEFR level of the word
Never invent a word that does not exist.`

/** Generate structured information for a vocabulary word. */
export async function generateVocabularyInfo(word: string): Promise<AiResult<VocabularyInfo>> {
  if (!config.ai.enabled) {
    return { data: offlineEntry(word), source: 'offline', warning: fallbackWarning(null) }
  }

  try {
    const data = await ask({
      schema: vocabularySchema,
      responseSchema: VOCABULARY_SCHEMA,
      system: VOCAB_SYSTEM,
      user: `Word: ${word}`,
    })

    return {
      source: 'ai',
      data: {
        word: clamp(data.word, 64) || word,
        meaning: clamp(data.meaning, 400),
        simpleMeaning: clamp(data.simpleMeaning, 200),
        partOfSpeech: clamp(data.partOfSpeech, 40),
        pronunciation: clamp(data.pronunciation, 80),
        example: clamp(data.example, 300),
        synonyms: data.synonyms.slice(0, 6).map((synonym) => clamp(synonym, 40)).filter(Boolean),
        difficulty: data.difficulty,
      },
    }
  } catch (error) {
    console.error('[ai] vocabulary generation failed:', error)
    return { data: offlineEntry(word), source: 'offline', warning: fallbackWarning(error) }
  }
}

/** Generate a short, memorable mnemonic for a word. */
export async function generateMemoryTip(
  word: string,
  meaning: string,
  simpleMeaning = '',
): Promise<AiResult<string>> {
  if (!config.ai.enabled) {
    return {
      data: offlineMemoryTip(word, simpleMeaning || meaning),
      source: 'offline',
      warning: fallbackWarning(null),
    }
  }

  try {
    const data = await ask({
      schema: memoryTipSchema,
      responseSchema: TEXT_FIELD_SCHEMA('memoryTip'),
      system:
        'You create vivid, very short mnemonics that help learners remember English words and ' +
        'their spelling. One or two sentences, under 200 characters. Where possible, hook the ' +
        'mnemonic to how the word is spelled.',
      user: `Word: ${word}\nMeaning: ${meaning}`,
      maxTokens: 300,
    })
    return { data: clamp(data.memoryTip, 280), source: 'ai' }
  } catch (error) {
    console.error('[ai] memory tip failed:', error)
    return {
      data: offlineMemoryTip(word, simpleMeaning || meaning),
      source: 'offline',
      warning: fallbackWarning(error),
    }
  }
}

/**
 * Optional friendly commentary on a spelling slip.
 *
 * The mistake list passed in is already computed deterministically — the AI
 * only rephrases it. If it fails we simply use the deterministic sentence.
 */
export async function explainSpelling(
  word: string,
  answer: string,
  deterministic: string,
): Promise<AiResult<string>> {
  if (!config.ai.enabled || !deterministic) {
    return { data: deterministic, source: 'offline' }
  }

  try {
    const data = await ask({
      schema: explanationSchema,
      responseSchema: TEXT_FIELD_SCHEMA('explanation'),
      system:
        'You are a warm, concise spelling coach. Rephrase the given analysis in one encouraging ' +
        'sentence under 160 characters. Do not contradict the analysis and do not add new mistakes.',
      user: `Target word: ${word}\nLearner typed: ${answer}\nAnalysis: ${deterministic}`,
      maxTokens: 250,
    })
    return { data: clamp(data.explanation, 300), source: 'ai' }
  } catch (error) {
    console.error('[ai] spelling explanation failed:', error)
    return { data: deterministic, source: 'offline' }
  }
}

/** Deeper explanation of a difficult word, on demand. */
export async function explainWord(word: string, meaning: string): Promise<AiResult<string>> {
  const offline = `"${word}" means: ${meaning || 'see the definition above'}. Try writing your own sentence with it.`
  if (!config.ai.enabled) {
    return { data: offline, source: 'offline', warning: fallbackWarning(null) }
  }

  try {
    const data = await ask({
      schema: explanationSchema,
      responseSchema: TEXT_FIELD_SCHEMA('explanation'),
      system:
        'You explain difficult English words to intermediate learners. Two or three short ' +
        'sentences: what it really means, when to use it, and one common mistake. ' +
        'Under 350 characters.',
      user: `Word: ${word}\nMeaning: ${meaning}`,
      maxTokens: 400,
    })
    return { data: clamp(data.explanation, 400), source: 'ai' }
  } catch (error) {
    console.error('[ai] word explanation failed:', error)
    return { data: offline, source: 'offline', warning: fallbackWarning(error) }
  }
}
