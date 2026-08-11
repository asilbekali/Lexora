/**
 * Deterministic spelling comparison.
 *
 * Uses Damerau-Levenshtein (optimal string alignment) distance with a full
 * traceback so we can report *where* and *how* an answer differs from the
 * target — missing, extra, wrong, swapped or miscapitalised characters.
 *
 * No AI is involved here. The AI may later dress the result up in friendlier
 * prose, but correctness always comes from this file.
 */

import type {
  AlignmentCell,
  SpellingMistake,
  SpellingResult,
} from './types.ts'

type Op = 'match' | 'wrong' | 'missing' | 'extra' | 'swapped'

interface Step {
  op: Op
  /** Index into the expected word. */
  ei: number
  /** Index into the actual word. */
  ai: number
  expected: string
  actual: string
}

/** Number of edits we still consider "a typo" rather than "a different word". */
function typoTolerance(length: number): number {
  return Math.max(2, Math.round(length * 0.4))
}

/**
 * Builds the OSA distance matrix and walks it backwards into an ordered list
 * of edit operations.
 */
function align(expected: string, actual: string): { distance: number; steps: Step[] } {
  const m = expected.length
  const n = actual.length

  // d[i][j] = distance between expected[0..i) and actual[0..j)
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
  for (let i = 0; i <= m; i++) d[i][0] = i
  for (let j = 0; j <= n; j++) d[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = expected[i - 1] === actual[j - 1] ? 0 : 1
      let best = Math.min(
        d[i - 1][j] + 1, // expected char not consumed -> missing from answer
        d[i][j - 1] + 1, // actual char not consumed -> extra in answer
        d[i - 1][j - 1] + cost,
      )
      if (
        i > 1 &&
        j > 1 &&
        expected[i - 1] === actual[j - 2] &&
        expected[i - 2] === actual[j - 1]
      ) {
        best = Math.min(best, d[i - 2][j - 2] + 1)
      }
      d[i][j] = best
    }
  }

  // Walk back from the bottom-right corner, preferring cheap/natural moves.
  const steps: Step[] = []
  let i = m
  let j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0) {
      const cost = expected[i - 1] === actual[j - 1] ? 0 : 1
      if (
        i > 1 &&
        j > 1 &&
        expected[i - 1] === actual[j - 2] &&
        expected[i - 2] === actual[j - 1] &&
        d[i][j] === d[i - 2][j - 2] + 1
      ) {
        steps.push({
          op: 'swapped',
          ei: i - 2,
          ai: j - 2,
          expected: expected.slice(i - 2, i),
          actual: actual.slice(j - 2, j),
        })
        i -= 2
        j -= 2
        continue
      }
      if (d[i][j] === d[i - 1][j - 1] + cost) {
        steps.push({
          op: cost === 0 ? 'match' : 'wrong',
          ei: i - 1,
          ai: j - 1,
          expected: expected[i - 1],
          actual: actual[j - 1],
        })
        i -= 1
        j -= 1
        continue
      }
    }
    if (i > 0 && d[i][j] === d[i - 1][j] + 1) {
      steps.push({
        op: 'missing',
        ei: i - 1,
        ai: j,
        expected: expected[i - 1],
        actual: '',
      })
      i -= 1
      continue
    }
    // Remaining possibility: an extra character in the answer.
    steps.push({
      op: 'extra',
      ei: i,
      ai: j - 1,
      expected: '',
      actual: actual[j - 1],
    })
    j -= 1
  }

  steps.reverse()
  return { distance: d[m][n], steps }
}

/** Collapses runs of the same operation so "missing m, missing m" reads as one. */
function collapse(steps: Step[], expectedRaw: string, actualRaw: string): SpellingMistake[] {
  const mistakes: SpellingMistake[] = []

  for (const step of steps) {
    if (step.op === 'match') continue

    const previous = mistakes[mistakes.length - 1]
    const adjacent =
      previous &&
      previous.type === step.op &&
      previous.position + previous.expected.length === step.ei

    if (adjacent && (step.op === 'missing' || step.op === 'wrong')) {
      previous.expected += expectedRaw.slice(step.ei, step.ei + 1)
      previous.actual += step.op === 'wrong' ? actualRaw.slice(step.ai, step.ai + 1) : ''
      continue
    }
    if (previous && previous.type === 'extra' && step.op === 'extra') {
      previous.actual += actualRaw.slice(step.ai, step.ai + 1)
      continue
    }

    mistakes.push({
      type: step.op,
      expected:
        step.op === 'extra' ? '' : expectedRaw.slice(step.ei, step.ei + step.expected.length),
      actual:
        step.op === 'missing' ? '' : actualRaw.slice(step.ai, step.ai + step.actual.length),
      position: step.ei,
    })
  }

  return mistakes
}

