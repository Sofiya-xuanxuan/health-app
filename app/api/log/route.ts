import { deleteActivity, getDay, upsertActivity } from '@/lib/db'
import { parseEntry, type ChatHistory } from '@/lib/claude'
import { runAgent, type AgentHistory } from '@/lib/agent'
import { deleteMeal, editMeal, saveParsed } from '@/lib/records'
import { authed } from '@/lib/auth'
import { isAiAuthError } from '@/lib/ai'
import { today } from '@/lib/week'
import type { Activity } from '@/lib/types'

export async function POST(req: Request) {
  if (!authed(req)) return Response.json({ error: '未授权' }, { status: 401 })

  const { message, date: reqDate, history } = await req.json() as { message?: string; date?: string; history?: ChatHistory[] }
  if (!message || typeof message !== 'string') {
    return Response.json({ error: '缺少 message' }, { status: 400 })
  }
  const date = reqDate || today()
  const agentHistory: AgentHistory[] = Array.isArray(history) ? history.slice(-8) : []
  try {
    const result = await runAgent({ date, message, history: agentHistory })
    return Response.json(result)
  } catch (e) {
    console.error('Agent 失败', e)
    if (isAiAuthError(e)) {
      return Response.json({ error: 'AI 配置无效，请检查 ANTHROPIC_API_KEY 和 ANTHROPIC_BASE_URL' }, { status: 502 })
    }
    try {
      const parsed = await parseEntry(message, date)
      const saved = await saveParsed(date, parsed)
      return 'error' in saved ? Response.json(saved, { status: 400 }) : Response.json(saved)
    } catch (fallbackError) {
      console.error('记录兜底失败', fallbackError)
      return Response.json({ error: '记录失败，请检查 AI 配置后重试' }, { status: 502 })
    }
  }
}

export async function PATCH(req: Request) {
  if (!authed(req)) return Response.json({ error: '未授权' }, { status: 401 })

  const body = (await req.json()) as { activity?: Activity; date?: string; mealKey?: string; index?: number; items?: string }
  if (body.activity) {
    const { activity } = body
    if (!activity.id || !activity.date || !activity.category || !activity.type || !activity.label) {
      return Response.json({ error: '活动字段不完整' }, { status: 400 })
    }

    try {
      return Response.json({ activity: await upsertActivity(activity) })
    } catch (e) {
      console.error('upsertActivity 失败', e)
      return Response.json({ error: '活动保存失败：' + (e instanceof Error ? e.message : String(e)) }, { status: 502 })
    }
  }

  if (body.date && body.mealKey && typeof body.items === 'string') {
    const text = body.items.trim()
    if (!text) return Response.json({ error: '饮食内容不能为空' }, { status: 400 })
    const result = await editMeal(body.date, body.mealKey as 'breakfast' | 'lunch' | 'dinner' | 'snack', body.index, text)
    return 'error' in result ? Response.json(result, { status: 400 }) : Response.json(result)
  }

  return Response.json({ error: '缺少可编辑内容' }, { status: 400 })
}

// 删一餐。记错了也可以直接编辑，删除保留给整餐误录。
export async function DELETE(req: Request) {
  if (!authed(req)) return Response.json({ error: '未授权' }, { status: 401 })

  const { date, meal, index, activityId } = (await req.json()) as { date: string; meal?: string; index?: number; activityId?: string }
  if (activityId) {
    await deleteActivity(activityId)
    return Response.json({ ok: true })
  }

  if (meal !== 'breakfast' && meal !== 'lunch' && meal !== 'dinner' && meal !== 'snack') {
    return Response.json({ error: '餐次不对' }, { status: 400 })
  }
  const result = await deleteMeal(date, meal, index)
  return 'error' in result ? Response.json(result, { status: 400 }) : Response.json(result)
}
