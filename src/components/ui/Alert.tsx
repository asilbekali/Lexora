import type { ReactNode } from 'react'

import { cn } from '../../lib/format.ts'
import { Button } from './Button.tsx'

type Tone = 'error' | 'warning' | 'info'

const TONES: Record<Tone, string> = {
  error: 'bg-danger-soft text-danger',
  warning: 'bg-warning-soft text-warning',
  info: 'bg-accent-soft text-accent',
}

interface AlertProps {
  tone?: Tone
  children: ReactNode
  onRetry?: () => void
  onDismiss?: () => void
  className?: string
}

/** Inline status strip: every failed async action gets one, with a way out. */
export function Alert({ tone = 'error', children, onRetry, onDismiss, className }: AlertProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3.5 py-2.5 text-sm',
        TONES[tone],
        className,
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry && (
        <Button size="sm" variant="ghost" className="text-current" onClick={onRetry}>
          Retry
        </Button>
      )}
      {onDismiss && (
        <Button
          size="sm"
          variant="ghost"
          className="text-current"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          Dismiss
        </Button>
      )}
    </div>
  )
}
