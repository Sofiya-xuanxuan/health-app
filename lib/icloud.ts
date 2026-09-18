import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { WEEKLY_SNACK_NOTE, isWeeklySnackNote, type DayRecord, type ExerciseType, type Meal } from './types.ts'
import { weekdayLabel, weekMonday } from './week.ts'

// 真实数据源：用户 iCloud 里的 Markdown 流水账。
// 这两个文件是用户自己维护的记忆文件，本模块**只读不写**——
// 解析失败宁可少显示一天，也不能碰坏原文件。
export const DIET_FILE = join(
  homedir(),
  'Library/Mobile Documents/com~apple~CloudDocs/饮食记录/diet_log_2026-07.md',
)
export const RUN_FILE = join(
  homedir(),
  'Library/Mobile Documents/com~apple~CloudDocs/饮食记录/running_log_2026-08.md',
)

// 早/午/晚进固定槽，其余（加餐/跑前/零食/水果…）一律归到 snacks
const SLOT: Record<string, 'breakfast' | 'lunch' | 'dinner'> = {
  早: 'breakfast',
  午: 'lunch',
  晚: 'dinner',
  正餐: 'lunch',
}

export type RunActivity = {
  type: ExerciseType
  label: string
  distance?: number
  duration?: string
  pace?: string
  heartRate?: number
}

export type Run = {
  date: string
  distance: number // km
  duration?: string // "1:01:09"
  pace?: string // "5'03\"/km"
  note?: string
  activities?: RunActivity[]
}

function plantsFrom(line: string): string[] {
  // 两种写法：「今日新增植物：a、b、c」和「今日新增植物3种（a、b、c）→ 本周14/30」
  const inParen = line.match(/今日新增植物\d+种[（(]([^）)]*)[)）]/)
  const afterColon = line.match(/今日新增植物[：:]\s*(.+?)(?:→|$)/)
  const body = inParen?.[1] ?? afterColon?.[1] ?? ''
  return body
    .split(/[、,，]/)
    .map((s) => s.trim())
    .filter((s) => s && !/^其余|已于|已计|不重复/.test(s))
}