function quote(value: string): string {
  return `"${value}"`
}

/** Where in the word the first mistake sits — used for progressive hints. */
export function mistakeRegion(position: number, length: number): 'beginning' | 'middle' | 'end' {
  const ratio = length === 0 ? 0 : position / length
  if (ratio < 0.34) return 'beginning'
  if (ratio < 0.67) return 'middle'
  return 'end'
}

function describe(mistakes: SpellingMistake[], expected: string): string {
  if (mistakes.length === 0) return ''

  const parts = mistakes.slice(0, 3).map((mistake) => {
    switch (mistake.type) {
      case 'missing': {
        const before = expected.slice(0, mistake.position)
        const tail = before.slice(-1)
        const letters = mistake.expected.length > 1 ? 'letters' : 'a letter'
        return tail
          ? `you're missing ${letters} ${quote(mistake.expected)} after ${quote(tail)}`
          : `you're missing ${letters} ${quote(mistake.expected)} at the start`
      }
      case 'extra':
        return `you added an extra ${quote(mistake.actual)}`
      case 'wrong':
        return `you typed ${quote(mistake.actual)} where it should be ${quote(mistake.expected)}`
      case 'swapped':
        return `you swapped the positions of ${quote(mistake.expected[0])} and ${quote(
          mistake.expected[1],
        )}`
      case 'capitalization':
        return `check the capitalisation of ${quote(mistake.expected)}`
    }
  })

  const extra = mistakes.length > 3 ? `, plus ${mistakes.length - 3} more` : ''
  const sentence =
    parts.length === 1
      ? parts[0]
      : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`

  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}${extra}.`
}

/**
 * Compares a typed answer against the target word.
 *
 * Case differences alone are accepted (the answer counts as correct) but are
 * still reported so the UI can nudge the learner.
 */
export function compareSpelling(target: string, answer: string): SpellingResult {
  const expectedRaw = target.trim()
  const actualRaw = answer.trim()

  const expected = expectedRaw.toLowerCase()
  const actual = actualRaw.toLowerCase()

  // Exact match, including case.
  if (expectedRaw === actualRaw) {
    return {
      correct: true,
      caseOnly: false,
      distance: 0,
      similarity: 1,
      differentWord: false,
      mistakes: [],
      alignment: [...expectedRaw].map((char) => ({
        kind: 'match',
        expected: char,
        actual: char,
      })),
      explanation: '',
    }
  }

  // Same letters, different case.
  if (expected === actual) {
    const alignment: AlignmentCell[] = [...expectedRaw].map((char, index) => ({
      kind: char === actualRaw[index] ? 'match' : 'capitalization',
      expected: char,
      actual: actualRaw[index],
    }))
    const mistakes: SpellingMistake[] = alignment
      .map((cell, index) => ({ cell, index }))
      .filter(({ cell }) => cell.kind === 'capitalization')
      .map(({ cell, index }) => ({
        type: 'capitalization' as const,
        expected: cell.expected ?? '',
        actual: cell.actual ?? '',
        position: index,
      }))

    return {
      correct: true,
      caseOnly: true,
      distance: 0,
      similarity: 1,
      differentWord: false,
      mistakes,
      alignment,
      explanation: `Right word — just watch the capitalisation: it's ${quote(expectedRaw)}.`,
    }
  }

  const { distance, steps } = align(expected, actual)

  const alignment: AlignmentCell[] = steps.map((step) => {
    if (step.op === 'swapped') {
      return {
        kind: 'swapped',
        expected: expectedRaw.slice(step.ei, step.ei + 2),
        actual: actualRaw.slice(step.ai, step.ai + 2),
      }
    }
    return {
      kind: step.op,
      expected: step.op === 'extra' ? null : expectedRaw.slice(step.ei, step.ei + 1),
      actual: step.op === 'missing' ? null : actualRaw.slice(step.ai, step.ai + 1),
    }
  })

  const mistakes = collapse(steps, expectedRaw, actualRaw)
  const longest = Math.max(expected.length, actual.length) || 1
  const differentWord = actual.length === 0 || distance > typoTolerance(expected.length)

  return {
    correct: false,
    caseOnly: false,
    distance,
    similarity: Math.max(0, 1 - distance / longest),
    differentWord,
    mistakes,
    alignment,
    explanation: differentWord ? '' : describe(mistakes, expectedRaw),
  }
}
