import type { InputHTMLAttributes, Ref } from 'react'

import { cn } from '../../lib/format.ts'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  ref?: Ref<HTMLInputElement>
  invalid?: boolean
}

export function Input({ className, invalid, ...props }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cn(
        'w-full rounded-xl border bg-surface px-4 text-ink placeholder:text-ink-3',
        'h-11 transition-colors outline-none',
        'focus:border-accent disabled:cursor-not-allowed disabled:opacity-60',
        invalid ? 'border-danger' : 'border-line-strong',
        className,
      )}
      {...props}
    />
  )
}
