import { aiConfigured, createAiClient, isAiAuthError } from './ai.ts'
import { activityFromRun } from './activity.ts'
import type { Run, RunActivity } from './icloud.ts'
import { isWeeklySnackNote, type Activity, type DayRecord, type Meal } from './types.ts'

// 换模型改 .env.local 的 AI_MODEL 即可，不用动代码。
// 拿本文件的 5 条真实用例实测过（2026-09-01，网关 llm-center.modelbest.co）：
//   claude-opus-5                 5/5 通过，中位 3.6s   ← 默认
//   deepseek-v4-flash-nothinking  5/5 通过，中位 21s    ← 便宜替代，慢但准
//   glm-5.3                       4/5（偶发空响应）
//   glm-5.3-flash                 3/5，会无视格式写成一篇"晚餐建议"，别用
// 一餐解析是「抽取」类简单任务，用 effort:low 压 token 开销
const MODEL = process.env.AI_MODEL || 'claude-opus-5'

export type ParsedMeal = {
  meal: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  items: string
  protein: number
  calories: number
  plants: string[]
  note?: string
}

const SYSTEM = `你是营养记录助手，帮用户把一餐的自然语言描述转成结构化数据。
规则：
- 判断这餐是 早(breakfast)/午(lunch)/晚(dinner)/加餐(snack) 之一。用户说了就按说的，没说按内容和常识推断。
- 估算这餐的蛋白质(克)和热量(kcal)。份量没给就按常见份量估，并在 note 里标注"份量估算"。
- 只做数据统计，不要评价吃多吃少、不要健康建议。
- 提取这餐里出现的所有"植物性食材"（蔬菜/水果/谷物/豆类/坚果/菌菇等）放进 plants 数组，用于统计饮食多样性；肉蛋奶不算植物。
- plants 必须归一到「原始食材」，去掉加工形态，否则同一种植物会被重复计数：
  面条/馒头/面包/饺子皮 → "小麦"；米饭/米粉 → "大米"；豆腐/豆浆/豆皮/腐竹 → "大豆"；
  粉丝/粉条 → "绿豆"或"红薯"（按常识）；燕麦奶 → "燕麦"。同一餐里同一种原始食材只写一次。
- items 用简洁中文概括这餐吃了什么。
- note 只写估算口径（如"份量估算"），不要写建议。`

const EDIT_SYSTEM = `你是营养记录校准助手，负责把一条已经保存过的餐食按用户新输入重新结构化。
规则：
- 输入会包含 previous 旧记录和 edited 用户修改后的内容。
- 如果用户只是改克重、份数、去皮、少油、蘸料等细节，必须以 previous 的蛋白质和热量为基准，只调整变化的部分，不要把整餐从零重新估算。
- 如果食物内容没变，items 保留 previous.items，不要写"上一条记录的餐食"、"按用户修正"这类说明文字。
- 如果用户明确替换或新增/删除食物，items 用修改后的真实食物名称，没变的食物仍沿用 previous 的估算口径。
- 用户写了明确热量或蛋白质数值时，以用户数值为准；没写清楚的字段再估算。
- plants 仍按原始植物食材归一；note 只写估算口径，不要写建议。`

const ENTRY_SYSTEM = `你是健康记录解析助手，帮用户把一整条自然语言记录转成结构化数据。
规则：
- 直接处理用户原文，不要要求用户分条提交。
- 一条消息里可能同时包含早餐、午餐、晚餐、加餐、运动、学习；必须拆成 entries 多条记录，不要只保留最后一餐。
- 用户明确写了餐次就按餐次保存；没写餐次的食物再按常识判断。
- 估算餐食蛋白质(克)和热量(kcal)。份量没给就按常见份量估，并在 note 标注"份量估算"。
- 提取每餐植物性食材到 plants，归一为原始食材：
  面条/馒头/面包/饺子皮 → "小麦"；米饭/米粉 → "大米"；豆腐/豆浆/豆皮/腐竹 → "大豆"；
  粉丝/粉条 → "绿豆"或"红薯"；燕麦奶 → "燕麦"。
- 运动记录输出 category="exercise"，type 用 run/strength/yoga/pilates/hiit/tennis/ride/swim/workout，尽量提取 minutes、distanceKm、count、note。
- 学习记录输出 category="study"，type 用 english/reading/ai/vlog，尽量提取 minutes、count。
- 只做数据抽取，不要健康建议。`

