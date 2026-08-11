import { Router } from 'express'

import { requireAuth } from '../auth.ts'
import { aiStatus, explainWord, generateMemoryTip, generateVocabularyInfo } from '../ai.ts'
import { findVocabulary, updateVocabulary } from '../store.ts'
import {
  addVocabularySchema,
  explainSchema,
  memoryTipSchema,
  validate,
} from '../validation.ts'

export const aiRouter = Router()

aiRouter.use(requireAuth)

aiRouter.get('/status', (_req, res) => {
  res.json(aiStatus())
})

/** Structured vocabulary information — the endpoint named in the spec. */
aiRouter.post('/vocabulary', validate(addVocabularySchema), async (req, res) => {
  const { word } = req.body as { word: string }
  const result = await generateVocabularyInfo(word)
  res.json({ vocabulary: result.data, source: result.source, warning: result.warning })
})

/** Mnemonic for the flashcard; cached on the word so we only pay once. */
aiRouter.post('/memory-tip', validate(memoryTipSchema), async (req, res) => {
  const userId = req.user!.id
  const { vocabularyId } = req.body as { vocabularyId: string }

  const entry = findVocabulary(userId, vocabularyId)
  if (!entry) {
    res.status(404).json({ error: 'Word not found.', code: 'not_found' })
    return
  }
  if (entry.memoryTip) {
    res.json({ memoryTip: entry.memoryTip, source: 'cache' })
    return
  }

  const tip = await generateMemoryTip(entry.word, entry.meaning, entry.simpleMeaning)
  updateVocabulary(userId, entry.id, { memoryTip: tip.data })
  res.json({ memoryTip: tip.data, source: tip.source, warning: tip.warning })
})

/** Deeper explanation of a difficult word, requested from the flashcard. */
aiRouter.post('/explain', validate(explainSchema), async (req, res) => {
  const entry = findVocabulary(req.user!.id, (req.body as { vocabularyId: string }).vocabularyId)
  if (!entry) {
    res.status(404).json({ error: 'Word not found.', code: 'not_found' })
    return
  }

  const explanation = await explainWord(entry.word, entry.meaning)
  res.json({
    explanation: explanation.data,
    source: explanation.source,
    warning: explanation.warning,
  })
})
