import { useEffect, useRef, type FormEvent } from 'react'

import { Button } from './ui/Button.tsx'
import { Input } from './ui/Input.tsx'

interface AnswerInputProps {
  value: string
  onChange: (value: string) => void
  onSubmit: () => void
  onDontKnow: () => void
  disabled?: boolean
  loading?: boolean
  /** Bumping this refocuses the field — e.g. when a new word appears. */
  focusKey: string
}

/** The typing surface: Enter submits, "I don't know" is always one tab away. */
export function AnswerInput({
  value,
  onChange,
  onSubmit,
  onDontKnow,
  disabled,
  loading,
  focusKey,
}: AnswerInputProps) {
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [focusKey])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    onSubmit()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <label htmlFor="answer" className="sr-only">
        Type the word
      </label>
      <Input
        ref={field}
        id="answer"
        name="answer"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder="Type the word…"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="none"
        spellCheck={false}
        enterKeyHint="done"
        className="h-14 text-center font-mono text-xl tracking-wide sm:text-2xl"
      />

      <div className="flex flex-col-reverse gap-2 sm:flex-row">
        <Button
          type="button"
          variant="secondary"
          size="lg"
          onClick={onDontKnow}
          disabled={disabled}
          className="sm:flex-1"
        >
          I don&apos;t know
        </Button>
        <Button
          type="submit"
          size="lg"
          loading={loading}
          disabled={disabled || value.trim().length === 0}
          className="sm:flex-[2]"
        >
          Check
        </Button>
      </div>
    </form>
  )
}
