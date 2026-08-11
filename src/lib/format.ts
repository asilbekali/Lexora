import { accuracyOf } from '../../shared/srs.ts'
import type { MemorizationStatus, Vocabulary } from '../../shared/types.ts'

/** Joins class names, dropping falsy values. */
export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(' ')
}

export function accuracyPercent(entry: Vocabulary): number {
  return Math.round(accuracyOf(entry) * 100)
}

export const STATUS_LABELS: Record<MemorizationStatus, string> = {
  new: 'New',
  learning: 'Learning',
  review: 'Review',
  mastered: 'Mastered',
}

/** Tailwind classes per status chip — warm tones only, no purple. */
export const STATUS_CLASSES: Record<MemorizationStatus, string> = {
  new: 'bg-surface-3 text-ink-2',
  learning: 'bg-warning-soft text-warning',
  review: 'bg-accent-soft text-accent',
  mastered: 'bg-success-soft text-success',
}

/** "in 3 days" / "2 hours ago" / "now". */
export function relativeTime(iso: string | null): string {
  if (!iso) return 'never'

  const diff = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(diff)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (abs < minute) return 'now'

  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (abs < hour) return formatter.format(Math.round(diff / minute), 'minute')
  if (abs < day) return formatter.format(Math.round(diff / hour), 'hour')
  return formatter.format(Math.round(diff / day), 'day')
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/**
 * Hides the target word inside its own example sentence so the prompt doesn't
 * give the answer away.
 */
export function blankOut(sentence: string, word: string): string {
  if (!sentence || !word) return sentence
  // Match the word plus common inflections (-s, -ed, -ing, -ly...).
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return sentence.replace(new RegExp(`\\b${escaped}\\w*\\b`, 'gi'), '______')
}
