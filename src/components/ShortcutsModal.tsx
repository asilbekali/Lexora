import { Button } from './ui/Button.tsx'
import { Modal } from './ui/Modal.tsx'

const SHORTCUTS: { keys: string[]; description: string }[] = [
  { keys: ['Enter'], description: 'Check your answer, or continue to the next word' },
  { keys: ['Esc'], description: 'Close the flashcard or any dialog' },
  { keys: ['?'], description: 'Show this list' },
  { keys: ['S'], description: 'Start a practice session' },
  { keys: ['/'], description: 'Jump to the search box' },
]

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} labelledBy="shortcuts-title" className="sm:max-w-md">
      <div className="p-5 sm:p-6">
        <h2 id="shortcuts-title" className="text-lg font-semibold tracking-tight">
          Keyboard shortcuts
        </h2>

        <dl className="mt-4 flex flex-col gap-3">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.keys.join('+')} className="flex items-center gap-4">
              <dt className="flex w-16 shrink-0 gap-1">
                {shortcut.keys.map((key) => (
                  <kbd
                    key={key}
                    className="rounded-md border border-line-strong bg-surface-2 px-2 py-1 font-mono text-xs"
                  >
                    {key}
                  </kbd>
                ))}
              </dt>
              <dd className="text-sm text-ink-2">{shortcut.description}</dd>
            </div>
          ))}
        </dl>

        <Button onClick={onClose} className="mt-6 w-full">
          Got it
        </Button>
      </div>
    </Modal>
  )
}
