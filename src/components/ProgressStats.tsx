import { Card } from './ui/Card.tsx'
import type { Stats, StorageMeta } from '../../shared/types.ts'

interface ProgressStatsProps {
  stats: Stats
  meta: StorageMeta | null
}

function Stat({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string | number
  tone?: 'default' | 'accent' | 'success' | 'warning'
}) {
  const toneClass = {
    default: 'text-ink',
    accent: 'text-accent',
    success: 'text-success',
    warning: 'text-warning',
  }[tone]

  return (
    <div className="flex flex-col gap-0.5 px-3 py-2.5 text-center sm:px-2">
      <span className={`text-xl font-semibold tabular-nums sm:text-2xl ${toneClass}`}>
        {value}
      </span>
      <span className="text-[11px] leading-tight text-ink-3">{label}</span>
    </div>
  )
}

/** Compact metrics row — deliberately not a dashboard. */
export function ProgressStats({ stats, meta }: ProgressStatsProps) {
  return (
    <Card className="overflow-hidden">
      <div className="grid grid-cols-3 divide-x divide-y divide-line sm:grid-cols-6 sm:divide-y-0">
        <Stat label="Vocabulary" value={stats.total} />
        <Stat label="Mastered" value={stats.mastered} tone="success" />
        <Stat label="Learning" value={stats.learning} />
        <Stat label="Needs review" value={stats.needsReview} tone="warning" />
        <Stat label="Accuracy" value={`${stats.accuracy}%`} tone="accent" />
        <Stat label="Streak" value={`${stats.streak}d`} tone="accent" />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-line bg-surface-2 px-4 py-2 text-[11px] text-ink-3">
        <span>{stats.sessions} sessions</span>
        <span aria-hidden="true">·</span>
        <span>{stats.correct} correct</span>
        <span aria-hidden="true">·</span>
        <span>{stats.spellingMistakes} spelling slips</span>
        {meta?.autoResetEnabled && (
          <>
            <span aria-hidden="true">·</span>
            <span title={`The vocabulary file is cleared every ${meta.resetIntervalDays} days`}>
              store clears in {meta.daysUntilReset}d
            </span>
          </>
        )}
      </div>
    </Card>
  )
}
