import { isWeeklySnackNote, type DayRecord, type Meal } from './types.ts'

// 一天的汇总全部从各餐推导出来，从不增量累加。
// 这样删一餐/重记一餐时，蛋白、热量、植物会自动跟着对——
// 之前 plantsToday 是天级别的并集，删了餐也摘不掉对应的植物。
export function mealsOf(day: DayRecord): Meal[] {
  return [day.breakfast, day.lunch, day.dinner, ...(day.snacks ?? []).filter((snack) => !isWeeklySnackNote(snack.note))].filter(Boolean) as Meal[]
}

export function mergeDailySnack(day: DayRecord, meal: Meal): void {
  const index = day.snacks.findIndex((snack) => !isWeeklySnackNote(snack.note))
  if (index === -1) {
    day.snacks.push(meal)
    return
  }

  const prev = day.snacks[index]
  day.snacks[index] = {
    items: [prev.items, meal.items].filter(Boolean).join('、'),
    protein: Math.round((prev.protein + meal.protein) * 10) / 10,
    calories: Math.round(prev.calories + meal.calories),
    plants: [...new Set([...(prev.plants ?? []), ...(meal.plants ?? [])])],
    note: [...new Set([prev.note, meal.note].filter(Boolean))].join('；') || undefined,
  }
}

export function recalc(day: DayRecord): DayRecord {
  const all = mealsOf(day)
  day.totalProtein = Math.round(all.reduce((s, m) => s + m.protein, 0) * 10) / 10
  day.totalCalories = Math.round(all.reduce((s, m) => s + m.calories, 0))
  // basePlants 是 iCloud md 里按天记的植物（餐上没有），不能被各餐汇总冲掉；
  // app 内新记的餐带自己的 plants，删掉时只影响自己那份。
  day.plantsToday = [...new Set([...(day.basePlants ?? []), ...all.flatMap((m) => m.plants ?? [])])]
  return day
}

// 本周(周一–周日)吃到的植物种数：把这几天的 plantsToday 取并集
export function weekPlants(days: DayRecord[]): number {
  return new Set(days.flatMap((d) => d.plantsToday ?? [])).size
}
