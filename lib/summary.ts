import { isWeeklySnackNote, type Activity, type DayRecord, type Meal } from './types.ts'
import { fmtLocal, weekMonday } from './week.ts'

export type DateRange = { from: string; to: string }

export type Summary = DateRange & {
  foodDiversity: number
  snackItems: string[]
  snackCalories: number
  runningKm: number
  rideKm: number
  strengthMinutes: number
  strengthSessions: number
  yogaSessions: number
  pilatesSessions: number
  vlogCount: number
  englishMinutes: number
  readingOutputs: number
  aiMinutes: number
}

export type SnackTrendPoint = DateRange & {
  label: string
  snackCalories: number
  runningKm: number
  foodDiversity: number
  learningMinutes: number
  englishMinutes: number
  aiMinutes: number
  readingOutputs: number
  vlogCount: number
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return fmtLocal(d)
}

export function weekRange(date: string): DateRange {
  const from = weekMonday(date)
  return { from, to: addDays(from, 6) }
}

export function monthRange(date: string): DateRange {
  const [year, month] = date.split('-').map(Number)
  const from = `${year}-${String(month).padStart(2, '0')}-01`
  const to = fmtLocal(new Date(year, month, 0))
  return { from, to }
}

export function summarize(days: DayRecord[], activities: Activity[], range?: DateRange): Summary {
  const dates = range ?? { from: '0000-01-01', to: '9999-12-31' }
  const selectedDays = days.filter((day) => day.date >= dates.from && day.date <= dates.to)
  const foodDiversity = new Set(
    selectedDays.flatMap((day) => day.plantsToday ?? []),
  ).size
  const snacks = days.flatMap((day) =>
    (day.snacks ?? [])
      .filter((snack) => isWeeklySnackNote(snack.note) && overlaps(snackRange(day.date, snack), dates))
  )
  const selected = activities.filter((activity) => activity.date >= dates.from && activity.date <= dates.to)

  return {
    ...dates,
    foodDiversity,
    snackItems: [...new Set(snacks.flatMap((snack) => splitSnackItems(snack.items)))],
    snackCalories: snacks.reduce((sum, snack) => sum + (snack.calories ?? 0), 0),
    runningKm: selected
      .filter((activity) => activity.category === 'exercise' && activity.type === 'run')
      .reduce((sum, activity) => sum + (activity.distanceKm ?? 0), 0),
    rideKm: selected
      .filter((activity) => activity.category === 'exercise' && activity.type === 'ride')
      .reduce((sum, activity) => sum + (activity.distanceKm ?? 0), 0),
    strengthMinutes: selected
      .filter((activity) => activity.category === 'exercise' && activity.type === 'strength')
      .reduce((sum, activity) => sum + (activity.minutes ?? 0), 0),
    strengthSessions: selected
      .filter((activity) => activity.category === 'exercise' && activity.type === 'strength')
      .reduce((sum, activity) => sum + (activity.count ?? 1), 0),
    yogaSessions: selected
      .filter((activity) => activity.category === 'exercise' && activity.type === 'yoga')
      .reduce((sum, activity) => sum + (activity.count ?? 1), 0),
    pilatesSessions: selected
      .filter((activity) => activity.category === 'exercise' && activity.type === 'pilates')
      .reduce((sum, activity) => sum + (activity.count ?? 1), 0),
    vlogCount: selected
      .filter((activity) => activity.category === 'study' && activity.type === 'vlog')
      .reduce((sum, activity) => sum + (activity.count ?? 1), 0),
    englishMinutes: selected
      .filter((activity) => activity.category === 'study' && activity.type === 'english')
      .reduce((sum, activity) => sum + (activity.minutes ?? 0), 0),
    readingOutputs: selected
      .filter((activity) => activity.category === 'study' && activity.type === 'reading')
      .reduce((sum, activity) => sum + (activity.count ?? 0), 0),
    aiMinutes: selected
      .filter((activity) => activity.category === 'study' && activity.type === 'ai')
      .reduce((sum, activity) => sum + (activity.minutes ?? 0), 0),
  }
}

export function weeklySnackTrend(days: DayRecord[], activities: Activity[], date: string, weeks = 8): SnackTrendPoint[] {
  const start = weekRange(date).from
  return Array.from({ length: weeks }, (_, i) => addDays(start, (i - weeks + 1) * 7)).map((week) => {
    const range = weekRange(week)
    const summary = summarize(days, activities, range)
    return {
      ...range,
      label: `${Number(range.to.slice(5, 7))}/${Number(range.to.slice(8))}`,
      snackCalories: summary.snackCalories,
      runningKm: summary.runningKm,
      foodDiversity: summary.foodDiversity,
      learningMinutes: summary.englishMinutes + summary.aiMinutes,
      englishMinutes: summary.englishMinutes,
      aiMinutes: summary.aiMinutes,
      readingOutputs: summary.readingOutputs,
      vlogCount: summary.vlogCount,
    }
  })
}

function splitSnackItems(items: string): string[] {
  return items
    .split(/[、\n；;]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function snackRange(date: string, snack: Meal): DateRange {
  const [, from, to] = snack.note?.split(':') ?? []
  return from && to ? { from, to } : { from: date, to: date }
}

function overlaps(a: DateRange, b: DateRange): boolean {
  return a.from <= b.to && b.from <= a.to
}
