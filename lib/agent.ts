import type { MessageParam, Tool } from '@anthropic-ai/sdk/resources/messages'
import { aiConfigured, createAiClient, isAiAuthError } from './ai.ts'
import { getDay, listActivities, listDays, upsertActivity } from './db.ts'
import { agentDecision, parseEntry, type ChatHistory } from './claude.ts'
import { monthRange, summarize, weekRange, weeklySnackTrend } from './summary.ts'
import { deleteMeal, editMeal, removeActivity, saveParsed, type SavedRecord } from './records.ts'
import type { Activity, DayRecord } from './types.ts'

const MODEL = process.env.AI_MODEL || 'claude-opus-5'

export type AgentHistory = ChatHistory

type AgentRequest = {
  date: string
  message: string
  history: AgentHistory[]
}

export type AgentResult = SavedRecord & {
  reply?: string
  deletedActivityId?: string
}

type ToolState = {
  saved: SavedRecord[]
  activities: Activity[]
  deletedActivityId?: string
}

const TOOLS: Tool[] = [
  {
    name: 'get_day_record',
    description: '查询某一天的饮食、运动和学习记录。用户问当天吃了什么、做了什么、某餐热量时使用。',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'YYYY-MM-DD；省略时使用当前对话日期' } },
      required: [],
    },
  },
  {
    name: 'get_summary',
    description: '查询某周或某月的饮食、运动、学习汇总。',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['week', 'month'] },
        date: { type: 'string', description: '范围内任意日期 YYYY-MM-DD；省略时使用当前对话日期' },
      },
      required: ['period'],
    },
  },
  {
    name: 'get_trend',
    description: '查询最近若干周的趋势数据，适合回答零食热量、周跑量、食物多样性和学习时长走势。',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '当前周内任意日期 YYYY-MM-DD；省略时使用当前对话日期' },
        weeks: { type: 'number', description: '周数，默认 8，最多 16' },
      },
      required: [],
    },
  },
  {
    name: 'save_health_record',
    description: '保存用户明确要记录的饮食、运动或学习内容。只有用户是在新增、补记或明确重新记录时使用；不要因为普通提问调用。',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: '记录日期 YYYY-MM-DD；省略时使用当前对话日期' },
        message: { type: 'string', description: '完整、清晰的自然语言记录；包含餐次或运动/学习类型' },
      },
      required: ['message'],
    },
  },
  {
    name: 'edit_meal',
    description: '编辑已有饮食内容。用户明确说改成、更新为、重新记录某餐时使用；只传新的食物内容，不手填蛋白质和热量。若用户只修正热量、油量、去皮或份量，items 必须保留原餐的真实食物名称，不能传“上一条记录的餐食”之类说明文字。',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
        index: { type: 'number', description: '编辑加餐时必填，其他餐次省略' },
        items: { type: 'string', description: '新的食物内容' },
      },
      required: ['date', 'meal', 'items'],
    },
  },
  {
    name: 'edit_activity',
    description: '编辑已有运动或学习活动。先查询当天记录获取活动 id，再按用户明确要求更新。',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        date: { type: 'string' },
        label: { type: 'string' },
        minutes: { type: 'number' },
        distanceKm: { type: 'number' },
        count: { type: 'number' },
        note: { type: 'string' },
      },
      required: ['id', 'date', 'label'],
    },
  },
  {
    name: 'delete_record',
    description: '删除已有饮食或活动。第一次调用只生成删除确认，不会删除；只有用户明确确认后才传 confirmed=true。',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        date: { type: 'string' },
        kind: { type: 'string', enum: ['meal', 'activity'] },
        meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
        index: { type: 'number' },
        activityId: { type: 'string' },
        confirmed: { type: 'boolean' },
      },
      required: ['date', 'kind', 'confirmed'],
    },
  },
]

