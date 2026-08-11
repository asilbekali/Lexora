/**
 * The practice session state machine.
 *
 *   idle ──start──▶ prompt ──check──▶ feedback ──next──▶ prompt
 *                     │                   │
 *                     └──"I don't know"───┴──▶ flashcard ──remember──▶ prompt
 *
 * Feedback is rendered from a *local* deterministic comparison so it appears
 * the instant you hit Enter; the server re-grades the same answer and its
 * authoritative result replaces the local one when it lands.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { api, errorMessage } from '../lib/api.ts'
import { MAX_TRIES, hintFor } from '../lib/hints.ts'
import { compareSpelling } from '../../shared/spelling.ts'
import { pickNextWord } from '../../shared/srs.ts'
import type { SpellingResult, Stats, Vocabulary } from '../../shared/types.ts'

export type PracticePhase = 'idle' | 'prompt' | 'feedback' | 'flashcard'

interface Options {
  words: Vocabulary[]
  onGraded: (entry: Vocabulary, stats: Stats) => void
}

export function usePractice({ words, onGraded }: Options) {
  const [phase, setPhase] = useState<PracticePhase>('idle')
  const [current, setCurrent] = useState<Vocabulary | null>(null)
  const [result, setResult] = useState<SpellingResult | null>(null)
  const [answer, setAnswer] = useState('')
  const [tries, setTries] = useState(0)
  const [hint, setHint] = useState<string | null>(null)
  /** Whether the correct letters at the mistake positions are shown. */
  const [revealAnswer, setRevealAnswer] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewed, setReviewed] = useState(0)

  // Mirrored into a ref so the callbacks below stay stable across renders
  // instead of being rebuilt every time the word list changes.
  const wordsRef = useRef(words)
  useEffect(() => {
    wordsRef.current = words
  }, [words])

  const advance = useCallback((excludeId: string | null) => {
    const next = pickNextWord(wordsRef.current, { excludeId })
    if (!next) {
      setPhase('idle')
      setCurrent(null)
      return
    }
    setCurrent(next)
    setResult(null)
    setAnswer('')
    setTries(0)
    setHint(null)
    setRevealAnswer(false)
    setError(null)
    setPhase('prompt')
  }, [])

  const start = useCallback(async () => {
    if (wordsRef.current.length === 0) return
    setReviewed(0)
    advance(null)
    try {
      await api.practice.startSession()
    } catch {
      // A missed session counter must never block practice.
    }
  }, [advance])

  /** Jump straight into a specific word (from the vocabulary list). */
  const practiceWord = useCallback((entry: Vocabulary) => {
    setCurrent(entry)
    setResult(null)
    setAnswer('')
    setTries(0)
    setHint(null)
    setRevealAnswer(false)
    setError(null)
    setPhase('prompt')
  }, [])

  const stop = useCallback(() => {
    setPhase('idle')
    setCurrent(null)
    setResult(null)
    setAnswer('')
    setTries(0)
    setHint(null)
    setRevealAnswer(false)
    setError(null)
  }, [])

  /** Sends the graded attempt to the server and reconciles the response. */
  const submitToServer = useCallback(
    async (entry: Vocabulary, value: string, revealed: boolean) => {
      try {
        const response = await api.practice.attempt(entry.id, value, revealed)
        onGraded(response.vocabulary, response.stats)
        if (!revealed) setResult(response.result)
        setError(null)
      } catch (cause) {
        // The local comparison already gave the learner their feedback; this
        // only means the attempt wasn't recorded.
        setError(`${errorMessage(cause)} Your progress for this word wasn't saved.`)
      }
    },
    [onGraded],
  )

  const check = useCallback(async () => {
    const entry = current
    if (!entry || checking) return

    const value = answer.trim()
    if (!value) return

    // Instant, deterministic feedback.
    const local = compareSpelling(entry.word, value)
    setResult(local)
    setPhase('feedback')
    setChecking(true)

    if (local.correct) {
      setReviewed((count) => count + 1)
      setHint(null)
    } else {
      const attempt = tries + 1
      setTries(attempt)
      // After the first slip, stop masking the correct letters.
      if (attempt >= 2) setRevealAnswer(true)
      if (attempt >= MAX_TRIES) {
        setHint(null)
        setPhase('flashcard')
      } else {
        setHint(hintFor(entry.word, attempt, local))
      }
    }

    await submitToServer(entry, value, false)
    setChecking(false)
  }, [answer, checking, current, submitToServer, tries])

  /** Try the same word again without revealing it. */
  const retry = useCallback(() => {
    setPhase('prompt')
    setResult(null)
    setRevealAnswer(false)
    setAnswer('')
  }, [])

  const dontKnow = useCallback(async () => {
    const entry = current
    if (!entry) return

    setPhase('flashcard')
    setResult(null)
    setHint(null)
    await submitToServer(entry, answer.trim(), true)
  }, [answer, current, submitToServer])

  /** Closes the flashcard and moves on. */
  const remember = useCallback(() => {
    setReviewed((count) => count + 1)
    advance(current?.id ?? null)
  }, [advance, current])

  /**
   * Merges freshly-fetched detail (memory tip, image) into the word being
   * practised. Without this the flashcard would keep seeing a stale `current`
   * with `memoryTip: null` and refetch forever.
   */
  const patchCurrent = useCallback((id: string, patch: Partial<Vocabulary>) => {
    setCurrent((entry) => (entry && entry.id === id ? { ...entry, ...patch } : entry))
  }, [])

  /** "Show me" — the learner asks for the correct letters. */
  const showAnswer = useCallback(() => {
    setRevealAnswer(true)
  }, [])

  const next = useCallback(() => {
    advance(current?.id ?? null)
  }, [advance, current])

  return {
    phase,
    current,
    result,
    answer,
    setAnswer,
    tries,
    hint,
    revealAnswer,
    showAnswer,
    patchCurrent,
    checking,
    error,
    reviewed,
    triesLeft: Math.max(0, MAX_TRIES - tries),
    start,
    practiceWord,
    stop,
    check,
    retry,
    dontKnow,
    remember,
    next,
  }
}

export type PracticeSession = ReturnType<typeof usePractice>