// schema 只有 Claude 会真正强制执行；网关上的 GLM/DeepSeek 只当提示，
// 实测会带 ```json 包裹、字段名漂移（protein_g / calories_kcal / meal_type）、items 给成数组。
// 所以照发 schema（Claude 走干净路径），再由 coerce() 兜住其它模型的花样。
const SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
      items: { type: 'string' },
      protein: { type: 'number' },
      calories: { type: 'number' },
      plants: { type: 'array', items: { type: 'string' } },
      note: { type: 'string' },
    },
    required: ['meal', 'items', 'protein', 'calories', 'plants'],
    additionalProperties: false,
  },
} as const

const ENTRY_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['meal', 'activity'] },
            meal: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
            items: { type: 'string' },
            protein: { type: 'number' },
            calories: { type: 'number' },
            plants: { type: 'array', items: { type: 'string' } },
            category: { type: 'string', enum: ['exercise', 'study'] },
            type: { type: 'string' },
            label: { type: 'string' },
            minutes: { type: 'number' },
            distanceKm: { type: 'number' },
            count: { type: 'number' },
            note: { type: 'string' },
          },
          required: ['kind'],
          additionalProperties: false,
        },
      },
    },
    required: ['entries'],
    additionalProperties: false,
  },
} as const

const AGENT_SCHEMA = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      mode: { type: 'string', enum: ['chat', 'record'] },
      reply: { type: 'string' },
      recordMessage: { type: 'string' },
    },
    required: ['mode'],
    additionalProperties: false,
  },
} as const

const MEALS = ['breakfast', 'lunch', 'dinner', 'snack'] as const
const EXERCISE_TYPES = ['run', 'strength', 'yoga', 'pilates', 'hiit', 'tennis', 'ride', 'swim', 'workout'] as const
const STUDY_TYPES = ['english', 'reading', 'ai', 'vlog'] as const
const EXERCISE = /跑|配速|心率|骑行|游泳|健身|训练|网球|羽毛球|瑜伽|普拉提|hiit|高强度间歇|力量|公里|千米|km|运动记录|运动/i
const FOOD = /早餐|早饭|午餐|午饭|晚餐|晚饭|加餐|夜宵|吃|喝|饭|菜|肉|鱼|蛋|奶|豆|米|面|粉|粥|汤|馒头|吐司|面包|水果|香蕉|苹果|桃|枣|核桃|饼干|酸奶|咖啡|茶|蛋白粉|能量胶|补给/
const STUDY = /学习|英语|英文|听力|口语|背单词|阅读|读书|看书|读完|笔记|总结|学ai|ai技术|人工智能|机器学习|大模型|编程|vlog|视频|拍视频|发布视频|剪辑/i
const QUESTION = /[?？]|吗|能不能|是不是|为什么|怎么|怎么算|多少|哪些|有没有|查一下|看一下|分析一下|解释/

export function isExerciseOnly(message: string): boolean {
  return EXERCISE.test(message) && !FOOD.test(message)
}

export function isStudyOnly(message: string): boolean {
  return STUDY.test(message) && !FOOD.test(message) && !EXERCISE.test(message)
}

export function isQuestion(message: string): boolean {
  return QUESTION.test(message)
}

type ChatContext = {
  date: string
  day: DayRecord | null
  activities: Activity[]
  history?: ChatHistory[]
}

export type ChatHistory = { role: 'user' | 'app'; text: string }
export type AgentDecision = { mode: 'record'; recordMessage?: string } | { mode: 'chat'; reply: string }

