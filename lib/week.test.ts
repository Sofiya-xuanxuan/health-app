import assert from 'node:assert'
import test from 'node:test'
import { weekMonday, weekSunday, weekdayLabel } from './week.ts'

test('weekMonday 把一周任意天都归到同一个周一', () => {
  assert.equal(weekMonday('2026-08-20'), '2026-08-17') // 周四
  assert.equal(weekMonday('2026-08-23'), '2026-08-17') // 周日归本周一
  assert.equal(weekMonday('2026-08-24'), '2026-08-24') // 周一
})

test('weekdayLabel 正确', () => {
  assert.equal(weekdayLabel('2026-08-23'), '周日')
  assert.equal(weekdayLabel('2026-08-24'), '周一')
})

test('weekSunday 把一周任意天都归到同一个周日', () => {
  assert.equal(weekSunday('2026-08-20'), '2026-08-23')
  assert.equal(weekSunday('2026-08-23'), '2026-08-23')
  assert.equal(weekSunday('2026-08-24'), '2026-08-30')
})
