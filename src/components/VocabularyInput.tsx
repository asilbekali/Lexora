import { useState, type FormEvent } from 'react'

import { Button } from './ui/Button.tsx'
import { Card } from './ui/Card.tsx'
import { Input } from './ui/Input.tsx'

interface VocabularyInputProps {
  onAdd: (word: string) => Promise<unknown>
  busy: boolean
  aiEnabled: boolean
}

/** The one place new words come in. AI fills in everything else. */
export function VocabularyInput({ onAdd, busy, aiEnabled }: VocabularyInputProps) {
  const [word, setWord] = useState('')
  const [justAdded, setJustAdded] = useState<string | null>(null)

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    const value = word.trim()
    if (!value || busy) return

    try {
      await onAdd(value)
      setWord('')
      setJustAdded(value)
      window.setTimeout(() => setJustAdded(null), 2600)
    } catch {
      // The store surfaces the error; leave the text so it can be corrected.
    }
  }

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={onSubmit} className="flex flex-col gap-2.5 sm:flex-row">
        <div className="flex-1">
          <label htmlFor="new-word" className="sr-only">
            Add a vocabulary word
          </label>
          <Input
            id="new-word"
            name="word"
            value={word}
            onChange={(event) => setWord(event.target.value)}
            placeholder="Add a word — e.g. ubiquitous"
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
          />
        </div>
        <Button type="submit" loading={busy} disabled={!word.trim()} className="sm:min-w-28">
          {busy ? 'Looking up…' : 'Add word'}
        </Button>
      </form>

      <p className="mt-2.5 text-xs text-ink-3" aria-live="polite">
        {justAdded ? (
          <span className="text-success">Added “{justAdded}”.</span>
        ) : aiEnabled ? (
          'The meaning, pronunciation, example and memory tip are generated for you.'
        ) : (
          'AI is off — words are filled from the built-in dictionary; you can edit any details.'
        )}
      </p>
    </Card>
  )
}
