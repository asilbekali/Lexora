/**
 * Spaced repetition.
 *
 * A deliberately simple Leitner-style box system: each correct answer promotes
 * a word to a longer interval, each failure demotes it. Everything funnels
 * through `gradeVocabulary` and `scoreForSelection`, so upgrading to SM-2 or
 * FSRS later means rewriting this file alone.
 */

import type { AttemptOutcome, MemorizationStatus, Vocabulary } from './types.ts'

const HOUR = 60 * 60 * 1000

/** Interval per box, in hours. Box 0 is "show it again in this session". */
export const BOX_INTERVALS_HOURS = [0, 4, 24, 72, 168, 336, 720] as const

export const MAX_BOX = BOX_INTERVALS_HOURS.length - 1

/** Promotion to this box (plus a solid accuracy record) means "mastered". */
const MASTERY_BOX = 5
const MASTERY_MIN_CORRECT = 3
const MASTERY_MIN_ACCURACY = 0.8

export function intervalHours(box: number): number {
  const index = Math.min(Math.max(box, 0), MAX_BOX)
  return BOX_INTERVALS_HOURS[index]
}

export function accuracyOf(entry: Pick<Vocabulary, 'attempts' | 'correct'>): number {
  return entry.attempts === 0 ? 0 : entry.correct / entry.attempts
}

export function statusFor(entry: Vocabulary): MemorizationStatus {
  if (entry.attempts === 0) return 'new'
  if (
    entry.box >= MASTERY_BOX &&
    entry.correct >= MASTERY_MIN_CORRECT &&
    accuracyOf(entry) >= MASTERY_MIN_ACCURACY
  ) {
    return 'mastered'
  }
  return entry.box >= 2 ? 'review' : 'learning'
}

export function isDue(entry: Vocabulary, now: number = Date.now()): boolean {
  return new Date(entry.nextReviewAt).getTime() <= now
}

/**
 * Applies an attempt outcome to a word and returns the updated record.
 *
 * - `correct`    — first-try success, promote a box.
 * - `misspelled` — right word, wrong letters; hold position and count the slip.
 * - `wrong`      — a different word entirely; demote hard.
 * - `revealed`   — the learner asked for the flashcard; back to the start.
 */
export function gradeVocabulary(
  entry: Vocabulary,
  outcome: AttemptOutcome,
  now: Date = new Date(),
): Vocabulary {
  let box = entry.box

  switch (outcome) {
    case 'correct':
      box = Math.min(entry.box + 1, MAX_BOX)
      break
    case 'misspelled':
      box = Math.max(entry.box - 1, 0)
      break
    case 'wrong':
    case 'revealed':
      box = 0
      break
  }

  const updated: Vocabulary = {
    ...entry,
    box,
    attempts: entry.attempts + 1,
    correct: entry.correct + (outcome === 'correct' ? 1 : 0),
    spellingMistakes: entry.spellingMistakes + (outcome === 'misspelled' ? 1 : 0),
    lastReviewedAt: now.toISOString(),
    nextReviewAt: new Date(now.getTime() + intervalHours(box) * HOUR).toISOString(),
    status: entry.status,
  }

  updated.status = statusFor(updated)
  return updated
}

/**
 * Weight used when picking the next practice word — higher means more likely.
 * Struggling and overdue words float to the top; mastered ones sink.
 */
export function scoreForSelection(entry: Vocabulary, now: number = Date.now()): number {
  let score = 1

  // Never seen before: get it in front of the learner early.
  if (entry.attempts === 0) score += 6

  // How badly overdue is it? (capped so ancient words don't dominate forever)
  const overdueDays = (now - new Date(entry.nextReviewAt).getTime()) / (24 * HOUR)
  score += Math.min(Math.max(overdueDays, 0), 7) * 1.5

  // Words the learner keeps getting wrong.
  if (entry.attempts > 0) {
    score += (1 - accuracyOf(entry)) * 8
    score += Math.min(entry.spellingMistakes, 5) * 1.2
  }

  // Lower boxes mean "still shaky".
  score += (MAX_BOX - Math.min(entry.box, MAX_BOX)) * 0.6

  if (entry.status === 'mastered') score *= 0.15
  if (!isDue(entry, now)) score *= 0.3

  return Math.max(score, 0.05)
}

/**
 * Weighted random pick. Randomness keeps sessions from feeling mechanical
 * while the weights still favour the words that need work.
 */
export function pickNextWord(
  words: Vocabulary[],
  options: { excludeId?: string | null; now?: number; random?: () => number } = {},
): Vocabulary | null {
  const { excludeId = null, now = Date.now(), random = Math.random } = options
  if (words.length === 0) return null

  const pool = words.length > 1 ? words.filter((word) => word.id !== excludeId) : words
  if (pool.length === 0) return null

  const weights = pool.map((word) => scoreForSelection(word, now))
  const total = weights.reduce((sum, weight) => sum + weight, 0)

  let threshold = random() * total
  for (let index = 0; index < pool.length; index++) {
    threshold -= weights[index]
    if (threshold <= 0) return pool[index]
  }
  return pool[pool.length - 1]
}
