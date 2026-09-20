import type { Run } from './icloud.ts'
import type { Activity } from './types.ts'

export function durationMinutes(s: string): number {
  const zh = s.match(/(?:(\d+(?:\.\d+)?)\s*小时)?\s*(?:(\d+(?:\.\d+)?)\s*分)?/)
  if (zh && (zh[1] || zh[2])) return Math.round(Number(zh[1] ?? 0) * 60 + Number(zh[2] ?? 0))

  const parts = s.split(':').map(Number)
  if (parts.length === 3) return Math.round(parts[0] * 60 + parts[1] + parts[2] / 60)
  if (parts.length === 2) return Math.round(parts[0] + parts[1] / 60)
  return 0
}

export function activityFromRun(run: Run): Activity[] {
  const items = run.activities?.length
    ? run.activities
    : [{ type: 'run' as const, label: run.note ?? '跑步', distance: run.distance, duration: run.duration, pace: run.pace }]

  return items.map((item, index) =>
    normalizeActivity({
      id: `${run.date}:legacy:${index}`,
      date: run.date,
      category: 'exercise',
      type: item.type,
      label: item.label,
      minutes: item.duration ? durationMinutes(item.duration) : undefined,
      distanceKm: item.distance,
      count: item.type === 'run' ? undefined : 1,
      note: [item.pace ? `均配速 ${item.pace}/km` : '', item.heartRate ? `均心率${item.heartRate}` : '']
        .filter(Boolean)
        .join(' · ') || undefined,
    }),
  )
}

export function normalizeActivity(activity: Activity): Activity {
  const result = { ...activity }
  const text = [activity.type, activity.label, activity.title, activity.note].filter(Boolean).join(' ')
  if (activity.category === 'exercise' && /hiit|高强度间歇/i.test(text)) {
    result.type = 'hiit'
    result.label = 'Hiit'
  }
  if (activity.minutes != null) result.minutes = Math.max(0, Number(activity.minutes) || 0)
  else delete result.minutes
  if (activity.distanceKm != null) result.distanceKm = Math.max(0, Number(activity.distanceKm) || 0)
  else delete result.distanceKm
  if (activity.count != null) result.count = Math.max(0, Number(activity.count) || 0)
  else delete result.count
  if (activity.title == null) delete result.title
  if (activity.note == null) delete result.note
  return result
}
