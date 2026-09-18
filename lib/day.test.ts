import assert from 'node:assert'
import test from 'node:test'
import { mergeDailySnack, recalc, weekPlants } from './day.ts'
import { WEEKLY_SNACK_NOTE, type DayRecord } from './types.ts'

const day = (): DayRecord => ({
  date: '2026-09-03',
  weekday: '周四',
  breakfast: { items: '馒头鸡蛋', protein: 20, calories: 400, plants: ['小麦'] },
  lunch: { items: '牛肉面配西蓝花', protein: 30, calories: 620, plants: ['小麦', '西蓝花'] },
  snacks: [{ items: '香蕉', protein: 1.5, calories: 90, plants: ['香蕉'] }],
  totalProtein: 0,
  totalCalories: 0,
  plantsToday: [],
})

test('合计和植物都从各餐汇总，跨餐的同一种植物只算一次', () => {
  const d = recalc(day())
  assert.equal(d.totalProtein, 51.5)
  assert.equal(d.totalCalories, 1110)
  assert.deepEqual(d.plantsToday, ['小麦', '西蓝花', '香蕉'])
})

// 这条是这次改动的理由：以前 plantsToday 是天级别并集，删餐摘不掉植物
test('删掉一餐后，只属于那餐的植物跟着消失', () => {
  const d = day()
  delete d.lunch
  recalc(d)
  assert.deepEqual(d.plantsToday, ['小麦', '香蕉']) // 西蓝花没了，小麦还在（早餐也有）
  assert.equal(d.totalProtein, 21.5)
})

test('重记同一餐是覆盖，不会把旧植物留下', () => {
  const d = day()
  d.lunch = { items: '米饭炒青菜', protein: 12, calories: 500, plants: ['大米', '青菜'] }
  recalc(d)
  assert.ok(!d.plantsToday.includes('西蓝花'))
  assert.deepEqual(d.plantsToday, ['小麦', '大米', '青菜', '香蕉'])
})

test('一天不剩餐时归零，而不是留着上次的合计', () => {
  const d = recalc({ ...day(), breakfast: undefined, lunch: undefined, snacks: [] })
  assert.equal(d.totalProtein, 0)
  assert.deepEqual(d.plantsToday, [])
})

test('同一天多次加餐合并成一条，周零食不参与', () => {
  const d = { ...day(), snacks: [{ items: '薯片', protein: 0, calories: 150, plants: [], note: WEEKLY_SNACK_NOTE }] }
  mergeDailySnack(d, { items: '香蕉', protein: 1.5, calories: 90, plants: ['香蕉'], note: '下午' })
  mergeDailySnack(d, { items: '酸奶', protein: 5, calories: 120, plants: [], note: '晚上' })
  assert.equal(d.snacks.length, 2)
  assert.equal(d.snacks[0].note, WEEKLY_SNACK_NOTE)
  assert.deepEqual(d.snacks[1], {
    items: '香蕉、酸奶',
    protein: 6.5,
    calories: 210,
    plants: ['香蕉'],
    note: '下午；晚上',
  })
})

test('周多样性是各天的并集', () => {
  const a = { plantsToday: ['小麦', '西蓝花'] } as DayRecord
  const b = { plantsToday: ['西蓝花', '香蕉'] } as DayRecord
  assert.equal(weekPlants([a, b]), 3)
})
