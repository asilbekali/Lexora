import { useCallback, useEffect, useRef, useState } from 'react'

import { api } from '../lib/api.ts'
import { usePractice } from '../hooks/usePractice.ts'
import { useVocabulary } from '../hooks/useVocabulary.ts'
import { Alert } from './ui/Alert.tsx'
import { EditVocabularyDialog } from './EditVocabularyDialog.tsx'
import { Header } from './Header.tsx'
import { PracticeCard } from './PracticeCard.tsx'
import { ProgressStats } from './ProgressStats.tsx'
import { ShortcutsModal } from './ShortcutsModal.tsx'
import { VocabularyInput } from './VocabularyInput.tsx'
import { VocabularyList } from './VocabularyList.tsx'
import { Footer } from './Footer.tsx'
import type { Vocabulary, WordImage } from '../../shared/types.ts'

/** The single-page trainer: add words, practise them, review the list. */
export function Trainer() {
  const store = useVocabulary()
  const [editing, setEditing] = useState<Vocabulary | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(true)
  const [aiPaused, setAiPaused] = useState<string | null>(null)
  const practiceRef = useRef<HTMLDivElement>(null)

  const { applyVocabulary } = store

  const session = usePractice({
    words: store.vocabulary,
    onGraded: applyVocabulary,
  })

  // Whether AI is configured only changes the copy we show, so a failure here
  // is silently treated as "assume it works".
  useEffect(() => {
    api.ai
      .status()
      .then(({ enabled, pausedReason }) => {
        setAiEnabled(enabled)
        setAiPaused(pausedReason)
      })
      .catch(() => setAiEnabled(true))
  }, [])

  const { applyMemoryTip, applyImage } = store
  const { patchCurrent } = session

  /*
   * These must keep a stable identity — the flashcard lists them as effect
   * dependencies, so a new function on every render would restart its fetches
   * in a loop. Both update the list *and* the word being practised, so the
   * flashcard sees the value it just fetched and stops asking for it.
   */
  const onTipLoaded = useCallback(
    (id: string, tip: string) => {
      applyMemoryTip(id, tip)
      patchCurrent(id, { memoryTip: tip })
    },
    [applyMemoryTip, patchCurrent],
  )

  const onImageLoaded = useCallback(
    (id: string, image: WordImage | null) => {
      applyImage(id, image)
      patchCurrent(id, { image, imageSearched: true })
    },
    [applyImage, patchCurrent],
  )

  const { start: startPractice, practiceWord } = session

  const onPracticeWord = useCallback(
    (entry: Vocabulary) => {
      practiceWord(entry)
      practiceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    },
    [practiceWord],
  )

  // Global shortcuts. Escape and Enter are handled by the dialogs and forms
  // that own them; these are the app-level ones.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable

      if (event.key === '?' && !typing) {
        event.preventDefault()
        setShortcutsOpen(true)
        return
      }
      if (event.key === '/' && !typing) {
        event.preventDefault()
        document.getElementById('search')?.focus()
        return
      }
      if ((event.key === 's' || event.key === 'S') && !typing) {
        event.preventDefault()
        void startPractice()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [startPractice])

  return (
    <div className="min-h-dvh">
      <Header stats={store.stats} onShowShortcuts={() => setShortcutsOpen(true)} />

      <main className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-5 sm:gap-5 sm:py-8">
        <VocabularyInput
          onAdd={store.add}
          busy={store.busy}
          aiEnabled={aiEnabled && !aiPaused}
        />

        {aiPaused && (
          <Alert tone="warning" onDismiss={() => setAiPaused(null)}>
            AI is paused — {aiPaused}. Words are still saved with offline details.
          </Alert>
        )}

        {store.notice && (
          <Alert tone="info" onDismiss={() => store.setNotice(null)}>
            {store.notice}
          </Alert>
        )}
        {store.error && store.status !== 'error' && (
          <Alert tone="error" onRetry={() => void store.refresh()} onDismiss={store.clearError}>
            {store.error}
          </Alert>
        )}

        <div ref={practiceRef} className="scroll-mt-20">
          <PracticeCard
            session={session}
            stats={store.stats}
            hasWords={store.vocabulary.length > 0}
            onTipLoaded={onTipLoaded}
            onImageLoaded={onImageLoaded}
          />
        </div>

        <ProgressStats stats={store.stats} meta={store.meta} />

        <VocabularyList
          entries={store.vocabulary}
          hiddenId={session.phase === 'idle' ? null : (session.current?.id ?? null)}
          status={store.status}
          error={store.error}
          onRetry={() => void store.refresh()}
          onEdit={setEditing}
          onDelete={(id) => void store.remove(id)}
          onPractice={onPracticeWord}
          onSeed={() => void store.seed()}
          seeding={store.busy}
        />

        <Footer meta={store.meta} />
      </main>

      <EditVocabularyDialog
        entry={editing}
        onClose={() => setEditing(null)}
        onSave={store.update}
      />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  )
}
