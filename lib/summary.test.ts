import assert from 'node:assert'
import test from 'node:test'
import { monthRange, summarize, weeklySnackTrend, weekRange } from './summary.ts'
import { WEEKLY_SNACK_NOTE, type Activity, type DayRecord } from './types.ts'

test('周汇总使用周一到周日', () => {
  assert.deepEqual(weekRange('2026-09-15'), { from: '2026-09-14', to: '2026-09-20' })
})

test('月汇总使用自然月', () => {
  assert.deepEqual(monthRange('2026-09-15'), { from: '2026-09-01', to: '2026-09-30' })
})

test('汇总饮食、运动和学习指标', () => {
  const result = summarize(
    [
      { date: '2026-09-15', plantsToday: ['大米', '油菜'], snacks: [{ items: '核桃', protein: 3, calories: 120, plants: ['核桃'], note: '零食' }] },
      { date: '2026-09-16', plantsToday: ['油菜', '香蕉'], snacks: [{ items: '酸奶', protein: 5, calories: 90, plants: [] }] },
      { date: '2026-09-16', plantsToday: [], snacks: [{ items: '薯片、巧克力', protein: 0, calories: 520, plants: [], note: WEEKLY_SNACK_NOTE }] },
    ] as DayRecord[],
    [
      { id: 'r1', date: '2026-09-15', category: 'exercise', type: 'run', label: '跑步', distanceKm: 10 },
      { id: 'r1b', date: '2026-09-15', category: 'exercise', type: 'ride', label: '骑行', distanceKm: 30 },
      { id: 'r2', date: '2026-09-15', category: 'exercise', type: 'strength', label: '力量训练', minutes: 45, count: 1 },
      { id: 'r3', date: '2026-09-16', category: 'exercise', type: 'yoga', label: '瑜伽', count: 1 },
      { id: 's1', date: '2026-09-15', category: 'study', type: 'english', label: '英语', minutes: 90 },
      { id: 's2', date: '2026-09-16', category: 'study', type: 'vlog', label: 'vlog', count: 1 },
      { id: 's3', date: '2026-09-16', category: 'study', type: 'reading', label: '阅读', count: 1 },
    ] as Activity[],
    { from: '2026-09-15', to: '2026-09-16' },
  )
  assert.deepEqual(result, {
    from: '2026-09-15',
    to: '2026-09-16',
    foodDiversity: 3,
    snackItems: ['薯片', '巧克力'],
    snackCalories: 520,
    runningKm: 10,
    rideKm: 30,
    strengthMinutes: 45,
    strengthSessions: 1,
    yogaSessions: 1,
    pilatesSessions: 0,
    vlogCount: 1,
    englishMinutes: 90,
    readingOutputs: 1,
    aiMinutes: 0,
  })
})

test('零食趋势按周汇总热量', () => {
  const trend = weeklySnackTrend([
    { date: '2026-09-07', weekday: '一', totalProtein: 0, totalCalories: 0, plantsToday: ['苹果'], snacks: [{ items: '巧克力', protein: 0, calories: 200, plants: [], note: WEEKLY_SNACK_NOTE }] },
    { date: '2026-09-16', weekday: '三', totalProtein: 0, totalCalories: 0, plantsToday: ['香蕉', '小麦'], snacks: [{ items: '薯片', protein: 0, calories: 520, plants: [], note: WEEKLY_SNACK_NOTE }] },
  ] as DayRecord[], [
    { id: 'r1', date: '2026-09-16', category: 'exercise', type: 'run', label: '跑步', distanceKm: 12.5 },
    { id: 's1', date: '2026-09-16', category: 'study', type: 'english', label: '英语', minutes: 60 },
    { id: 's2', date: '2026-09-16', category: 'study', type: 'ai', label: 'AI技术', minutes: 30 },
  ] as Activity[], '2026-09-16', 3)

  assert.deepEqual(trend.map((point) => point.snackCalories), [0, 200, 520])
  assert.deepEqual(trend.map((point) => point.label), ['9/6', '9/13', '9/20'])
  assert.deepEqual(trend.map((point) => point.foodDiversity), [0, 1, 2])
  assert.deepEqual(trend.map((point) => point.runningKm), [0, 0, 12.5])
  assert.deepEqual(trend.map((point) => point.learningMinutes), [0, 0, 90])
  assert.deepEqual(trend.map((point) => point.englishMinutes), [0, 0, 60])
  assert.deepEqual(trend.map((point) => point.aiMinutes), [0, 0, 30])
})