export async function runAgent(request: AgentRequest): Promise<AgentResult> {
  const client = createAiClient()
  if (!client || !aiConfigured()) return fallbackAgent(request)

  const state: ToolState = { saved: [], activities: [] }
  const messages: MessageParam[] = [
    ...request.history.slice(-8).map((item) => ({ role: item.role === 'app' ? 'assistant' : 'user', content: item.text }) as MessageParam),
    { role: 'user', content: request.message },
  ]

  try {
    for (let turn = 0; turn < 6; turn++) {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 1800,
        system: `你是健康记录 app 的主 Agent。你可以正常聊天，也可以调用工具访问或修改用户自己的健康数据。
- 当前对话日期：${request.date}
- 普通问题直接回答；需要事实数据时先调用查询工具，不要猜。
- 用户明确新增/补记饮食、运动、学习时调用 save_health_record。
- 用户纠正某餐并明确要改、更新、重新记录时调用 edit_meal；食物内容改变后让工具重新估算蛋白质、热量和植物性食材。只修正热量、油量、去皮或份量时，保留原餐的真实食物名称，不要把说明文字写入 items。
- 用户说删除时先调用 delete_record confirmed=false 让用户确认。只有历史中已经明确出现“确认删除/确定/删吧”等确认，才可 confirmed=true。
- 不要调用不存在的工具，不要暴露内部工具名。回答简洁、自然、中文。`,
        tools: TOOLS,
        messages,
      })

      const toolUses = response.content.filter((block) => block.type === 'tool_use')
      if (toolUses.length === 0) {
        const text = response.content.find((block) => block.type === 'text')
        return {
          ...mergeSaved(state.saved, state),
          ...(text && text.type === 'text' ? { reply: text.text.trim() } : {}),
        }
      }

      messages.push({ role: 'assistant', content: response.content })
      const results = []
      for (const block of toolUses) {
        try {
          const result = await executeTool(
            block.name,
            block.input,
            request.date,
            state,
            canConfirmDelete(request.history, request.message),
          )
          results.push({ type: 'tool_result' as const, tool_use_id: block.id, content: JSON.stringify(result) })
        } catch (error) {
          results.push({
            type: 'tool_result' as const,
            tool_use_id: block.id,
            is_error: true,
            content: error instanceof Error ? error.message : String(error),
          })
        }
      }
      messages.push({ role: 'user', content: results })
    }
  } catch (error) {
    if (isAiAuthError(error)) throw error
    if (state.saved.length || state.activities.length || state.deletedActivityId) {
      return { ...mergeSaved(state.saved, state), reply: '已完成能执行的操作，但 AI 对话在继续处理时中断了。' }
    }
    console.error('Anthropic Agent 调用失败', error)
    return fallbackAgent(request)
  }

  return { ...mergeSaved(state.saved, state), reply: '我已经处理到这里，但这次对话步骤太多了。请把最后一个动作单独说一次。' }
}

