import { useMemo, useState } from 'react'

import { Alert } from './ui/Alert.tsx'
import { Button } from './ui/Button.tsx'
import { Card } from './ui/Card.tsx'
import { Input } from './ui/Input.tsx'
import { VocabularyItem } from './VocabularyItem.tsx'
import type { LoadStatus } from '../hooks/useVocabulary.ts'
import type { MemorizationStatus, Vocabulary } from '../../shared/types.ts'

type Filter = 'all' | MemorizationStatus

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'learning', label: 'Learning' },
  { id: 'review', label: 'Review' },
  { id: 'mastered', label: 'Mastered' },
]

interface VocabularyListProps {
  entries: Vocabulary[]
  /** The word currently being practised — hidden so it cannot be read off. */
  hiddenId: string | null
  status: LoadStatus
  error: string | null
  onRetry: () => void
  onEdit: (entry: Vocabulary) => void
  onDelete: (id: string) => void
  onPractice: (entry: Vocabulary) => void
  onSeed: () => void
  seeding: boolean
}

export function VocabularyList({
  entries,
  hiddenId,
  status,
  error,
  onRetry,
  onEdit,
  onDelete,
  onPractice,
  onSeed,
  seeding,
}: VocabularyListProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return entries.filter((entry) => {
      // Never show the answer to the question on screen.
      if (entry.id === hiddenId) return false
      if (filter !== 'all' && entry.status !== filter) return false
      if (!needle) return true
      return (
        entry.word.toLowerCase().includes(needle) ||
        entry.meaning.toLowerCase().includes(needle) ||
        entry.simpleMeaning.toLowerCase().includes(needle)
      )
    })
  }, [entries, filter, hiddenId, query])

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line p-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-semibold">
            Your words
            <span className="ml-2 font-normal text-ink-3">{entries.length}</span>
          </h2>
          {hiddenId && (
            <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-[11px] font-medium text-accent">
              1 hidden while you practise
            </span>
          )}
          <div className="ml-auto w-full sm:w-56">
            <label htmlFor="search" className="sr-only">
              Search words
            </label>
            <Input
              id="search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search…"
              className="h-9 text-sm"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                filter === item.id
                  ? 'bg-accent text-accent-ink'
                  : 'bg-surface-2 text-ink-2 hover:bg-surface-3'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {status === 'error' && (
        <div className="p-4">
          <Alert tone="error" onRetry={onRetry}>
            {error ?? 'Could not load your vocabulary.'}
          </Alert>
        </div>
      )}

      {status === 'loading' && (
        <ul className="divide-y divide-line">
          {[0, 1, 2].map((row) => (
            <li key={row} className="flex flex-col gap-2 px-4 py-4">
              <div className="h-3.5 w-28 animate-pulse rounded bg-surface-3" />
              <div className="h-3 w-2/3 animate-pulse rounded bg-surface-2" />
            </li>
          ))}
        </ul>
      )}

      {status === 'ready' && entries.length === 0 && (
        <div className="px-4 py-10 text-center">
          <p className="text-sm text-ink-2">No words yet.</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-ink-3">
            Add one above, or load ten demo words to try the trainer right away.
          </p>
          <Button variant="secondary" onClick={onSeed} loading={seeding} className="mt-4">
            Load demo words
          </Button>
        </div>
      )}

      {status === 'ready' && entries.length > 0 && visible.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-ink-3">
          {query || filter !== 'all'
            ? `Nothing matches “${query}”${filter !== 'all' ? ` in ${filter}` : ''}.`
            : 'The only word here is the one you are practising.'}
        </p>
      )}

      {visible.length > 0 && (
        <ul className="divide-y divide-line">
          {visible.map((entry) => (
            <VocabularyItem
              key={entry.id}
              entry={entry}
              onEdit={onEdit}
              onDelete={onDelete}
              onPractice={onPractice}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}
