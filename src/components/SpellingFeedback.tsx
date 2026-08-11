import { cn } from '../lib/format.ts'
import { Button } from './ui/Button.tsx'
import type { AlignmentCell, SpellingResult } from '../../shared/types.ts'

/**
 * Character-by-character comparison of the target word and what was typed.
 *
 * The rows are column-aligned, so a missing letter leaves a visible gap
 * directly beneath the letter it should have been.
 *
 * On a first slip the correct letters at the mistake positions stay masked —
 * the learner sees exactly *where* they went wrong and has to recall *what*
 * goes there. Matching letters are never masked: the learner already typed
 * those, so showing them gives nothing away. From the second attempt on (or
 * on request) everything is revealed.
 *
 * Colour is never the only signal — mismatches are also outlined, underlined
 * and described in text for screen readers.
 */

const CELL = 'flex h-9 min-w-9 items-center justify-center rounded-md px-1 font-mono text-lg'

function describeCell(cell: AlignmentCell): string {
  switch (cell.kind) {
    case 'match':
      return `${cell.expected}, correct`
    case 'missing':
      return `missing letter ${cell.expected}`
    case 'extra':
      return `extra letter ${cell.actual}`
    case 'wrong':
      return `should be ${cell.expected}, you typed ${cell.actual}`
    case 'swapped':
      return `${cell.expected} written as ${cell.actual}, letters swapped`
    case 'capitalization':
      return `${cell.expected} written as ${cell.actual}, wrong case`
  }
}

function ExpectedCell({ cell, reveal }: { cell: AlignmentCell; reveal: boolean }) {
  if (cell.expected === null) {
    // The answer has a character here that the word doesn't.
    return (
      <span className={cn(CELL, 'border border-dashed border-line-strong text-ink-3')}>·</span>
    )
  }
  if (cell.kind === 'match') {
    return <span className={cn(CELL, 'text-ink-2')}>{cell.expected}</span>
  }
  return (
    <span
      className={cn(
        CELL,
        'bg-accent-soft font-semibold text-accent ring-1 ring-accent/30',
        !reveal && 'text-accent/70',
      )}
    >
      {reveal ? cell.expected : '?'.repeat(cell.expected.length)}
    </span>
  )
}

function ActualCell({ cell }: { cell: AlignmentCell }) {
  if (cell.actual === null) {
    // A letter the learner left out — show the gap where it belongs.
    return (
      <span
        className={cn(
          CELL,
          'border-2 border-dashed border-danger/60 bg-danger-soft/50 text-danger',
        )}
        title="missing letter"
      >
        ␣
      </span>
    )
  }
  return (
    <span
      className={cn(
        CELL,
        cell.kind === 'match'
          ? 'text-ink'
          : 'bg-danger-soft font-semibold text-danger underline decoration-danger decoration-wavy decoration-2 underline-offset-4 ring-1 ring-danger/30',
      )}
    >
      {cell.actual}
    </span>
  )
}

interface SpellingFeedbackProps {
  result: SpellingResult
  word: string
  /** Reveal the correct letters at the mistake positions. */
  reveal: boolean
  /** Offered on a first slip so the learner can ask for the answer. */
  onReveal?: () => void
}

export function SpellingFeedback({ result, word, reveal, onReveal }: SpellingFeedbackProps) {
  if (result.differentWord && !reveal) {
    return (
      <div className="animate-rise rounded-xl bg-danger-soft px-4 py-3.5 text-sm text-danger">
        <p className="font-medium">That&apos;s not the word we&apos;re looking for.</p>
        <p className="mt-1 opacity-90">
          It has {word.length} letters. Read the meaning again and try once more.
        </p>
      </div>
    )
  }

  const mistakeCount = result.alignment.filter((cell) => cell.kind !== 'match').length

  return (
    <div className="animate-rise">
      <div className="overflow-x-auto rounded-xl bg-surface-2 p-3.5">
        <div className="min-w-fit">
          <div className="mb-2 flex items-center gap-3">
            <span className="w-20 shrink-0 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
              Correct
            </span>
            <div className="flex gap-1">
              {result.alignment.map((cell, index) => (
                <ExpectedCell key={`expected-${index}`} cell={cell} reveal={reveal} />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="w-20 shrink-0 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
              You typed
            </span>
            <div className="flex gap-1">
              {result.alignment.map((cell, index) => (
                <ActualCell key={`actual-${index}`} cell={cell} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* One plain-text description of the comparison, for screen readers. */}
      <p className="sr-only">
        {reveal
          ? `${result.alignment.map(describeCell).join('. ')}.`
          : `${mistakeCount} highlighted position${mistakeCount === 1 ? '' : 's'} to fix.`}
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 text-sm leading-relaxed text-ink-2">
          <span aria-hidden="true" className="mr-1.5">
            💡
          </span>
          {reveal
            ? result.explanation
            : `${mistakeCount === 1 ? 'One spot' : `${mistakeCount} spots`} to fix — the highlighted position${
                mistakeCount === 1 ? '' : 's'
              }. Can you recall what belongs there?`}
        </p>

        {!reveal && onReveal && (
          <Button size="sm" variant="ghost" onClick={onReveal}>
            Show me
          </Button>
        )}
      </div>
    </div>
  )
}
