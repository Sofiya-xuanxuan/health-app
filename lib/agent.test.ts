import assert from 'node:assert'
import test from 'node:test'
import { canConfirmDelete } from './agent.ts'

test('删除工具只有在用户明确确认后才允许执行', () => {
  assert.equal(canConfirmDelete([], '删掉它吧'), true)
  assert.equal(canConfirmDelete([], '为什么要删？'), false)
  assert.equal(canConfirmDelete([{ role: 'app', text: '需要确认后才能删除' }], '好的'), false)
  assert.equal(canConfirmDelete([{ role: 'app', text: '需要确认后才能删除' }], '确认删除'), true)
})
