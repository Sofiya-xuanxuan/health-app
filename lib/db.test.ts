import assert from 'node:assert'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import test from 'node:test'
import { deleteActivity, listActivities, upsertActivity } from './db.ts'

test('同一天可以保存多条活动，且不覆盖其他活动', async () => {
  const file = '.data/activities.json'
  const existed = existsSync(file)
  const original = existed ? readFileSync(file) : undefined
  try {
    await upsertActivity({
      id: 'test:tennis',
      date: '2026-09-15',
      category: 'exercise',
      type: 'tennis',
      label: '网球',
      minutes: 60,
      count: 1,
    })
    await upsertActivity({
      id: 'test:english',
      date: '2026-09-15',
      category: 'study',
      type: 'english',
      label: '英语',
      minutes: 60,
    })
    assert.deepEqual((await listActivities('2026-09-15')).filter((a) => a.id.startsWith('test:')).map((a) => a.type), [
      'english',
      'tennis',
    ])
  } finally {
    if (original) writeFileSync(file, original)
    else if (existsSync(file)) unlinkSync(file)
  }
})

test('活动可以编辑和删除', async () => {
  const file = '.data/activities.json'
  const existed = existsSync(file)
  const original = existed ? readFileSync(file) : undefined
  try {
    await upsertActivity({
      id: 'test:edit',
      date: '2026-09-16',
      category: 'exercise',
      type: 'strength',
      label: '力量训练',
      minutes: 30,
      count: 1,
    })
    await upsertActivity({
      id: 'test:edit',
      date: '2026-09-16',
      category: 'exercise',
      type: 'strength',
      label: '力量',
      minutes: 45,
      count: 1,
    })
    assert.equal((await listActivities('2026-09-16')).find((a) => a.id === 'test:edit')?.minutes, 45)
    await deleteActivity('test:edit')
    assert.equal((await listActivities('2026-09-16')).some((a) => a.id === 'test:edit'), false)
  } finally {
    if (original) writeFileSync(file, original)
    else if (existsSync(file)) unlinkSync(file)
  }
})
