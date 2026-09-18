import { deleteActivity, getDay, listWeek, upsertActivity, upsertDay } from './db.ts'
import { parseEntry, type ParsedEntry, type ParsedMeal } from './claude.ts'
import { mergeDailySnack, recalc, weekPlants } from './day.ts'
import { weekdayLabel, weekSunday } from './week.ts'
import { WEEKLY_SNACK_NOTE, type Activity, type DayRecord, type Meal } from './types.ts'

export type SavedRecord = {
  day?: DayRecord
  activities?: Activity[]
  parsed?: ParsedMeal
  parsedMeals?: ParsedMeal[]
  weeklySnack?: Pick<ParsedMeal, 'items' | 'calories' | 'note'>
  error?: string
}

export function editedItems(previous: string, next: string): string {
  return /上一条记录的餐食|原来的餐食|原餐食|食物内容不变|按用户修正/.test(next) ? previous : next
}

function emptyDay(date: string): DayRecord {
  return { date, weekday: weekdayLabel(date), snacks: [], totalProtein: 0, totalCalories: 0, plantsToday: [] }
}

export async function commitDay(day: DayRecord): Promise<DayRecord> {
  recalc(day)
  const week = (await listWeek(day.date)).filter((d) => d.date !== day.date)
  day.weekPlantCount = weekPlants([day, ...week])
  await upsertDay(day)
  return day
}

type ParsedSingleEntry = Exclude<ParsedEntry, { kind: 'batch' }>

export async function saveParsed(date: string, parsed: ParsedEntry): Promise<SavedRecord> {
  const entries: ParsedSingleEntry[] = parsed.kind === 'batch' ? parsed.entries : [parsed]
  const days = new Map<string, DayRecord>()
  const activities: Activity[] = []
  const parsedMeals: ParsedMeal[] = []
  let weeklySnack: Pick<ParsedMeal, 'items' | 'calories' | 'note'> | undefined
  let originalDayTouched = false

  async function editDay(dayDate: string): Promise<DayRecord> {
    let day = days.get(dayDate)
    if (!day) {
      day = (await getDay(dayDate)) ?? emptyDay(dayDate)
      days.set(dayDate, day)
    }
    return day
  }

  for (const entry of entries) {
    if (entry.kind === 'activities') {
      if (entry.activities.length === 0) continue
      const stamp = Date.now()
      activities.push(...await Promise.all(
        entry.activities.map((activity, index) =>
          upsertActivity({
            id: `${date}:${stamp}:${activities.length + index}`,
            date,
            ...activity,
          }),
        ),
      ))
      continue
    }

    if (entry.kind === 'weeklySnack') {
      const day = await editDay(weekSunday(date))
      day.snacks.push({
        items: entry.snack.items,
        protein: 0,
        calories: entry.snack.calories,
        plants: [],
        note: WEEKLY_SNACK_NOTE,
      })
      weeklySnack = entry.snack
      continue
    }

    const day = await editDay(date)
    originalDayTouched = true
    const meal: Meal = {
      items: entry.meal.items,
      protein: entry.meal.protein,
      calories: entry.meal.calories,
      plants: entry.meal.plants,
      note: entry.meal.note,
    }
    if (entry.meal.meal === 'snack') mergeDailySnack(day, meal)
    else day[entry.meal.meal] = meal
    parsedMeals.push(entry.meal)
  }

  if (days.size === 0 && activities.length === 0) return { error: '没找到可保存的内容' }
  const committedDays = await Promise.all([...days.values()].map(commitDay))
  const responseDay = originalDayTouched ? committedDays.find((day) => day.date === date) : undefined
  return {
    ...(responseDay ? { day: responseDay } : {}),
    ...(activities.length ? { activities } : {}),
    ...(parsedMeals.length ? { parsed: parsedMeals[parsedMeals.length - 1], parsedMeals } : {}),
    ...(weeklySnack ? { weeklySnack } : {}),
  }
}

export async function editMeal(
  date: string,
  mealKey: 'breakfast' | 'lunch' | 'dinner' | 'snack',
  index: number | undefined,
  items: string,
): Promise<SavedRecord> {
  const day = await getDay(date)
  if (!day) return { error: '这天没有记录' }
  const text = items.trim()
  if (!text) return { error: '饮食内容不能为空' }
  const previous = mealKey === 'snack'
    ? typeof index === 'number' ? day.snacks[index] : undefined
    : day[mealKey]
  if (!previous) return { error: '这餐没有记录' }
  const prefix = mealKey === 'breakfast' ? '早餐' : mealKey === 'lunch' ? '午餐' : mealKey === 'dinner' ? '晚餐' : '加餐'
  const parsed = await parseEntry(`${prefix} ${text}`, date)
  if (parsed.kind !== 'meal') return { error: '没有解析到饮食内容' }
  const nextItems = editedItems(previous.items, text) === previous.items
    ? previous.items
    : editedItems(previous.items, parsed.meal.items)

  const meal: Meal = {
    items: nextItems,
    protein: parsed.meal.protein,
    calories: parsed.meal.calories,
    plants: parsed.meal.plants,
    note: parsed.meal.note,
  }
  if (mealKey === 'snack') {
    if (typeof index !== 'number' || !day.snacks[index]) return { error: '加餐序号不对' }
    day.snacks[index] = meal
  } else {
    day[mealKey] = meal
  }
  return { day: await commitDay(day) }
}

export async function deleteMeal(
  date: string,
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack',
  index?: number,
): Promise<SavedRecord> {
  const day = await getDay(date)
  if (!day) return { error: '这天没有记录' }

  if (meal === 'snack') {
    if (typeof index !== 'number' || !day.snacks[index]) return { error: '加餐序号不对' }
    day.snacks.splice(index, 1)
  } else {
    delete day[meal]
  }
  return { day: await commitDay(day) }
}

export async function removeActivity(id: string): Promise<void> {
  await deleteActivity(id)
}