export async function agentDecision(message: string, context: ChatContext): Promise<AgentDecision> {
  const fallback = localAgentDecision(message, context)
  const client = createAiClient()
  if (!client || !aiConfigured()) return fallback

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1000,
      output_config: { effort: 'low', format: AGENT_SCHEMA },
      system: `你是健康记录 app 的对话 agent。你要先判断用户这句话是 chat 还是 record。
- record：用户明确要新增、补记、修改或删除饮食/运动/学习记录，或者直接给出一条清晰的健康记录（如"早餐..."、"跑步5km"）。
- chat：用户在提问、解释、纠正估算、闲聊、追问原因，或只是补充上下文但没有明确要求写入数据库。
- 只有 record 会写数据库。chat 绝对不要写数据库，只基于当天记录和最近对话回答。
- 如果用户说"改成/更新为/重新记录/保存为"，把纠正当 record。
- 如果最近对话正在讨论某一餐的估算，而用户随后给出具体修正条件（如油量、去皮、重量），也当 record，并在 recordMessage 中改写成带明确餐次的完整记录。
返回 JSON。mode=chat 时给 reply；mode=record 时可给 recordMessage。`,
      messages: [{
        role: 'user',
        content: `日期：${context.date}
当天数据：${JSON.stringify(compactContext(context))}
最近对话：${JSON.stringify(context.history ?? [])}
用户输入：${message}`,
      }],
    })
    const text = res.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text' || !text.text.trim()) return fallback
    return coerceAgentDecision(text.text, fallback)
  } catch {
    return fallback
  }
}

function coerceAgentDecision(raw: string, fallback: AgentDecision): AgentDecision {
  const s = raw.indexOf('{')
  const e = raw.lastIndexOf('}')
  if (s < 0 || e < s) return fallback
  let o: { mode?: string; reply?: string; recordMessage?: string }
  try {
    o = JSON.parse(raw.slice(s, e + 1))
  } catch {
    return fallback
  }
  if (o.mode === 'record') return { mode: 'record', recordMessage: o.recordMessage?.trim() || undefined }
  if (o.mode === 'chat') return { mode: 'chat', reply: o.reply?.trim() || (fallback.mode === 'chat' ? fallback.reply : '') }
  return fallback
}

function localAgentDecision(message: string, context: ChatContext): AgentDecision {
  return shouldRecord(message) ? { mode: 'record' } : { mode: 'chat', reply: localAnswer(message, context) }
}

function shouldRecord(message: string): boolean {
  if (isQuestion(message)) return false
  const text = message.trim()
  if (/^(早餐|早饭|午餐|午饭|晚餐|晚饭|加餐|夜宵|零食|运动|学习)[:：\s]/.test(text)) return true
  if (isExerciseOnly(text) || isStudyOnly(text)) return true
  return /记录|记一下|记上|保存|录入|新增|提交|补记|修改|更新|改成|改为|删除/.test(text) && (FOOD.test(text) || EXERCISE.test(text) || STUDY.test(text))
}

export async function answerQuestion(message: string, context: ChatContext): Promise<string> {
  const fallback = localAnswer(message, context)
  const client = createAiClient()
  if (!client || !aiConfigured()) return fallback

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 800,
      output_config: { effort: 'low' },
      system: `你是健康记录 app 里的问答助手。只根据给你的当天记录回答；不要保存或修改数据；不知道就直说。回答要简洁，用中文。`,
      messages: [{
        role: 'user',
        content: `日期：${context.date}
当天记录：${JSON.stringify(compactContext(context))}
用户问题：${message}`,
      }],
    })
    const text = res.content.find((b) => b.type === 'text')
    return text && text.type === 'text' && text.text.trim() ? text.text.trim() : fallback
  } catch (error) {
    console.error('Anthropic 问答调用失败，改用本地回答', error)
    return fallback
  }
}

function compactContext({ day, activities }: ChatContext) {
  return {
    meals: day ? {
      breakfast: day.breakfast,
      lunch: day.lunch,
      dinner: day.dinner,
      snacks: day.snacks.filter((snack) => !isWeeklySnackNote(snack.note)),
      totalProtein: day.totalProtein,
      totalCalories: day.totalCalories,
      plantsToday: day.plantsToday,
    } : null,
    activities,
  }
}

