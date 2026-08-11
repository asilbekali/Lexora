import { useEffect } from 'react'

import { blankOut } from '../lib/format.ts'
import { Alert } from './ui/Alert.tsx'
import { Badge } from './ui/Badge.tsx'
import { Button } from './ui/Button.tsx'
import { Card } from './ui/Card.tsx'
import { AnswerInput } from './AnswerInput.tsx'
import { Flashcard } from './Flashcard.tsx'
import { SpellingFeedback } from './SpellingFeedback.tsx'
import type { PracticeSession } from '../hooks/usePractice.ts'
import type { Stats, WordImage } from '../../shared/types.ts'

interface PracticeCardProps {
  session: PracticeSession
  stats: Stats
  hasWords: boolean
  onTipLoaded: (id: string, tip: string) => void
  onImageLoaded: (id: string, image: WordImage | null) => void
}

export function PracticeCard({
  session,
  stats,
  hasWords,
  onTipLoaded,
  onImageLoaded,
}: PracticeCardProps) {
  const { phase, current, result } = session
  const succeeded = phase === 'feedback' && result?.correct === true

  // Enter advances through the feedback step, mirroring the answer form.
  useEffect(() => {
    if (phase !== 'feedback') return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Enter') return
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return

      event.preventDefault()
      if (succeeded) session.next()
      else session.retry()
    }

    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [phase, succeeded, session])

  // ---------------------------------------------------------------- idle ---
  if (phase === 'idle' || !current) {
    return (
      <Card className="p-6 text-center sm:p-10">
        <h2 className="text-xl font-semibold tracking-tight sm:text-2xl">
          {hasWords ? 'Ready to practise?' : 'Add your first word'}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-ink-2">
          {hasWords ? (
            <>
              {stats.needsReview > 0
                ? `${stats.needsReview} word${stats.needsReview === 1 ? '' : 's'} due for review.`
                : 'Nothing is due right now — a quick round still helps.'}{' '}
              You&apos;ll see a meaning and type the word that matches.
            </>
          ) : (
            <>
              Type a word above and it&apos;ll be looked up automatically — meaning,
              pronunciation, an example and a memory tip.
            </>
          )}
        </p>

        {hasWords && (
          <Button size="lg" onClick={() => void session.start()} className="mt-6 min-w-52">
            Start practice
          </Button>
        )}
      </Card>
    )
  }

  // ----------------------------------------------------------- flashcard ---
  if (phase === 'flashcard') {
    return (
      <Card className="p-5 sm:p-7">
        <div className="mb-4 flex items-center justify-between">
          <Badge className="bg-accent-soft text-accent">Flashcard</Badge>
          <Button size="sm" variant="ghost" onClick={session.stop}>
            End session
          </Button>
        </div>
        {session.error && <Alert tone="warning" className="mb-4">{session.error}</Alert>}
        {/* Keyed per word so the card fetches its own tip and resets cleanly. */}
        <Flashcard
          key={current.id}
          entry={current}
          onRemember={session.remember}
          onTipLoaded={onTipLoaded}
          onImageLoaded={onImageLoaded}
        />
      </Card>
    )
  }

  // ---------------------------------------------------- prompt / feedback ---
  return (
    <Card className="p-5 sm:p-7">
      <div className="mb-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Badge className="bg-surface-3 text-ink-2">
            {session.reviewed} done this session
          </Badge>
          {session.tries > 0 && !succeeded && (
            <Badge className="bg-warning-soft text-warning">
              {session.triesLeft} {session.triesLeft === 1 ? 'try' : 'tries'} left
            </Badge>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={session.stop}>
          End session
        </Button>
      </div>

      <div className="text-center">
        <p className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">
          What word means
        </p>
        <p className="mx-auto mt-2.5 max-w-lg text-xl leading-snug font-medium text-balance sm:text-2xl">
          “{current.meaning || current.simpleMeaning || 'No definition saved for this word yet.'}”
        </p>

        <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm text-ink-3">
          {current.partOfSpeech && <span>{current.partOfSpeech}</span>}
          {current.partOfSpeech && <span aria-hidden="true">·</span>}
          <span>{current.word.length} letters</span>
          {current.simpleMeaning && current.meaning && (
            <>
              <span aria-hidden="true">·</span>
              <span>{current.simpleMeaning}</span>
            </>
          )}
        </div>

        {current.example && (
          <p className="mx-auto mt-4 max-w-lg rounded-xl bg-surface-2 px-4 py-3 text-sm text-ink-2 italic">
            {blankOut(current.example, current.word)}
          </p>
        )}
      </div>

      <div className="mt-6">
        {phase === 'prompt' && (
          <AnswerInput
            value={session.answer}
            onChange={session.setAnswer}
            onSubmit={() => void session.check()}
            onDontKnow={() => void session.dontKnow()}
            loading={session.checking}
            focusKey={`${current.id}:${session.tries}`}
          />
        )}

        {phase === 'feedback' && result && (
          <div className="flex flex-col gap-4">
            {succeeded ? (
              <div className="animate-pop rounded-xl bg-success-soft px-4 py-5 text-center">
                <p className="text-sm font-semibold text-success">
                  {result.caseOnly ? 'Correct — mind the capitals' : 'Correct!'}
                </p>
                <p className="mt-1.5 font-mono text-2xl font-semibold tracking-wide text-ink">
                  {current.word}
                </p>
                {result.caseOnly && (
                  <p className="mt-1.5 text-sm text-ink-2">{result.explanation}</p>
                )}
              </div>
            ) : (
              <>
                <p className="text-center text-sm font-semibold text-danger">
                  {result.differentWord
                    ? 'Not quite — that’s a different word.'
                    : 'Almost! There’s a spelling mistake.'}
                </p>
                <SpellingFeedback
                  result={result}
                  word={current.word}
                  reveal={session.revealAnswer}
                  onReveal={session.showAnswer}
                />
                {session.hint && (
                  <p className="rounded-xl bg-warning-soft px-4 py-3 text-sm text-warning">
                    <span aria-hidden="true" className="mr-1.5">
                      🧭
                    </span>
                    {session.hint}
                  </p>
                )}
              </>
            )}

            {session.error && <Alert tone="warning">{session.error}</Alert>}

            <div className="flex flex-col-reverse gap-2 sm:flex-row">
              {!succeeded && (
                <Button
                  variant="secondary"
                  size="lg"
                  onClick={() => void session.dontKnow()}
                  className="sm:flex-1"
                >
                  Show flashcard
                </Button>
              )}
              <Button
                size="lg"
                variant={succeeded ? 'success' : 'primary'}
                onClick={succeeded ? session.next : session.retry}
                className="sm:flex-[2]"
                autoFocus
              >
                {succeeded ? 'Continue' : 'Try again'}
                <kbd className="ml-1 hidden rounded bg-black/15 px-1.5 py-0.5 text-[11px] font-medium sm:inline">
                  ↵
                </kbd>
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
