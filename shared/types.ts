/**
 * Types shared between the Vite frontend and the Node API server.
 * Keep this file free of runtime dependencies so both sides can import it.
 */

export type CEFRLevel = 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2'

export type MemorizationStatus = 'new' | 'learning' | 'review' | 'mastered'

/** Structured payload we require back from the AI provider. */
export interface VocabularyInfo {
  word: string
  meaning: string
  simpleMeaning: string
  partOfSpeech: string
  pronunciation: string
  example: string
  synonyms: string[]
  difficulty: CEFRLevel
}

/** A freely-licensed illustration for a word, shown on the flashcard. */
export interface WordImage {
  url: string
  thumbnail: string
  title: string
  creator: string
  license: string
  licenseUrl: string
  /** Where the image came from, for attribution. */
  sourceUrl: string
  provider: string
}

export interface Vocabulary extends VocabularyInfo {
  id: string
  userId: string
  memoryTip: string | null
  /** Looked up on first flashcard view, then cached here. */
  image: WordImage | null
  /** True once we searched and found nothing, so we do not keep retrying. */
  imageSearched: boolean
  /** Set when AI was unavailable and the entry was filled in locally. */
  needsEnrichment: boolean

  attempts: number
  correct: number
  spellingMistakes: number

  /** Spaced-repetition box index; higher means longer intervals. */
  box: number
  status: MemorizationStatus
  createdAt: string
  lastReviewedAt: string | null
  nextReviewAt: string
}

export type AttemptOutcome = 'correct' | 'misspelled' | 'wrong' | 'revealed'

export interface PracticeAttempt {
  id: string
  userId: string
  vocabularyId: string
  answer: string
  outcome: AttemptOutcome
  distance: number
  createdAt: string
}

export interface Stats {
  total: number
  mastered: number
  learning: number
  needsReview: number
  sessions: number
  correct: number
  spellingMistakes: number
  accuracy: number
  streak: number
}

export interface User {
  id: string
  username: string
  /** The single bootstrap account from .env has extra privileges. */
  isAdmin: boolean
}

/** Public counts shown on the sign-in screen. */
export interface CommunityStats {
  users: number
  words: number
}

/** Storage lifecycle info surfaced in the UI (monthly auto-clear). */
export interface StorageMeta {
  lastResetAt: string
  nextResetAt: string
  daysUntilReset: number
  autoResetEnabled: boolean
  resetIntervalDays: number
}

export interface VocabularyResponse {
  vocabulary: Vocabulary[]
  stats: Stats
  meta: StorageMeta
}

export interface ApiError {
  error: string
  code?: string
  retryable?: boolean
}

// ---------------------------------------------------------------------------
// Spelling comparison
// ---------------------------------------------------------------------------

export type MistakeType =
  | 'missing'
  | 'extra'
  | 'wrong'
  | 'swapped'
  | 'capitalization'

export interface SpellingMistake {
  type: MistakeType
  /** Character(s) the correct word has at this point. */
  expected: string
  /** Character(s) the user actually typed. */
  actual: string
  /** Index into the correct word. */
  position: number
}

export type AlignmentKind =
  | 'match'
  | 'missing'
  | 'extra'
  | 'wrong'
  | 'swapped'
  | 'capitalization'

/** One column of the two-row visual diff. */
export interface AlignmentCell {
  kind: AlignmentKind
  expected: string | null
  actual: string | null
}

export interface SpellingResult {
  correct: boolean
  /** True when the only differences are letter case. */
  caseOnly: boolean
  /** Damerau-Levenshtein edit distance. */
  distance: number
  /** 0..1 — how close the answer is to the target. */
  similarity: number
  /** True when the answer is too far off to be called a typo. */
  differentWord: boolean
  mistakes: SpellingMistake[]
  alignment: AlignmentCell[]
  /** Deterministic, human-readable summary of what went wrong. */
  explanation: string
}
