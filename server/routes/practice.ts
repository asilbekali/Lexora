import { Router } from 'express'

import { requireAuth } from '../auth.ts'
import { computeStats, findVocabulary, recordAttempt, startSession } from '../store.ts'
import { attemptSchema, validate } from '../validation.ts'
import { compareSpelling } from '../../shared/spelling.ts'
import type { AttemptOutcome } from '../../shared/types.ts'

export const practiceRouter = Router()

practiceRouter.use(requireAuth)

practiceRouter.post('/session', (req, res) => {
  res.json({ sessions: startSession(req.user!.id) })
})

/**
 * Grades one answer.
 *
 * The spelling comparison is re-run here rather than trusting whatever the
 * client computed — the client's copy exists only for instant feedback.
 */
practiceRouter.post('/attempt', validate(attemptSchema), (req, res) => {
  const userId = req.user!.id
  const { vocabularyId, answer, revealed } = req.body as {
    vocabularyId: string
    answer: string
    revealed?: boolean
  }

  const entry = findVocabulary(userId, vocabularyId)
  if (!entry) {
    res.status(404).json({ error: 'Word not found.', code: 'not_found' })
    return
  }

  const result = compareSpelling(entry.word, answer)

  let outcome: AttemptOutcome
  if (revealed) outcome = 'revealed'
  else if (result.correct) outcome = 'correct'
  else if (result.differentWord) outcome = 'wrong'
  else outcome = 'misspelled'

  const recorded = recordAttempt(userId, vocabularyId, answer, outcome, result.distance)
  if (!recorded) {
    res.status(404).json({ error: 'Word not found.', code: 'not_found' })
    return
  }

  res.json({
    result,
    outcome,
    vocabulary: recorded.vocabulary,
    stats: computeStats(userId),
  })
})
