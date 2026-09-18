import assert from 'node:assert'
import test from 'node:test'
import { agentDecision, answerQuestion, coerce, coerceEntries, isExerciseOnly, isQuestion, parseEntry, parseExercise } from './claude.ts'

// 下面每个字符串都是实测从网关拿到的真实返回，不是编的

test('Claude：干净 JSON 原样通过', () => {
  const p = coerce('{"meal":"lunch","items":"牛肉面、西蓝花","protein":30,"calories":620,"plants":["小麦","西蓝花"],"note":"份量估算"}')
  assert.equal(p.meal, 'lunch')
  assert.equal(p.protein, 30)
  assert.deepEqual(p.plants, ['小麦', '西蓝花'])
})

test('DeepSeek：字段名带单位后缀', () => {
  const p = coerce('{\n "meal": "snack",\n "items": "香蕉，核桃",\n "protein_g": 3.5,\n "calories_kcal": 170,\n "plants": ["香蕉","核桃"],\n "note": "份量估算"\n}')
  assert.equal(p.protein, 3.5)
  assert.equal(p.calories, 170)
  assert.equal(p.meal, 'snack')
})

test('GLM：```json 包裹 + meal_type + items 是数组', () => {
  const p = coerce('```json\n{"meal_type":"lunch","items":["牛肉面一碗","西蓝花一份"],"protein":30,"calories":620,"plants":["小麦"]}\n```')
  assert.equal(p.meal, 'lunch')
  assert.equal(p.items, '牛肉面一碗、西蓝花一份')
})

test('GLM：JSON 前后夹带寒暄也能取出来', () => {
  const p = coerce('这是一个很不错的早餐搭配！\n\n{"meal":"breakfast","items":"馒头、鸡蛋","protein":22,"calories":350,"plants":["小麦"]}\n\n蛋白质很充足哦。')
  assert.equal(p.meal, 'breakfast')
  assert.equal(p.protein, 22)
})

test('完全没有 JSON 时报清楚的错，而不是 JSON.parse 的天书', () => {
  assert.throws(() => coerce('抱歉，我无法处理这个请求'), /没有 JSON/)
})

test('餐次非法时落到 snack，而不是崩掉', () => {
  assert.equal(coerce('{"meal":"brunch","items":"x","protein":1,"calories":1,"plants":[]}').meal, 'snack')
})

test('字段缺失/类型不对时给 0 和空数组，不产生 NaN 污染统计', () => {
  const p = coerce('{"meal":"lunch","items":"x"}')
  assert.equal(p.protein, 0)
  assert.equal(p.calories, 0)
  assert.deepEqual(p.plants, [])
  assert.ok(!Number.isNaN(p.protein))
})

test('AI 批量返回能转成三餐和运动', () => {
  const entries = coerceEntries(JSON.stringify({
    entries: [
      { kind: 'meal', meal: 'breakfast', items: '馒头', protein: 8, calories: 220, plants: ['小麦'] },
      { kind: 'meal', meal: 'lunch', items: '红薯', protein: 3, calories: 180, plants: ['红薯'] },
      { kind: 'meal', meal: 'dinner', items: '吐司', protein: 10, calories: 300, plants: ['小麦'] },
      { kind: 'activity', category: 'exercise', type: 'run', label: '跑步', distanceKm: 5, minutes: 30 },
    ],
  }))
  assert.deepEqual(entries.map((entry) => entry.kind), ['meal', 'meal', 'meal', 'activities'])
  assert.deepEqual(entries.filter((entry) => entry.kind === 'meal').map((entry) => entry.meal.meal), ['breakfast', 'lunch', 'dinner'])
})

test('纯运动记录不当成饮食保存', () => {
  assert.equal(isExerciseOnly('运动记录：长跑23km，平均配速5\'28"/km，平均心率132'), true)
})

test('运动后带食物的记录仍然交给饮食解析', () => {
  assert.equal(isExerciseOnly('长跑23km 后吃了香蕉和酸奶'), false)
})

test('解释类输入走问答，不当成记录保存', async () => {
  assert.equal(isQuestion('查一下，为什么今日午餐会有720大卡，这是怎么算的'), true)
  assert.equal(isQuestion('不能聊天问东西吗'), true)
  const reply = await answerQuestion('查一下，为什么今日午餐会有720大卡，这是怎么算的', {
    date: '2026-09-17',
    day: {
      date: '2026-09-17',
      weekday: '周四',
      lunch: { items: '牛肉面、西蓝花', protein: 30, calories: 720, plants: ['小麦', '西蓝花'], note: '份量估算' },
      snacks: [],
      totalProtein: 30,
      totalCalories: 720,
      plantsToday: ['小麦', '西蓝花'],
    },
    activities: [],
  })
  assert.match(reply, /午餐记录是：牛肉面、西蓝花/)
  assert.match(reply, /720 kcal/)
})

