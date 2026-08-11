/**
 * Tests for the deterministic spelling and scheduling logic.
 * Run with `npm test` (Node's built-in test runner — no extra dependencies).
 */

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { compareSpelling, mistakeRegion } from './spelling.ts'
import { gradeVocabulary, intervalHours, pickNextWord, statusFor } from './srs.ts'
import type { Vocabulary } from './types.ts'

describe('compareSpelling', () => {
  it('accepts an exact match', () => {
    const result = compareSpelling('ubiquitous', 'ubiquitous')
    assert.equal(result.correct, true)
    assert.equal(result.distance, 0)
    assert.equal(result.mistakes.length, 0)
  })

  it('trims surrounding whitespace', () => {
    assert.equal(compareSpelling('ubiquitous', '  ubiquitous  ').correct, true)
  })

  it('detects a missing letter and its position', () => {
    const result = compareSpelling('accommodate', 'acommodate')
    assert.equal(result.correct, false)
    assert.equal(result.distance, 1)
    assert.deepEqual(result.mistakes, [
      { type: 'missing', expected: 'c', actual: '', position: 1 },
    ])
    assert.match(result.explanation, /missing a letter "c"/)
  })

  it('detects an extra letter', () => {
    const result = compareSpelling('necessary', 'neccessary')
    assert.equal(result.distance, 1)
    assert.equal(result.mistakes[0].type, 'extra')
    assert.equal(result.mistakes[0].actual, 'c')
  })

  it('detects a wrong letter', () => {
    const result = compareSpelling('perseverance', 'perseverence')
    assert.equal(result.mistakes[0].type, 'wrong')
    assert.equal(result.mistakes[0].expected, 'a')
    assert.equal(result.mistakes[0].actual, 'e')
    assert.equal(result.mistakes[0].position, 8)
  })

  it('detects transposed letters as a single swap', () => {
    const result = compareSpelling('inevitable', 'inevtiable')
    assert.equal(result.distance, 1)
    assert.equal(result.mistakes.length, 1)
    assert.equal(result.mistakes[0].type, 'swapped')
    assert.equal(result.mistakes[0].expected, 'it')
    assert.match(result.explanation, /swapped the positions of "i" and "t"/)
  })

  it('treats a case-only difference as correct but flags it', () => {
    const result = compareSpelling('ubiquitous', 'Ubiquitous')
    assert.equal(result.correct, true)
    assert.equal(result.caseOnly, true)
    assert.equal(result.mistakes[0].type, 'capitalization')
  })

  it('reports several mistakes in one answer', () => {
    const result = compareSpelling('phenomenon', 'fenomenon')
    assert.equal(result.distance, 2)
    assert.deepEqual(
      result.mistakes.map((mistake) => mistake.type),
      ['missing', 'wrong'],
    )
  })

  it('flags an unrelated answer as a different word, not a typo', () => {
    const result = compareSpelling('meticulous', 'banana')
    assert.equal(result.differentWord, true)
    assert.equal(result.explanation, '')
  })

  it('treats an empty answer as a different word', () => {
    const result = compareSpelling('ambiguous', '')
    assert.equal(result.correct, false)
    assert.equal(result.differentWord, true)
  })

  it('keeps the alignment aligned to the target word', () => {
    const result = compareSpelling('accommodate', 'acommodate')
    // Every expected character appears exactly once, in order.
    const expected = result.alignment
      .map((cell) => cell.expected ?? '')
      .join('')
    assert.equal(expected, 'accommodate')
    // The missing letter leaves a hole in the answer row.
    assert.equal(result.alignment.filter((cell) => cell.actual === null).length, 1)
  })

  it('locates the region of a mistake', () => {
    assert.equal(mistakeRegion(0, 10), 'beginning')
    assert.equal(mistakeRegion(5, 10), 'middle')
    assert.equal(mistakeRegion(9, 10), 'end')
  })
})

function makeWord(overrides: Partial<Vocabulary> = {}): Vocabulary {
  const now = new Date().toISOString()
  return {
    id: 'id-1',
    userId: 'user-1',
    word: 'ubiquitous',
    meaning: 'found everywhere',
    simpleMeaning: 'everywhere',
    partOfSpeech: 'adjective',
    pronunciation: '',
    example: '',
    synonyms: [],
    difficulty: 'C1',
    memoryTip: null,
    image: null,
    imageSearched: false,
    needsEnrichment: false,
    attempts: 0,
    correct: 0,
    spellingMistakes: 0,
    box: 0,
    status: 'new',
    createdAt: now,
    lastReviewedAt: null,
    nextReviewAt: now,
    ...overrides,
  }
}

describe('spaced repetition', () => {
  it('promotes a box on a correct answer and schedules further out', () => {
    const graded = gradeVocabulary(makeWord({ box: 1 }), 'correct')
    assert.equal(graded.box, 2)
    assert.equal(graded.correct, 1)
    assert.equal(graded.attempts, 1)
    assert.ok(new Date(graded.nextReviewAt).getTime() > Date.now())
  })

  it('counts a spelling slip and steps back one box', () => {
    const graded = gradeVocabulary(makeWord({ box: 3 }), 'misspelled')
    assert.equal(graded.box, 2)
    assert.equal(graded.spellingMistakes, 1)
    assert.equal(graded.correct, 0)
  })

  it('sends a wrong or revealed word back to the start', () => {
    assert.equal(gradeVocabulary(makeWord({ box: 4 }), 'wrong').box, 0)
    assert.equal(gradeVocabulary(makeWord({ box: 4 }), 'revealed').box, 0)
  })

  it('lengthens the interval as the box rises', () => {
    assert.ok(intervalHours(1) < intervalHours(3))
    assert.ok(intervalHours(3) < intervalHours(6))
  })

  it('marks a word mastered only with a strong record', () => {
    assert.equal(statusFor(makeWord({ box: 5, attempts: 4, correct: 4 })), 'mastered')
    // Same box, poor accuracy — still under review.
    assert.equal(statusFor(makeWord({ box: 5, attempts: 10, correct: 3 })), 'review')
    assert.equal(statusFor(makeWord({ attempts: 0 })), 'new')
  })

  it('prefers struggling words when choosing what to practise next', () => {
    const past = new Date(Date.now() - 86_400_000).toISOString()
    const struggling = makeWord({
      id: 'hard',
      attempts: 10,
      correct: 1,
      spellingMistakes: 5,
      box: 0,
      nextReviewAt: past,
    })
    const solid = makeWord({
      id: 'easy',
      attempts: 10,
      correct: 10,
      box: 6,
      status: 'mastered',
      nextReviewAt: past,
    })

    // Deterministic draw at the midpoint of the weighted range.
    const picked = pickNextWord([struggling, solid], { random: () => 0.5 })
    assert.equal(picked?.id, 'hard')
  })

  it('never returns the word just practised when others exist', () => {
    const words = [makeWord({ id: 'a' }), makeWord({ id: 'b' })]
    for (let i = 0; i < 20; i++) {
      assert.notEqual(pickNextWord(words, { excludeId: 'a' })?.id, 'a')
    }
  })

  it('repeats the only word rather than returning nothing', () => {
    const only = [makeWord({ id: 'solo' })]
    assert.equal(pickNextWord(only, { excludeId: 'solo' })?.id, 'solo')
  })
})