function localAnswer(message: string, { day, activities, history }: ChatContext): string {
  if (!day && activities.length === 0) return '这天还没有记录，所以暂时查不到。'
  const recent = history?.slice(-4).map((item) => item.text).join('\n') ?? ''
  const meal = mealForQuestion(message, day) ?? mealForQuestion(recent, day)
  if (meal) {
    return `${meal.label}记录是：${meal.data.items}。当前保存的估算是蛋白 ${meal.data.protein}g、热量 ${meal.data.calories} kcal。这个数来自记录时 AI 按食物和份量估算；目前没有保存逐项热量拆分。`
  }
  if (/运动|跑|骑行|力量|瑜伽|普拉提/.test(message)) {
    const text = activities.filter((a) => a.category === 'exercise').map((a) => [a.label, a.distanceKm ? `${a.distanceKm}km` : '', a.minutes ? `${a.minutes}分钟` : '', a.count ? `${a.count}次` : ''].filter(Boolean).join(' ')).join('；')
    return text ? `这天的运动记录是：${text}。` : '这天还没有运动记录。'
  }
  return `这天已记录：总蛋白 ${day?.totalProtein ?? 0}g、总热量 ${day?.totalCalories ?? 0} kcal。你可以问某一餐，比如“午餐热量怎么算的”。`
}

function mealForQuestion(message: string, day: DayRecord | null): { label: string; data: Meal } | null {
  if (!day) return null
  if (/早|早餐|早饭/.test(message) && day.breakfast) return { label: '早餐', data: day.breakfast }
  if (/午|午餐|午饭/.test(message) && day.lunch) return { label: '午餐', data: day.lunch }
  if (/晚|晚餐|晚饭/.test(message) && day.dinner) return { label: '晚餐', data: day.dinner }
  const snack = day.snacks.find((item) => !isWeeklySnackNote(item.note))
  if (/加餐|零食|点心/.test(message) && snack) return { label: '加餐', data: snack }
  return null
}

function minutesOf(message: string): number | undefined {
  const hours = message.match(/(\d+(?:\.\d+)?)\s*小时/)
  const mins = message.match(/(\d+(?:\.\d+)?)\s*分钟?/)
  if (!hours && !mins) return undefined
  return Math.round(Number(hours?.[1] ?? 0) * 60 + Number(mins?.[1] ?? 0))
}

function durationText(message: string): string | undefined {
  return message.match(/(\d+(?:\.\d+)?\s*小时(?:\s*\d+(?:\.\d+)?\s*分)?|\d+(?:\.\d+)?\s*分钟?)/)?.[1]
}

function activity(
  category: Activity['category'],
  type: Activity['type'],
  label: string,
  message: string,
  count?: number,
): Omit<Activity, 'id' | 'date'> {
  return {
    category,
    type,
    label,
    ...(minutesOf(message) == null ? {} : { minutes: minutesOf(message) }),
    ...(count == null ? {} : { count }),
  }
}

export function parseStudyActivities(message: string): Omit<Activity, 'id' | 'date'>[] {
  if (/vlog|视频|拍视频|发布视频|剪辑/i.test(message)) {
    return [activity('study', 'vlog', 'vlog', message, /拍|完成|发布|产出|剪辑/i.test(message) ? 1 : undefined)]
  }
  if (/阅读|读书|看书|读完|笔记|总结/i.test(message)) {
    return [activity('study', 'reading', '阅读', message, /读完|笔记|总结|输出/i.test(message) ? 1 : undefined)]
  }
  if (/学ai|ai技术|人工智能|机器学习|大模型|编程/i.test(message)) {
    return [activity('study', 'ai', 'AI技术', message, undefined)]
  }
  if (/英语|英文|听力|口语|背单词/i.test(message)) {
    return [activity('study', 'english', '英语', message, undefined)]
  }
  return [{ ...activity('study', 'reading', '学习', message), ...(minutesOf(message) == null ? { count: 1 } : {}) }]
}