test('agent 区分聊天和记录', async () => {
  const context = {
    date: '2026-09-17',
    day: {
      date: '2026-09-17',
      weekday: '周四',
      lunch: { items: '杂粮饭、鸡腿、排骨、炒菜', protein: 40, calories: 720, plants: ['大米'], note: '份量估算' },
      snacks: [],
      totalProtein: 40,
      totalCalories: 720,
      plantsToday: ['大米'],
    },
    activities: [],
    history: [{ role: 'app' as const, text: '午餐 720 kcal 的大致拆解...' }],
  }
  assert.deepEqual(await agentDecision('午餐 杂粮饭150g 鸡腿 排骨 炒菜', context), { mode: 'record' })
  assert.equal((await agentDecision('炒菜的油很少，按5g算，鸡腿是去皮的，排骨是瘦的', context)).mode, 'chat')
})

test('从运动输入里抽取距离配速心率', () => {
  assert.deepEqual(parseExercise('打网球1小时28分，慢跑10.32km，平均配速550，平均心率124', '2026-09-15'), {
    date: '2026-09-15',
    distance: 10.32,
    duration: '1:00:12',
    pace: '5\'50"',
    note: '均心率124',
    activities: [
      { type: 'tennis', label: '网球', duration: '1小时28分' },
      {
        type: 'run',
        label: '慢跑',
        distance: 10.32,
        duration: '1:00:12',
        pace: '5\'50"',
        heartRate: 124,
      },
    ],
  })
})

test('统一入口把网球和慢跑拆成并列活动', async () => {
  assert.deepEqual(
    await parseEntry('打网球1小时28分，慢跑10.32km，平均配速550，平均心率124', '2026-09-15'),
    {
      kind: 'activities',
      activities: [
        { category: 'exercise', type: 'tennis', label: '网球', minutes: 88, count: 1 },
        {
          category: 'exercise',
          type: 'run',
          label: '慢跑',
          minutes: 60,
          distanceKm: 10.32,
          note: '均配速 5\'50"/km · 均心率124',
        },
      ],
    },
  )
})

test('统一入口识别英语、vlog和阅读产出', async () => {
  assert.deepEqual(await parseEntry('学英语听力1小时', '2026-09-15'), {
    kind: 'activities',
    activities: [{ category: 'study', type: 'english', label: '英语', minutes: 60 }],
  })
  assert.deepEqual(await parseEntry('今天拍完并发布一个vlog', '2026-09-15'), {
    kind: 'activities',
    activities: [{ category: 'study', type: 'vlog', label: 'vlog', count: 1 }],
  })
  assert.deepEqual(await parseEntry('读完一本书并输出读书笔记', '2026-09-15'), {
    kind: 'activities',
    activities: [{ category: 'study', type: 'reading', label: '阅读', count: 1 }],
  })
})

test('没有时长的网球和力量训练也按一次保存', async () => {
  assert.deepEqual(await parseEntry('打网球', '2026-09-15'), {
    kind: 'activities',
    activities: [{ category: 'exercise', type: 'tennis', label: '网球', count: 1 }],
  })
  assert.deepEqual(await parseEntry('力量训练', '2026-09-15'), {
    kind: 'activities',
    activities: [{ category: 'exercise', type: 'strength', label: '力量训练', count: 1 }],
  })
})

test('本周零食单独进入零食汇总，不当成每日加餐', async () => {
  const parsed = await parseEntry('本周零食：薯片和巧克力', '2026-09-15')
  assert.equal(parsed.kind, 'weeklySnack')
})

test('一条消息里写三餐和运动时拆开保存', async () => {
  const parsed = await parseEntry('早餐馒头100g；午餐红薯176g；晚餐全麦吐司105g；运动：跑步5km，平均配速600', '2026-09-16')
  assert.equal(parsed.kind, 'batch')
  if (parsed.kind !== 'batch') return
  assert.deepEqual(parsed.entries.map((entry) => entry.kind), ['meal', 'meal', 'meal', 'activities'])
  assert.deepEqual(
    parsed.entries.filter((entry) => entry.kind === 'meal').map((entry) => entry.meal.meal),
    ['breakfast', 'lunch', 'dinner'],
  )
  const activities = parsed.entries.find((entry) => entry.kind === 'activities')
  assert.deepEqual(activities?.activities.map((activity) => activity.type), ['run'])
})

test('三餐和运动只用空格分隔时也能拆开', async () => {
  const parsed = await parseEntry('早餐 馒头100g 午餐 红薯176g 晚餐 全麦吐司105g 运动 跑步5km', '2026-09-17')
  assert.equal(parsed.kind, 'batch')
  if (parsed.kind !== 'batch') return
  assert.deepEqual(parsed.entries.map((entry) => entry.kind), ['meal', 'meal', 'meal', 'activities'])
})
