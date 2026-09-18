// 一餐
export type Meal = {
  items: string        // "100g馒头+2蒸蛋+2核桃"
  protein: number      // g
  calories: number     // kcal
  plants: string[]     // 这餐的植物性食材，天/周的多样性都由各餐汇总而来
  note?: string        // 估算/份量备注
}

export const WEEKLY_SNACK_NOTE = '__weekly_snack__'

export function isWeeklySnackNote(note?: string): boolean {
  return note?.startsWith(WEEKLY_SNACK_NOTE) ?? false
}

// 一天的记录（运动/体重字段为 roadmap 预留，MVP 先不填）
export type DayRecord = {
  date: string         // "2026-08-23"
  weekday: string      // "周日"
  breakfast?: Meal
  lunch?: Meal
  dinner?: Meal
  snacks: Meal[]
  totalProtein: number
  totalCalories: number
  plantsToday: string[]   // 由 basePlants + 各餐 plants 汇总，别手动改（见 lib/day.ts recalc）
  basePlants?: string[]   // 来自 iCloud md 的当天植物（原文按天记，没按餐拆）。只读底库，app 不改它
  weekPlantCount?: number // 本周(周一–周日)累计植物种数，后端算
}

export const MEAL_LABELS: Record<string, string> = {
  breakfast: '早',
  lunch: '午',
  dinner: '晚',
}

export type ActivityCategory = 'exercise' | 'study'
export type ExerciseType = 'run' | 'strength' | 'yoga' | 'pilates' | 'tennis' | 'ride' | 'swim' | 'workout'
export type StudyType = 'english' | 'reading' | 'ai' | 'vlog'

export type Activity = {
  id: string
  date: string
  category: ActivityCategory
  type: ExerciseType | StudyType
  label: string
  minutes?: number
  distanceKm?: number
  count?: number
  title?: string
  note?: string
}
