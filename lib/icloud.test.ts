import assert from 'node:assert'
import test from 'node:test'
import { parseDiet, parseRuns } from './icloud.ts'
import { WEEKLY_SNACK_NOTE } from './types.ts'

// 这些片段都是从用户 iCloud md 里原样抠出来的，不是编的格式

const DIET = `## 本周植物多样性（08/03 周一–08/09 周日）【已结算 30/30 达标🎉】
累计 30/30：香菇、金针菇、小麦、核桃
（周六8/8补齐：奇亚籽=种子类）

## 2026-08-03 周一
- 早：50g馒头+2蒸蛋+2核桃 | 蛋白25 热560
- 午：冬瓜菜(肉丸子+豆腐)+300g绿豆小米粥 | 蛋白31 热560
- 晚：105g全麦吐司+2水煮蛋 | 蛋白24 热435
- 加餐(回家)：珍珠油桃2个(很小) | 蛋白1 热45
- **全天：蛋白~81.5g，热量~1630 kcal**
- 今日新增植物：小麦、核桃、黄瓜、油桃
`

test('三餐进固定槽，加餐进 snacks 并保留原标签', () => {
  const [d] = parseDiet(DIET)
  assert.equal(d.date, '2026-08-03')
  assert.equal(d.weekday, '周一')
  assert.equal(d.breakfast?.protein, 25)
  assert.equal(d.dinner?.calories, 435)
  assert.equal(d.snacks.length, 1)
  assert.equal(d.snacks[0].note, '加餐(回家)')
})

test('全天合计用原文的数，不重新加各餐（用户自己核对过）', () => {
  const [d] = parseDiet(DIET)
  assert.equal(d.totalProtein, 81.5) // 各餐相加是 81，原文写 81.5
  assert.equal(d.totalCalories, 1630)
})

test('带【已结算】的周块是最终值，含日行没记过的补录植物', () => {
  const [d] = parseDiet(DIET)
  assert.equal(d.weekPlantCount, 30) // 日行只有4种，但已结算=30
})

// 08/24 那周踩过的坑：块里停在 13，日行其实已经跑到 33
test('未结算的周块只是快照，日行的 running 计数更新时以日行为准', () => {
  const md = `## 本周植物多样性（08/24 周一–08/30 周日）
累计 13/30：燕麦、核桃

## 2026-08-24 周一
- 早：20g燕麦+2核桃 | 蛋白21.9 热383
- **全天：蛋白~63.4g，热量~1343 kcal**
- 今日新增植物2种（燕麦、核桃）→ 本周13/30

## 2026-08-30 周日
- 早：燕麦碗 | 蛋白23 热465
- **全天：蛋白~95.5g，热量~1605 kcal**
- 今日新增植物2种（平菇、可可）→ 本周33/30
`
  assert.equal(parseDiet(md)[0].weekPlantCount, 33)
})

// 5 天在原文里写了两行「今日新增植物」，早期版本只留了最后一行
test('同一天多行「今日新增植物」要累加，不能互相覆盖', () => {
  const md = `## 2026-08-24 周一
- 早：燕麦 | 蛋白21.9 热383
- **全天：蛋白~63.4g，热量~1343 kcal**
- 今日新增植物2种（燕麦、核桃）→ 本周13/30
- 今日新增植物1种（桃）→ 本周14/30
`
  assert.deepEqual(parseDiet(md)[0].basePlants, ['燕麦', '核桃', '桃'])
})

test('植物列表里的注释性词条要滤掉', () => {
  const md = `## 2026-09-02 周三
- 早：馒头 | 蛋白21.5 热445
- **全天：蛋白~92g，热量~1510 kcal**
- 今日新增植物2种（油菜、贝贝南瓜）→ 本周14/30（桃、小麦本周已计）
`
  assert.deepEqual(parseDiet(md)[0].basePlants, ['油菜', '贝贝南瓜'])
})

test('文件末尾每周零食对比单独解析，不进每日加餐口径', () => {
  const md = `## 2026-09-07 周一
- 早：馒头 | 蛋白1 热100
- 加餐：饼干 | 蛋白1 热30
- **全天：蛋白~2g，热量~130 kcal**

# 每周零食对比（单独记，不计入每日三餐/植物多样性）

## 9/7–9/13
- 薯片 | 蛋白2 热300
- 巧克力 | 蛋白3 热200
- **本周零食合计：蛋白~5g，热量~500 kcal**
`
  const [d] = parseDiet(md)
  const weekly = d.snacks.find((snack) => snack.note?.startsWith(WEEKLY_SNACK_NOTE))
  assert.equal(d.totalCalories, 130)
  assert.equal(weekly?.items, '薯片、巧克力')
  assert.equal(weekly?.calories, 500)
})

test('跑步记录：距离/用时/配速都取到', () => {
  const [r] = parseRuns(`## 2026-08-29 周六（LSD长距离，330备赛）
- 距离：20.25km，用时 1:48:03
- 均配速：~5'20"/km
- 心率：均138、最高155
`)
  assert.equal(r.date, '2026-08-29')
  assert.equal(r.distance, 20.25)
  assert.equal(r.duration, '1:48:03')
  assert.equal(r.note, 'LSD长距离，330备赛')
})

test('原文乱序时按日期倒序返回', () => {
  const md = `## 2026-08-03 周一
- 早：a | 蛋白1 热1
## 2026-09-08 周二
- 早：b | 蛋白1 热1
`
  assert.deepEqual(parseDiet(md).map((d) => d.date), ['2026-09-08', '2026-08-03'])
})