function durationFromSeconds(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function parseExercise(message: string, date: string): Run | null {
  const parsedDistance = Number(message.match(/([\d.]+)\s*(?:km|公里|千米)/i)?.[1])
  const hasDistance = Number.isFinite(parsedDistance) && parsedDistance > 0
  const distance = hasDistance ? parsedDistance : 0
  const exerciseType: Activity['type'] | null =
    /网球/.test(message) ? 'tennis' :
    /瑜伽/.test(message) ? 'yoga' :
    /普拉提/.test(message) ? 'pilates' :
    /hiit|高强度间歇/i.test(message) ? 'hiit' :
    /力量|健身|深蹲|硬拉/.test(message) ? 'strength' :
    /骑行|单车/.test(message) ? 'ride' :
    /游泳/.test(message) ? 'swim' :
    /跑|配速|公里|千米|km/i.test(message) ? 'run' : null
  if (!hasDistance && !exerciseType) return null

  const paceParts = message.match(/(?:均配速|平均配速|配速)[^\d]*(\d{1,2})\s*(?:['′:分])?\s*(\d{2})/)
  const paceSeconds = paceParts ? Number(paceParts[1]) * 60 + Number(paceParts[2]) : 0
  const heart = message.match(/(?:平均|均)?心率[^\d]*(\d+)/)?.[1]
  const tennis = message.match(/打?网球(?:[^\d]*(\d+(?:\.\d+)?\s*小时(?:\s*\d+(?:\.\d+)?\s*分)?|\d+(?:\.\d+)?\s*分钟?))?/)
  const runDuration = paceSeconds
    ? durationFromSeconds(Math.round(distance * paceSeconds))
    : hasDistance
      ? durationText(message)
      : undefined
  const run: RunActivity = {
    type: 'run' as const,
    label: '慢跑',
    distance,
    duration: runDuration,
    pace: paceParts ? `${Number(paceParts[1])}'${paceParts[2]}"` : undefined,
    heartRate: heart ? Number(heart) : undefined,
  }

  const labels: Partial<Record<Activity['type'], string>> = {
    strength: '力量训练',
    yoga: '瑜伽',
    pilates: '普拉提',
    hiit: 'HIIT',
    ride: '骑行',
    swim: '游泳',
  }
  const activities: Run['activities'] = [
    ...(tennis
      ? [{ type: 'tennis' as const, label: '网球', ...(tennis[1] ? { duration: tennis[1] } : {}) }]
      : []),
    ...(hasDistance
      ? [run]
      : exerciseType && exerciseType !== 'tennis'
        ? [{ type: exerciseType, label: labels[exerciseType] ?? exerciseType, duration: durationText(message) }]
        : []),
  ]

  return {
    date,
    distance: hasDistance ? distance : 0,
    duration: run.duration,
    pace: run.pace,
    note: heart ? `均心率${heart}` : undefined,
    activities,
  }
}

export type ParsedSingleEntry =
  | { kind: 'meal'; meal: ParsedMeal }
  | { kind: 'activities'; activities: Omit<Activity, 'id' | 'date'>[] }
  | { kind: 'weeklySnack'; snack: Pick<ParsedMeal, 'items' | 'calories' | 'note'> }

export type ParsedEntry = ParsedSingleEntry | { kind: 'batch'; entries: ParsedSingleEntry[] }

export async function parseEntry(message: string, date: string): Promise<ParsedEntry> {
  if (isWeeklySnack(message)) {
    const snack = await parseMeal(message.replace(/^(本周|这周)?\s*(零食摄入|零食)[:：]?\s*/i, '加餐 '))
    return { kind: 'weeklySnack', snack: { items: snack.items, calories: snack.calories, note: snack.note } }
  }
  if (aiConfigured()) {
    try {
      return await parseEntryWithAi(message)
    } catch (error) {
      if (isAiAuthError(error)) throw error
      console.error('Anthropic 记录解析失败，改用本地解析', error)
    }
  }

  return parseEntryLocally(message, date)
}

function parseEntryLocally(message: string, date: string): ParsedEntry {
  const sections = splitSections(message)
  if (sections.length > 1) {
    const entries = sections.map((section) => parseSectionLocally(section, date))
    return { kind: 'batch', entries: entries.filter((entry) => !(entry.kind === 'activities' && entry.activities.length === 0)) }
  }
  if (isExerciseOnly(message)) {
    const run = parseExercise(message, date)
    return {
      kind: 'activities',
      activities: run
        ? activityFromRun(run).map(({ id: _id, date: _date, ...activity }) => activity)
        : [],
    }
  }
  if (isStudyOnly(message)) return { kind: 'activities', activities: parseStudyActivities(message) }
  return { kind: 'meal', meal: demoParse(message) }
}

async function parseEntryWithAi(message: string): Promise<ParsedEntry> {
  const client = createAiClient()
  if (!client) throw new Error('AI 未配置')
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
    output_config: { effort: 'low', format: ENTRY_SCHEMA },
    system: ENTRY_SYSTEM,
    messages: [{ role: 'user', content: message }],
  })

  const text = res.content.find((b) => b.type === 'text')
  if (!text || text.type !== 'text' || !text.text.trim()) throw new Error('AI 未返回内容')
  const entries = coerceEntries(text.text)
  if (entries.length === 0) throw new Error('AI 没有解析出可保存的记录')
  return entries.length === 1 ? entries[0] : { kind: 'batch', entries }
}

type Section = { label: string; text: string }

function splitSections(message: string): Section[] {
  const labels = /(早餐|早饭|午餐|午饭|晚餐|晚饭|加餐|夜宵|零食|运动记录|运动|学习|早(?=[:：\s])|午(?=[:：\s])|晚(?=[:：\s]))[:：]?/g
  const matches = [...message.matchAll(labels)]
  return matches.map((match, i) => ({
    label: match[1],
    text: message.slice(match.index! + match[0].length, matches[i + 1]?.index ?? message.length).trim(),
  })).filter((section) => section.text)
}

function parseSectionLocally(section: Section, date: string): ParsedSingleEntry {
  if (/运动/.test(section.label)) {
    const run = parseExercise(section.text, date)
    return {
      kind: 'activities',
      activities: run ? activityFromRun(run).map(({ id: _id, date: _date, ...activity }) => activity) : [],
    }
  }
  if (/学习/.test(section.label)) return { kind: 'activities', activities: parseStudyActivities(section.text) }

  const prefix =
    /早/.test(section.label) ? '早餐' :
    /午/.test(section.label) ? '午餐' :
    /晚/.test(section.label) ? '晚餐' :
    '加餐'
  return { kind: 'meal', meal: demoParse(`${prefix} ${section.text}`) }
}

function isWeeklySnack(message: string): boolean {
  return /(?:本周|这周).{0,6}零食|零食摄入/.test(message)
}

function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// 把各家模型的输出捏成 ParsedMeal。别名都是实测撞见的，不是臆想的。
export function coerce(raw: string): ParsedMeal {
  // GLM 爱在 JSON 前后加寒暄（"这是一个很不错的早餐…"），直接掐头去尾取最外层大括号
  const s = raw.indexOf('{')
  const e = raw.lastIndexOf('}')
  if (s < 0 || e < s) throw new Error('AI 返回里没有 JSON：' + raw.slice(0, 60))
  const o = JSON.parse(raw.slice(s, e + 1)) as Record<string, unknown>
  const pick = (...keys: string[]) => keys.map((k) => o[k]).find((v) => v != null)

  const meal = String(pick('meal', 'meal_type', 'mealType') ?? '')
  const items = pick('items', 'item', 'food', 'foods')
  const plants = pick('plants', 'plant_ingredients', 'plantIngredients')
  const note = pick('note', 'notes')

  return {
    meal: (MEALS as readonly string[]).includes(meal) ? (meal as ParsedMeal['meal']) : 'snack',
    items: Array.isArray(items) ? items.map(String).join('、') : String(items ?? ''),
    protein: num(pick('protein', 'protein_g', 'proteinG', 'protein_grams')),
    calories: num(pick('calories', 'calories_kcal', 'caloriesKcal', 'kcal')),
    plants: Array.isArray(plants) ? plants.map(String) : [],
    note: note == null ? undefined : String(note),
  }
}

export function coerceEntries(raw: string): ParsedSingleEntry[] {
  const s = raw.indexOf('{')
  const e = raw.lastIndexOf('}')
  if (s < 0 || e < s) throw new Error('AI 返回里没有 JSON：' + raw.slice(0, 60))
  const o = JSON.parse(raw.slice(s, e + 1)) as { entries?: Record<string, unknown>[] }
  return (o.entries ?? []).map(coerceEntry).filter(Boolean) as ParsedSingleEntry[]
}

function coerceEntry(o: Record<string, unknown>): ParsedSingleEntry | null {
  if (o.kind === 'meal' || o.meal || o.items) {
    const meal = String(o.meal ?? '')
    return {
      kind: 'meal',
      meal: {
        meal: (MEALS as readonly string[]).includes(meal) ? (meal as ParsedMeal['meal']) : 'snack',
        items: String(o.items ?? ''),
        protein: num(o.protein),
        calories: num(o.calories),
        plants: Array.isArray(o.plants) ? o.plants.map(String) : [],
        note: o.note == null ? undefined : String(o.note),
      },
    }
  }

  const type = String(o.type ?? '')
  const isStudy = o.category === 'study' || (STUDY_TYPES as readonly string[]).includes(type)
  const category: Activity['category'] = isStudy ? 'study' : 'exercise'
  const allowed = category === 'study' ? STUDY_TYPES : EXERCISE_TYPES
  if (!(allowed as readonly string[]).includes(type)) return null

  return {
    kind: 'activities',
    activities: [{
      category,
      type: type as Activity['type'],
      label: String(o.label ?? type),
      ...(num(o.minutes) ? { minutes: num(o.minutes) } : {}),
      ...(num(o.distanceKm) ? { distanceKm: num(o.distanceKm) } : {}),
      ...(num(o.count) ? { count: num(o.count) } : {}),
      ...(o.note == null ? {} : { note: String(o.note) }),
    }],
  }
}

// 无 key 时的 Demo 兜底：按关键词粗判餐次，让骨架能演示到四种餐（含加餐）
function demoParse(message: string): ParsedMeal {
  let meal: ParsedMeal['meal'] = 'lunch'
  if (/早|早餐|早饭/.test(message)) meal = 'breakfast'
  else if (/晚|晚餐|晚饭|夜宵/.test(message)) meal = 'dinner'
  else if (/加餐|零食|点心|下午茶|夜宵|加个|水果/.test(message)) meal = 'snack'
  else if (/午|中午|午餐|午饭/.test(message)) meal = 'lunch'
  return {
    meal,
    items: message.slice(0, 40) || '（演示菜）',
    protein: 20,
    calories: 400,
    plants: ['演示蔬菜'],
    note: '演示模式：未接入 AI，数值为占位',
  }
}

export async function parseMeal(message: string): Promise<ParsedMeal> {
  const client = createAiClient()
  if (!client || !aiConfigured()) return demoParse(message)

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low', format: SCHEMA },
      system: SYSTEM,
      messages: [{ role: 'user', content: message }],
    })

    const text = res.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text' || !text.text.trim()) throw new Error('AI 未返回内容')
    return coerce(text.text)
  } catch (error) {
    if (isAiAuthError(error)) throw error
    console.error('Anthropic 餐食解析失败，改用演示解析', error)
    return demoParse(message)
  }
}

export async function parseEditedMeal(meal: ParsedMeal['meal'], previous: Meal, edited: string): Promise<ParsedMeal> {
  const client = createAiClient()
  if (!client || !aiConfigured()) return parseMeal(`${meal} ${edited}`)

  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 1024,
      output_config: { effort: 'low', format: SCHEMA },
      system: EDIT_SYSTEM,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          meal,
          previous: {
            items: previous.items,
            protein: previous.protein,
            calories: previous.calories,
            plants: previous.plants ?? [],
            note: previous.note,
          },
          edited,
        }),
      }],
    })

    const text = res.content.find((b) => b.type === 'text')
    if (!text || text.type !== 'text' || !text.text.trim()) throw new Error('AI 未返回内容')
    return coerce(text.text)
  } catch (error) {
    if (isAiAuthError(error)) throw error
    console.error('Anthropic 编辑解析失败，改用演示解析', error)
    return parseMeal(`${meal} ${edited}`)
  }
}
