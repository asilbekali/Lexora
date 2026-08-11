import { useAuth } from '../hooks/useAuth.ts'
import { useTheme } from '../hooks/useTheme.ts'
import { Button } from './ui/Button.tsx'
import { Logo } from './Logo.tsx'
import type { Stats } from '../../shared/types.ts'

interface HeaderProps {
  stats: Stats
  onShowShortcuts: () => void
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col leading-tight">
      <span className="text-sm font-semibold tabular-nums">{value}</span>
      <span className="text-[11px] text-ink-3">{label}</span>
    </div>
  )
}

export function Header({ stats, onShowShortcuts }: HeaderProps) {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()

  const progress = stats.total === 0 ? 0 : Math.round((stats.mastered / stats.total) * 100)

  return (
    <header className="sticky top-0 z-30 border-b border-line bg-canvas/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-4xl items-center gap-3 px-4 sm:gap-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <Logo />
          <span className="truncate text-base font-semibold tracking-tight">Lexora</span>
        </div>

        {/* Progress: a compact bar on desktop, just the number on mobile. */}
        <div className="ml-auto flex items-center gap-4 sm:gap-5">
          <div className="hidden items-center gap-2.5 md:flex">
            <div
              className="h-1.5 w-24 overflow-hidden rounded-full bg-surface-3"
              role="progressbar"
              aria-valuenow={progress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Words mastered"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-500"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="text-xs text-ink-3 tabular-nums">{progress}%</span>
          </div>

          <div className="flex items-center gap-4">
            <Metric label="words" value={stats.total} />
            <Metric label="streak" value={`${stats.streak}d`} />
          </div>

          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={toggle}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onShowShortcuts}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
              className="hidden sm:inline-flex"
            >
              ?
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void logout()}
              title={user ? `Signed in as ${user.username}` : undefined}
            >
              Log out
            </Button>
          </div>
        </div>
      </div>
    </header>
  )
}