async function executeTool(
  name: string,
  input: unknown,
  fallbackDate: string,
  state: ToolState,
  deleteConfirmed: boolean,
): Promise<unknown> {
  const args = (input ?? {}) as Record<string, unknown>
  const date = stringArg(args.date) || fallbackDate

  if (name === 'get_day_record') {
    const [day, activities] = await Promise.all([getDay(stringArg(args.date) || fallbackDate), listActivities(stringArg(args.date) || fallbackDate)])
    return { day: compactDay(day), activities }
  }

  if (name === 'get_summary') {
    const period = args.period === 'month' ? 'month' : 'week'
    const [days, activities] = await Promise.all([listDays(400), listActivities()])
    const range = period === 'month' ? monthRange(date) : weekRange(date)
    return summarize(days, activities, range)
  }

  if (name === 'get_trend') {
    const weeks = Math.max(1, Math.min(16, Math.round(numberArg(args.weeks) || 8)))
    const [days, activities] = await Promise.all([listDays(400), listActivities()])
    return weeklySnackTrend(days, activities, date, weeks)
  }

  if (name === 'save_health_record') {
    const parsed = await parseEntry(stringArg(args.message), date)
    const saved = await saveParsed(date, parsed)
    state.saved.push(saved)
    return saved
  }

  if (name === 'edit_meal') {
    const saved = await editMeal(
      date,
      args.meal as 'breakfast' | 'lunch' | 'dinner' | 'snack',
      args.index == null ? undefined : numberArg(args.index),
      stringArg(args.items),
    )
    state.saved.push(saved)
    return saved
  }

  if (name === 'edit_activity') {
    const current = (await listActivities(date)).find((item) => item.id === stringArg(args.id))
    if (!current) return { error: '找不到这条活动记录' }
    const activity: Activity = {
      ...current,
      id: stringArg(args.id),
      date,
      label: stringArg(args.label),
      ...(args.minutes == null ? {} : { minutes: numberArg(args.minutes) }),
      ...(args.distanceKm == null ? {} : { distanceKm: numberArg(args.distanceKm) }),
      ...(args.count == null ? {} : { count: numberArg(args.count) }),
      ...(args.note == null ? {} : { note: stringArg(args.note) }),
    }
    const saved = await upsertActivity({ ...current, ...activity })
    state.activities.push(saved)
    return { activity: saved }
  }

  if (name === 'delete_record') {
    if (!args.confirmed || !deleteConfirmed) return { confirmationRequired: true, message: '请向用户确认是否删除这条记录。' }
    if (args.kind === 'activity') {
      const id = stringArg(args.activityId)
      if (!(await listActivities(date)).some((activity) => activity.id === id)) {
        return { error: '找不到这条活动记录' }
      }
      await removeActivity(id)
      state.deletedActivityId = id
      return { ok: true, message: '活动已删除。' }
    }
    const saved = await deleteMeal(
      date,
      args.meal as 'breakfast' | 'lunch' | 'dinner' | 'snack',
      args.index == null ? undefined : numberArg(args.index),
    )
    state.saved.push(saved)
    return saved
  }

  return { error: `未知工具：${name}` }
}

export function canConfirmDelete(history: AgentHistory[], message: string): boolean {
  return /确认删除|确定删除|删吧|删掉吧|删掉它吧|可以删除|好的删除|好的，删|确定|确认/.test(
    [...history.filter((item) => item.role === 'user').map((item) => item.text), message].join('\n'),
  )
}

function mergeSaved(saved: SavedRecord[], state: ToolState): AgentResult {
  const result: SavedRecord = {}
  for (const item of saved) {
    if (item.day) result.day = item.day
    if (item.activities) result.activities = [...(result.activities ?? []), ...item.activities]
    if (item.parsedMeals) result.parsedMeals = [...(result.parsedMeals ?? []), ...item.parsedMeals]
    if (item.weeklySnack) result.weeklySnack = item.weeklySnack
    if (item.error) result.error = item.error
  }
  if (result.parsedMeals?.length) result.parsed = result.parsedMeals[result.parsedMeals.length - 1]
  return {
    ...result,
    ...(state.activities.length ? { activities: [...(result.activities ?? []), ...state.activities] } : {}),
    ...(state.deletedActivityId ? { deletedActivityId: state.deletedActivityId } : {}),
  }
}

async function fallbackAgent(request: AgentRequest): Promise<AgentResult> {
  const [day, activities] = await Promise.all([getDay(request.date), listActivities(request.date)])
  const decision = await agentDecision(request.message, { date: request.date, day, activities, history: request.history })
  if (decision.mode === 'chat') {
    return { reply: decision.reply }
  }
  const parsed = await parseEntry(decision.recordMessage || request.message, request.date)
  return saveParsed(request.date, parsed)
}

function compactDay(day: DayRecord | null) {
  if (!day) return null
  return {
    date: day.date,
    breakfast: day.breakfast,
    lunch: day.lunch,
    dinner: day.dinner,
    snacks: day.snacks.filter((snack) => !snack.note?.startsWith('__weekly_snack__')),
    totalProtein: day.totalProtein,
    totalCalories: day.totalCalories,
    plantsToday: day.plantsToday,
    weekPlantCount: day.weekPlantCount,
  }
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function numberArg(value: unknown): number {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}
