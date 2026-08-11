/**
 * Domain operations over the JSON store.
 *
 * Route handlers stay thin; all vocabulary/attempt/stat logic lives here.
 */

import { getDb, newId, persist } from './db.ts'
import { OFFLINE_DICTIONARY, SEED_WORDS } from './dictionary.ts'
import { gradeVocabulary, intervalHours, isDue, statusFor } from '../shared/srs.ts'
import type {
  AttemptOutcome,
  PracticeAttempt,
  Stats,
  Vocabulary,
  VocabularyInfo,
} from '../shared/types.ts'

const HOUR = 60 * 60 * 1000

export function listVocabulary(userId: string): Vocabulary[] {
  return getDb()
    .vocabulary.filter((entry) => entry.userId === userId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function findVocabulary(userId: string, id: string): Vocabulary | undefined {
  return getDb().vocabulary.find((entry) => entry.id === id && entry.userId === userId)
}

export function findByWord(userId: string, word: string): Vocabulary | undefined {
  const needle = word.trim().toLowerCase()
  return getDb().vocabulary.find(
    (entry) => entry.userId === userId && entry.word.toLowerCase() === needle,
  )
}

export function createVocabulary(
  userId: string,
  info: VocabularyInfo,
  options: { memoryTip?: string | null; needsEnrichment?: boolean } = {},
): Vocabulary {
  const now = new Date()
  const entry: Vocabulary = {
    ...info,
    synonyms: [...info.synonyms],
    id: newId(),
    userId,
    memoryTip: options.memoryTip ?? null,
    image: null,
    imageSearched: false,
    needsEnrichment: options.needsEnrichment ?? info.meaning.trim().length === 0,

    attempts: 0,
    correct: 0,
    spellingMistakes: 0,

    box: 0,
    status: 'new',
    createdAt: now.toISOString(),
    lastReviewedAt: null,
    // New words are due immediately.
    nextReviewAt: new Date(now.getTime() + intervalHours(0) * HOUR).toISOString(),
  }

  getDb().vocabulary.push(entry)
  persist()
  return entry
}

const EDITABLE_FIELDS = [
  'word',
  'meaning',
  'simpleMeaning',
  'partOfSpeech',
  'pronunciation',
  'example',
  'synonyms',
  'difficulty',
  'memoryTip',
] as const

export type EditableVocabulary = Partial<Pick<Vocabulary, (typeof EDITABLE_FIELDS)[number]>>

export function updateVocabulary(
  userId: string,
  id: string,
  patch: EditableVocabulary,
): Vocabulary | null {
  const entry = findVocabulary(userId, id)
  if (!entry) return null

  for (const field of EDITABLE_FIELDS) {
    if (patch[field] === undefined) continue
    // Assigning field-by-field keeps ids, counters and schedule untouchable.
    Object.assign(entry, { [field]: patch[field] })
  }
  if (entry.meaning.trim().length > 0) entry.needsEnrichment = false

  persist()
  return entry
}

export function deleteVocabulary(userId: string, id: string): boolean {
  const db = getDb()
  const index = db.vocabulary.findIndex((entry) => entry.id === id && entry.userId === userId)
  if (index === -1) return false

  db.vocabulary.splice(index, 1)
  db.attempts = db.attempts.filter((attempt) => attempt.vocabularyId !== id)
  persist()
  return true
}

/** Loads the demo word list for users starting from an empty store. */
export function seedVocabulary(userId: string): Vocabulary[] {
  const created: Vocabulary[] = []
  for (const word of SEED_WORDS) {
    if (findByWord(userId, word)) continue
    created.push(createVocabulary(userId, OFFLINE_DICTIONARY[word], { needsEnrichment: false }))
  }
  return created
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Advances the streak for one user only. */
function bumpStreak(userId: string): void {
  const user = getDb().users.find((candidate) => candidate.id === userId)
  if (!user) return

  const day = today()
  if (user.streak.lastPracticeDay === day) return

  const yesterday = new Date(Date.now() - 24 * HOUR).toISOString().slice(0, 10)
  user.streak.current = user.streak.lastPracticeDay === yesterday ? user.streak.current + 1 : 1
  user.streak.lastPracticeDay = day
}

export function startSession(userId: string): number {
  const user = getDb().users.find((candidate) => candidate.id === userId)
  if (!user) return 0
  user.sessions += 1
  persist()
  return user.sessions
}

/** Caches a looked-up illustration on the word. */
export function setVocabularyImage(
  userId: string,
  id: string,
  image: Vocabulary['image'],
): Vocabulary | null {
  const entry = findVocabulary(userId, id)
  if (!entry) return null
  entry.image = image
  entry.imageSearched = true
  persist()
  return entry
}

export interface AttemptRecord {
  vocabulary: Vocabulary
  attempt: PracticeAttempt
}

/** Applies an outcome to a word: records the attempt and reschedules it. */
export function recordAttempt(
  userId: string,
  vocabularyId: string,
  answer: string,
  outcome: AttemptOutcome,
  distance: number,
): AttemptRecord | null {
  const db = getDb()
  const index = db.vocabulary.findIndex(
    (entry) => entry.id === vocabularyId && entry.userId === userId,
  )
  if (index === -1) return null

  const graded = gradeVocabulary(db.vocabulary[index], outcome)
  db.vocabulary[index] = graded

  const attempt: PracticeAttempt = {
    id: newId(),
    userId,
    vocabularyId,
    answer,
    outcome,
    distance,
    createdAt: new Date().toISOString(),
  }
  db.attempts.push(attempt)

  // Keep the attempt log from growing without bound.
  if (db.attempts.length > 5000) db.attempts.splice(0, db.attempts.length - 5000)

  bumpStreak(userId)
  persist()

  return { vocabulary: graded, attempt }
}

export function computeStats(userId: string): Stats {
  const db = getDb()
  const words = db.vocabulary.filter((entry) => entry.userId === userId)
  const user = db.users.find((candidate) => candidate.id === userId)
  const now = Date.now()

  let mastered = 0
  let learning = 0
  let needsReview = 0
  let attempts = 0
  let correct = 0
  let spellingMistakes = 0

  for (const word of words) {
    const status = statusFor(word)
    if (status === 'mastered') mastered += 1
    else if (isDue(word, now)) needsReview += 1
    else learning += 1

    attempts += word.attempts
    correct += word.correct
    spellingMistakes += word.spellingMistakes
  }

  return {
    total: words.length,
    mastered,
    learning,
    needsReview,
    sessions: user?.sessions ?? 0,
    correct,
    spellingMistakes,
    accuracy: attempts === 0 ? 0 : Math.round((correct / attempts) * 100),
    streak: user?.streak.current ?? 0,
  }
}
