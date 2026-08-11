/**
 * Vocabulary data layer.
 *
 * Owns the word list, aggregate stats and storage metadata, and exposes the
 * mutations the UI needs. Every async path reports loading / success / error
 * so no screen can get stuck on a spinner.
 */

import { useCallback, useEffect, useRef, useState } from 'react'

import { api, errorMessage } from '../lib/api.ts'
import type {
  Stats,
  StorageMeta,
  Vocabulary,
  VocabularyInfo,
  VocabularyResponse,
} from '../../shared/types.ts'

export type LoadStatus = 'loading' | 'ready' | 'error'

const EMPTY_STATS: Stats = {
  total: 0,
  mastered: 0,
  learning: 0,
  needsReview: 0,
  sessions: 0,
  correct: 0,
  spellingMistakes: 0,
  accuracy: 0,
  streak: 0,
}

export function useVocabulary() {
  const [vocabulary, setVocabulary] = useState<Vocabulary[]>([])
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [meta, setMeta] = useState<StorageMeta | null>(null)

  const [status, setStatus] = useState<LoadStatus>('loading')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const applySnapshot = useCallback((data: VocabularyResponse) => {
    setVocabulary(data.vocabulary)
    setStats(data.stats)
    setMeta(data.meta)
    setStatus('ready')
  }, [])

  const applyLoadError = useCallback((cause: unknown) => {
    setError(errorMessage(cause))
    setStatus('error')
  }, [])

  // Initial load. `status` already starts as 'loading', so nothing needs to be
  // set before the request resolves.
  useEffect(() => {
    let cancelled = false

    api.vocabulary
      .list()
      .then((data) => {
        if (!cancelled) applySnapshot(data)
      })
      .catch((cause: unknown) => {
        if (!cancelled) applyLoadError(cause)
      })

    return () => {
      cancelled = true
    }
  }, [applySnapshot, applyLoadError])

  /** Manual reload — shows the loading state again. Call from event handlers. */
  const refresh = useCallback(async () => {
    setStatus('loading')
    setError(null)
    try {
      const data = await api.vocabulary.list()
      if (mounted.current) applySnapshot(data)
    } catch (cause) {
      if (mounted.current) applyLoadError(cause)
    }
  }, [applySnapshot, applyLoadError])

  const clearError = useCallback(() => setError(null), [])

  /**
   * Patches one field on one word using a functional update, so these keep a
   * stable identity forever. That matters: they are dependencies of effects in
   * <Flashcard>, and a changing identity there would re-fire the fetch in a
   * loop.
   */
  const applyMemoryTip = useCallback((id: string, memoryTip: string) => {
    setVocabulary((current) =>
      current.map((item) => (item.id === id ? { ...item, memoryTip } : item)),
    )
  }, [])

  const applyImage = useCallback((id: string, image: Vocabulary['image']) => {
    setVocabulary((current) =>
      current.map((item) =>
        item.id === id ? { ...item, image, imageSearched: true } : item,
      ),
    )
  }, [])

  /** Splices an updated word back into the list (used after practice). */
  const applyVocabulary = useCallback((entry: Vocabulary, nextStats?: Stats) => {
    setVocabulary((current) =>
      current.map((item) => (item.id === entry.id ? entry : item)),
    )
    if (nextStats) setStats(nextStats)
  }, [])

  const add = useCallback(async (word: string) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const data = await api.vocabulary.add(word)
      if (!mounted.current) return null
      setVocabulary((current) => [data.vocabulary, ...current])
      setStats(data.stats)
      setMeta(data.meta)
      if (data.warning) setNotice(data.warning)
      return data.vocabulary
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause))
      throw cause
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  const update = useCallback(
    async (id: string, patch: Partial<VocabularyInfo> & { memoryTip?: string | null }) => {
      setError(null)
      try {
        const data = await api.vocabulary.update(id, patch)
        if (!mounted.current) return null
        applyVocabulary(data.vocabulary, data.stats)
        return data.vocabulary
      } catch (cause) {
        if (mounted.current) setError(errorMessage(cause))
        throw cause
      }
    },
    [applyVocabulary],
  )

  // Live reference to the current list, for the optimistic delete below.
  const vocabularyRef = useRef<Vocabulary[]>([])
  useEffect(() => {
    vocabularyRef.current = vocabulary
  }, [vocabulary])

  const remove = useCallback(async (id: string) => {
    setError(null)
    // Optimistic: the row disappears immediately, and comes back on failure.
    const snapshot = vocabularyRef.current
    setVocabulary((current) => current.filter((item) => item.id !== id))
    try {
      const data = await api.vocabulary.remove(id)
      if (!mounted.current) return
      setStats(data.stats)
      setMeta(data.meta)
    } catch (cause) {
      if (!mounted.current) return
      setVocabulary(snapshot)
      setError(errorMessage(cause))
      throw cause
    }
  }, [])

  const seed = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await api.vocabulary.seed()
      if (!mounted.current) return
      setVocabulary(data.vocabulary)
      setStats(data.stats)
      setMeta(data.meta)
      setNotice(`Added ${data.created} demo words — edit or delete them any time.`)
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  const enrich = useCallback(
    async (id: string) => {
      setError(null)
      try {
        const data = await api.vocabulary.enrich(id)
        if (!mounted.current) return
        applyVocabulary(data.vocabulary, data.stats)
        setNotice(data.warning ?? 'Word details refreshed.')
      } catch (cause) {
        if (mounted.current) setError(errorMessage(cause))
        throw cause
      }
    },
    [applyVocabulary],
  )

  const clearAll = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const data = await api.vocabulary.reset()
      if (!mounted.current) return
      setVocabulary(data.vocabulary)
      setStats(data.stats)
      setMeta(data.meta)
      setNotice('Vocabulary store cleared.')
    } catch (cause) {
      if (mounted.current) setError(errorMessage(cause))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }, [])

  return {
    vocabulary,
    stats,
    meta,
    status,
    error,
    busy,
    notice,
    setNotice,
    clearError,
    applyMemoryTip,
    applyImage,
    setStats,
    refresh,
    add,
    update,
    remove,
    seed,
    enrich,
    clearAll,
    applyVocabulary,
  }
}

export type VocabularyStore = ReturnType<typeof useVocabulary>
