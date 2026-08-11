import type { StorageMeta } from '../../shared/types.ts'

/** Site footer. Shown on both the sign-in screen and the trainer. */
export function Footer({ meta }: { meta?: StorageMeta | null }) {
  return (
    <footer className="px-4 pt-2 pb-6 text-center text-xs text-ink-3">
      {meta?.autoResetEnabled && (
        <p className="mb-1.5">
          Your words are saved on the server and cleared automatically every{' '}
          {meta.resetIntervalDays} days — next on{' '}
          {new Date(meta.nextResetAt).toLocaleDateString()}.
        </p>
      )}
      <p>
        Supported by{' '}
        <span className="font-medium text-ink-2">TH&#8209;Labs</span>
      </p>
    </footer>
  )
}
