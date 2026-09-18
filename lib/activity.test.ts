import assert from 'node:assert'
import test from 'node:test'
import { activityFromRun, normalizeActivity } from './activity.ts'

test('旧 Run 的复合记录拆成并列活动', () => {
  const activities = activityFromRun({
    date: '2026-09-13',
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
  assert.deepEqual(activities.map((a) => a.type), ['tennis', 'run'])
  assert.equal(activities[0].minutes, 88)
  assert.equal(activities[1].distanceKm, 10.32)
  assert.equal(activities[1].minutes, 60)
})

test('活动数值统一为合法的非负值', () => {
  assert.deepEqual(
    normalizeActivity({
      id: 'x',
      date: '2026-09-15',
      category: 'study',
      type: 'english',
      label: '英语',
      minutes: -20,
      count: -1,
    }),
    {
      id: 'x',
      date: '2026-09-15',
      category: 'study',
      type: 'english',
      label: '英语',
      minutes: 0,
      count: 0,
    },
  )
})