function ymd(month: string, day: string): string {
  return `2026-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function weeklySnacks(md: string): { date: string; meal: Meal }[] {
  const section = md.match(/# 每周零食对比[\s\S]*/)?.[0] ?? ''
  const snacks: { date: string; meal: Meal }[] = []
  for (const block of section.split(/^## /m)) {
    const head = block.match(/^(\d{1,2})\/(\d{1,2})[–—-](\d{1,2})\/(\d{1,2})/)
    if (!head) continue
    const [, sm, sd, em, ed] = head
    const from = ymd(sm, sd)
    const to = ymd(em, ed)
    const calories = Number(block.match(/本周零食合计[\s\S]*?热量\s*~?([\d.]+)/)?.[1] ?? 0)
    const protein = Number(block.match(/本周零食合计[\s\S]*?蛋白\s*~?([\d.]+)/)?.[1] ?? 0)
    const items = block
      .split('\n')
      .filter((line) => /^-\s+/.test(line) && !/本周零食合计|注[：:]/.test(line))
      .map((line) => line
        .replace(/^-\s+/, '')
        .replace(/\*\*/g, '')
        .split(/\s*\|\s*蛋白/)[0]
        .replace(/\s+蛋白\s*~?[\d.]+.*/, '')
        .trim())
      .filter(Boolean)
    if (items.length || calories) {
      snacks.push({
        date: from,
        meal: { items: items.join('、'), protein, calories, plants: [], note: `${WEEKLY_SNACK_NOTE}:${from}:${to}` },
      })
    }
  }
  return snacks
}

export function parseDiet(md: string): DayRecord[] {
  const days: DayRecord[] = []
  // 周结算块分两种，处理方式不同：
  //   带【…】标记（【已结算】/【…更新…】）= 用户最终核定值，且含事后补录的植物
  //     （如 8/8「补齐：奇亚籽、油菜、海带、茴香、魔芋」，这些日行里根本没出现过）→ 直接采信
  //   不带标记 = 写下那一刻的快照，后面没回头更新（08/24 停在 13，日行已跑到 33）→ 只当兜底
  const weekFinal = new Map<string, number>()
  const weekSnapshot = new Map<string, number>()
  const weekRunning = new Map<string, number>()

  for (const block of md.split(/^## /m)) {
    const weekly = block.match(/^本周植物多样性（(\d{2})\/(\d{2})[^\n]*?(【[^】]*】)?\s*\n累计\s*(\d+)\/30/)
    if (weekly) {
      const [, mm, dd, settled, n] = weekly
      ;(settled ? weekFinal : weekSnapshot).set(`2026-${mm}-${dd}`, Number(n))
      continue
    }

    const head = block.match(/^(\d{4}-\d{2}-\d{2})/)
    if (!head) continue
    const date = head[1]
    const mon = weekMonday(date)

    const day: DayRecord = {
      date,
      weekday: weekdayLabel(date),
      snacks: [],
      totalProtein: 0,
      totalCalories: 0,
      plantsToday: [],
    }

    for (const line of block.split('\n')) {
      // 餐行：- 早：<食物> | 蛋白21.7 热461
      const m = line.match(/^-\s*([^：:|]+?)[：:]\s*(.+?)\s*\|\s*蛋白\s*~?([\d.]+)\s*热\s*~?([\d.]+)/)
      if (m) {
        const [, rawLabel, items, protein, calories] = m
        const label = rawLabel.replace(/[（(].*/, '').trim()
        const meal: Meal = {
          items: items.trim(),
          protein: Number(protein),
          calories: Number(calories),
          plants: [], // 原文按天记「本周新增」，没按餐拆，见 plantsToday
        }
        const slot = SLOT[label]
        if (slot && !day[slot]) day[slot] = meal
        else day.snacks.push({ ...meal, note: rawLabel.trim() })
        continue
      }

      // 全天合计行是用户自己核对过的，优先于各餐相加
      const total = line.match(/全天：蛋白\s*~?([\d.]+)\s*g，热量\s*~?([\d.]+)\s*kcal/)
      if (total) {
        day.totalProtein = Number(total[1])
        day.totalCalories = Number(total[2])
        continue
      }

      // 同一天可能写多行「今日新增植物」（补记），必须累加，不能覆盖
      if (line.includes('今日新增植物')) {
        day.basePlants = [...new Set([...(day.basePlants ?? []), ...plantsFrom(line)])]
        day.plantsToday = day.basePlants
      }

      // 日行末尾的「→ 本周N/30」和【本周结算】（N种）都是用户的实时口径，取最大
      const running = line.match(/本周\s*(\d+)\/30/)?.[1] ?? line.match(/【本周结算】[^（(]*[（(](\d+)种/)?.[1]
      if (running) weekRunning.set(mon, Math.max(weekRunning.get(mon) ?? 0, Number(running)))
    }

    // 合计行缺失时才回退到各餐相加
    if (!day.totalProtein) {
      const all = [day.breakfast, day.lunch, day.dinner, ...day.snacks].filter(Boolean) as Meal[]
      day.totalProtein = Math.round(all.reduce((s, x) => s + x.protein, 0) * 10) / 10
      day.totalCalories = Math.round(all.reduce((s, x) => s + x.calories, 0))
    }

    days.push(day)
  }

  // 周累计优先级：已核定的结算值 > 日行 running 计数与并集取大 > 未结算的快照
  const byWeek = new Map<string, DayRecord[]>()
  for (const d of days) {
    const k = weekMonday(d.date)
    byWeek.set(k, [...(byWeek.get(k) ?? []), d])
  }
  for (const [mon, group] of byWeek) {
    const union = new Set(group.flatMap((d) => d.plantsToday)).size
    const count =
      weekFinal.get(mon) ?? Math.max(weekRunning.get(mon) ?? 0, union, weekSnapshot.get(mon) ?? 0)
    for (const d of group) d.weekPlantCount = count
  }

  const byDate = new Map(days.map((day) => [day.date, day]))
  for (const { date, meal } of weeklySnacks(md)) {
    const day = byDate.get(date) ?? {
      date,
      weekday: weekdayLabel(date),
      snacks: [],
      totalProtein: 0,
      totalCalories: 0,
      plantsToday: [],
    }
    day.snacks = [...(day.snacks ?? []).filter((snack) => !isWeeklySnackNote(snack.note)), meal]
    byDate.set(date, day)
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date))
}

export function parseRuns(md: string): Run[] {
  const runs: Run[] = []
  for (const block of md.split(/^## /m)) {
    const head = block.match(/^(\d{4}-\d{2}-\d{2})/)
    if (!head) continue
    const dist = block.match(/距离：[≥~]?([\d.]+)\s*km/)
    if (!dist) continue
    runs.push({
      date: head[1],
      distance: Number(dist[1]),
      duration: block.match(/用时\s*([\d:]+)/)?.[1] ?? block.match(/（记录截至[^,，]*[,，]\s*([\d:]+)/)?.[1],
      pace: block.match(/均配速[^：:]*[：:]\s*~?([\d'"]+)/)?.[1],
      note: block.match(/^\d{4}-\d{2}-\d{2}\s*周.\s*[（(]([^）)]+)/)?.[1],
    })
  }
  return runs.sort((a, b) => b.date.localeCompare(a.date))
}

function readOr<T>(file: string, parse: (s: string) => T, fallback: T): T {
  try {
    return parse(readFileSync(file, 'utf8'))
  } catch (e) {
    console.error(`读不到 ${file}，这部分先空着：`, e instanceof Error ? e.message : e)
    return fallback
  }
}

export function loadDiet(): DayRecord[] {
  return readOr(DIET_FILE, parseDiet, [])
}
export function loadRuns(): Run[] {
  return readOr(RUN_FILE, parseRuns, [])
}
