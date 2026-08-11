import { useState, type FormEvent } from 'react'

import { errorMessage } from '../lib/api.ts'
import { Alert } from './ui/Alert.tsx'
import { Button } from './ui/Button.tsx'
import { Input } from './ui/Input.tsx'
import { Modal } from './ui/Modal.tsx'
import type { CEFRLevel, Vocabulary, VocabularyInfo } from '../../shared/types.ts'

type Patch = Partial<VocabularyInfo> & { memoryTip?: string | null }

interface EditVocabularyDialogProps {
  entry: Vocabulary | null
  onClose: () => void
  onSave: (id: string, patch: Patch) => Promise<unknown>
}

const LEVELS: CEFRLevel[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2']

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
    </label>
  )
}

export function EditVocabularyDialog({ entry, onClose, onSave }: EditVocabularyDialogProps) {
  // The draft holds raw strings for the fields actually touched; it is
  // converted to a typed patch on submit.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!entry) return null

  const value = (key: keyof Patch): string => {
    const edited = draft[key]
    if (edited !== undefined) return edited
    const original = entry[key as keyof Vocabulary]
    if (original === null || original === undefined) return ''
    return Array.isArray(original) ? original.join(', ') : String(original)
  }

  const set = (key: keyof Patch, next: string) => {
    setDraft((current) => ({ ...current, [key]: next }))
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!entry || saving) return

    setSaving(true)
    setError(null)
    try {
      const { synonyms, difficulty, ...rest } = draft
      const patch: Patch = { ...rest }
      if (synonyms !== undefined) {
        patch.synonyms = synonyms
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      }
      if (difficulty !== undefined) patch.difficulty = difficulty as CEFRLevel
      await onSave(entry.id, patch)
      onClose()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} labelledBy="edit-title">
      <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 id="edit-title" className="text-lg font-semibold tracking-tight">
          Edit “{entry.word}”
        </h2>

        <Row label="Word">
          <Input value={value('word')} onChange={(event) => set('word', event.target.value)} />
        </Row>

        <Row label="Meaning">
          <textarea
            value={value('meaning')}
            onChange={(event) => set('meaning', event.target.value)}
            rows={2}
            className="w-full resize-y rounded-xl border border-line-strong bg-surface px-4 py-2.5 text-ink outline-none focus:border-accent"
          />
        </Row>

        <Row label="Simple meaning">
          <Input
            value={value('simpleMeaning')}
            onChange={(event) => set('simpleMeaning', event.target.value)}
          />
        </Row>

        <div className="grid grid-cols-2 gap-3">
          <Row label="Part of speech">
            <Input
              value={value('partOfSpeech')}
              onChange={(event) => set('partOfSpeech', event.target.value)}
            />
          </Row>
          <Row label="Pronunciation">
            <Input
              value={value('pronunciation')}
              onChange={(event) => set('pronunciation', event.target.value)}
              className="font-mono"
            />
          </Row>
        </div>

        <Row label="Example">
          <Input
            value={value('example')}
            onChange={(event) => set('example', event.target.value)}
          />
        </Row>

        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Row label="Synonyms (comma separated)">
            <Input
              value={value('synonyms')}
              onChange={(event) => set('synonyms', event.target.value)}
            />
          </Row>
          <Row label="Level">
            <select
              value={value('difficulty')}
              onChange={(event) => set('difficulty', event.target.value)}
              className="h-11 rounded-xl border border-line-strong bg-surface px-3 text-ink outline-none focus:border-accent"
            >
              {LEVELS.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </Row>
        </div>

        <Row label="Memory tip">
          <Input
            value={value('memoryTip')}
            onChange={(event) => set('memoryTip', event.target.value)}
          />
        </Row>

        {error && <Alert tone="error">{error}</Alert>}

        <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} type="button">
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  )
}
