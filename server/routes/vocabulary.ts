import { Router } from 'express'

import { requireAuth } from '../auth.ts'
import { generateMemoryTip, generateVocabularyInfo } from '../ai.ts'
import { daysUntilReset, nextResetAt, getDb, resetStore } from '../db.ts'
import { findWordImage } from '../images.ts'
import { config } from '../env.ts'
import {
  computeStats,
  createVocabulary,
  deleteVocabulary,
  findByWord,
  findVocabulary,
  listVocabulary,
  seedVocabulary,
  setVocabularyImage,
  updateVocabulary,
  type EditableVocabulary,
} from '../store.ts'
import { addVocabularySchema, updateVocabularySchema, validate } from '../validation.ts'
import type { StorageMeta } from '../../shared/types.ts'

export const vocabularyRouter = Router()

vocabularyRouter.use(requireAuth)

function storageMeta(): StorageMeta {
  return {
    lastResetAt: getDb().lastResetAt,
    nextResetAt: nextResetAt().toISOString(),
    daysUntilReset: daysUntilReset(),
    autoResetEnabled: config.autoReset.enabled,
    resetIntervalDays: config.autoReset.intervalDays,
  }
}

function snapshot(userId: string) {
  return {
    vocabulary: listVocabulary(userId),
    stats: computeStats(userId),
    meta: storageMeta(),
  }
}

/** Full state for the single-page UI: words + stats + storage lifecycle. */
vocabularyRouter.get('/', (req, res) => {
  res.json(snapshot(req.user!.id))
})

/** Add a word; AI fills in the details, falling back to offline data. */
vocabularyRouter.post('/', validate(addVocabularySchema), async (req, res) => {
  const userId = req.user!.id
  const { word } = req.body as { word: string }

  const duplicate = findByWord(userId, word)
  if (duplicate) {
    res.status(409).json({
      error: `"${word}" is already in your list.`,
      code: 'duplicate',
      vocabulary: duplicate,
    })
    return
  }

  const info = await generateVocabularyInfo(word)

  // Keep the learner's spelling as the thing they practise, even if the AI
  // normalised it — unless they typed something the AI clearly corrected.
  const resolved = { ...info.data, word: info.data.word || word }

  // The mnemonic is deliberately *not* generated here. Most words never reach
  // a flashcard, so paying for a second round-trip on every add would double
  // the wait for nothing. `/api/ai/memory-tip` fills it in on first use and
  // caches it on the word.
  const entry = createVocabulary(userId, resolved, {
    memoryTip: null,
    needsEnrichment: info.source === 'offline' && resolved.meaning.trim().length === 0,
  })

  res.status(201).json({
    vocabulary: entry,
    stats: computeStats(userId),
    meta: storageMeta(),
    source: info.source,
    warning: info.warning,
  })
})

/** Load the demo word list. */
vocabularyRouter.post('/seed', (req, res) => {
  const userId = req.user!.id
  const created = seedVocabulary(userId)
  res.status(201).json({ ...snapshot(userId), created: created.length })
})

vocabularyRouter.patch('/:id', validate(updateVocabularySchema), (req, res) => {
  const userId = req.user!.id
  const updated = updateVocabulary(userId, String(req.params.id), req.body as EditableVocabulary)

  if (!updated) {
    res.status(404).json({ error: 'Word not found.', code: 'not_found' })
    return
  }
  res.json({ vocabulary: updated, stats: computeStats(userId), meta: storageMeta() })
})

vocabularyRouter.delete('/:id', (req, res) => {
  const userId = req.user!.id
  if (!deleteVocabulary(userId, String(req.params.id))) {
    res.status(404).json({ error: 'Word not found.', code: 'not_found' })
    return
  }
  res.json({ ok: true, stats: computeStats(userId), meta: storageMeta() })
})

/** Re-run AI enrichment for a single word (retry after an AI failure). */
vocabularyRouter.post('/:id/enrich', async (req, res) => {
  const userId = req.user!.id
  const entry = findVocabulary(userId, String(req.params.id))
  if (!entry) {
    res.status(404).json({ error: 'Word not found.', code: 'not_found' })
    return
  }

  const info = await generateVocabularyInfo(entry.word)
  if (info.source === 'offline' && !info.data.meaning) {
    res.status(503).json({
      error: info.warning ?? 'AI is unavailable right now.',
      code: 'ai_unavailable',
      retryable: true,
    })
    return
  }

  const tip = await generateMemoryTip(entry.word, info.data.meaning, info.data.simpleMeaning)
  const updated = updateVocabulary(userId, entry.id, { ...info.data, memoryTip: tip.data })

  res.json({
    vocabulary: updated,
    stats: computeStats(userId),
    meta: storageMeta(),
    source: info.source,
    warning: info.warning,
  })
})

/**
 * Finds a freely-licensed illustration for a word and caches it.
 *
 * Called by the flashcard on first view. Once searched, the answer (image or
 * null) is stored so we never look again for the same word.
 */
vocabularyRouter.post('/:id/image', async (req, res) => {
  const userId = req.user!.id
  const entry = findVocabulary(userId, String(req.params.id))
  if (!entry) {
    res.status(404).json({ error: 'Word not found.', code: 'not_found' })
    return
  }

  if (entry.imageSearched) {
    res.json({ image: entry.image, cached: true })
    return
  }

  const image = await findWordImage(entry.word, entry.simpleMeaning)
  setVocabularyImage(userId, entry.id, image)
  res.json({ image, cached: false })
})

/** Manual equivalent of the monthly auto-clear. */
vocabularyRouter.post('/reset', (req, res) => {
  resetStore('manual')
  res.json(snapshot(req.user!.id))
})
