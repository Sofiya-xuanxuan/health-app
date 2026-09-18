import assert from 'node:assert'
import test from 'node:test'
import { editedItems } from './records.ts'

test('餐食修正的说明文字不覆盖原食物内容', () => {
  assert.equal(
    editedItems('馒头、蒸蛋、核桃', '上一条记录的餐食（热量按用户修正）'),
    '馒头、蒸蛋、核桃',
  )
  assert.equal(editedItems('馒头、蒸蛋', '馒头、2个蒸蛋'), '馒头、2个蒸蛋')
})
