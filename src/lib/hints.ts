/**
 * Progressive hints.
 *
 * Each failed attempt reveals a little more, never the whole word — the
 * flashcard is the only place the answer appears in full.
 */

import { mistakeRegion } from '../../shared/spelling.ts'
import type { SpellingResult } from '../../shared/types.ts'

/** How many wrong tries before we push the learner to the flashcard. */
export const MAX_TRIES = 3

/**
 * A masked view of the word: first and last letters plus a scattering of
 * anchors, e.g. `u _ _ q _ _ _ _ _ s`.
 */
export function maskWord(word: string, reveal: number): string {
  const letters = [...word]
  const shown = new Set<number>([0, letters.length - 1])

  // Reveal a few evenly spaced letters so the shape becomes recognisable.
  const step = Math.max(2, Math.floor(letters.length / (reveal + 1)))
  for (let index = step; index < letters.length - 1; index += step) shown.add(index)

  return letters.map((letter, index) => (shown.has(index) ? letter : '_')).join(' ')
}

/**
 * Returns the hint for a given try count, or null when the learner should be
 * shown the flashcard instead.
 */
export function hintFor(word: string, tries: number, result: SpellingResult | null): string | null {
  if (tries <= 0) return null

  if (tries === 1) {
    if (result && !result.differentWord && result.mistakes.length > 0) {
      const region = mistakeRegion(result.mistakes[0].position, word.length)
      return `Check the ${region} of the word — it has ${word.length} letters.`
    }
    return `The word has ${word.length} letters and starts with "${word[0]}".`
  }

  if (tries === 2) {
    return `It starts with "${word[0]}" and looks like this:  ${maskWord(word, 2)}`
  }

  // Third strike — the caller opens the flashcard.
  return null
}
