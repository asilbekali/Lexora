import { useState } from 'react'

import { STATUS_CLASSES, STATUS_LABELS, accuracyPercent, relativeTime } from '../lib/format.ts'
import { Badge } from './ui/Badge.tsx'
import { Button } from './ui/Button.tsx'
import type { Vocabulary } from '../../shared/types.ts'

interface VocabularyItemProps {
  entry: Vocabulary
  onEdit: (entry: Vocabulary) => void
  onDelete: (id: string) => void
  onPractice: (entry: Vocabulary) => void
}

export function VocabularyItem({ entry, onEdit, onDelete, onPractice }: VocabularyItemProps) {
  // Inline confirmation — no blocking browser dialogs.
  const [confirming, setConfirming] = useState(false)

  return (
    <li className="group flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-surface-2 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium">{entry.word}</span>
          <Badge className={STATUS_CLASSES[entry.status]}>{STATUS_LABELS[entry.status]}</Badge>
          <Badge className="bg-surface-3 text-ink-2">{entry.difficulty}</Badge>
          {entry.needsEnrichment && (
            <Badge className="bg-warning-soft text-warning">needs details</Badge>
          )}
        </div>
        <p className="mt-0.5 truncate text-sm text-ink-2">
          {entry.meaning || <span className="text-ink-3 italic">No meaning saved yet</span>}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-3 text-xs text-ink-3 tabular-nums">
        <span title={`${entry.correct}/${entry.attempts} correct`}>
          {entry.attempts > 0 ? `${accuracyPercent(entry)}%` : '—'}
        </span>
        <span title="Spelling mistakes">✎ {entry.spellingMistakes}</span>
        <span className="hidden md:inline" title={`Next review ${entry.nextReviewAt}`}>
          {relativeTime(entry.nextReviewAt)}
        </span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {confirming ? (
          <>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirming(false)
                onDelete(entry.id)
              }}
            >
              Delete
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="ghost" onClick={() => onPractice(entry)}>
              Practise
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onEdit(entry)}>
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setConfirming(true)}
              aria-label={`Delete ${entry.word}`}
            >
              ✕
            </Button>
          </>
        )}
      </div>
    </li>
  )
}
