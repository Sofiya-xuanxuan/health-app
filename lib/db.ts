import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { activityFromRun, normalizeActivity } from './activity.ts'
import type { Activity, DayRecord } from './types.ts'
import { loadDiet, loadRuns, type Run } from './icloud.ts'
import { weekMonday, fmtLocal } from './week.ts'

// 没配 Supabase 时落本地 JSON 文件，重启不丢
const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
export const DEMO = !URL || !KEY

const supabase = DEMO ? null : createClient(URL!, KEY!)

// ---- 数据来源（Demo 模式）----
// 底库 = 用户 iCloud 里的 Markdown 流水账，**只读**，本程序永不写回。
// 覆盖层 = app 内新记/删改的，单独存 .data/days.json，同日期时盖过底库。
// ponytail: 每次请求重新读+解析（28KB，几毫秒）。不缓存是故意的——
// 用户随时在别处编辑那个 md，缓存只会让 app 显示过期数据。
const FILE = join(process.cwd(), '.data', 'days.json')
const RUNS_FILE = join(process.cwd(), '.data', 'runs.json')
const ACTIVITIES_FILE = join(process.cwd(), '.data', 'activities.json')

function overlay(): Map<string, DayRecord> {
  try {
    const obj = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, DayRecord>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

// 本机的全部记录（md 底库 + 覆盖层）。导入脚本用它把历史灌进 Supabase。
export function localDays(): DayRecord[] {
  return [...load().values()].sort((a, b) => a.date.localeCompare(b.date))
}

export function localRuns(): Run[] {
  const m = new Map(loadRuns().map((r) => [r.date, r]))
  for (const [k, v] of runOverlay()) m.set(k, v)
  return [...m.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function load(): Map<string, DayRecord> {
  const m = new Map(loadDiet().map((d) => [d.date, d]))
  for (const [k, v] of overlay()) m.set(k, v)
  return m
}

function save(m: Map<string, DayRecord>): void {
  mkdirSync(dirname(FILE), { recursive: true })
  writeFileSync(FILE, JSON.stringify(Object.fromEntries(m), null, 2))
}

function runOverlay(): Map<string, Run> {
  try {
    const obj = JSON.parse(readFileSync(RUNS_FILE, 'utf8')) as Record<string, Run>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

function saveRuns(m: Map<string, Run>): void {
  mkdirSync(dirname(RUNS_FILE), { recursive: true })
  writeFileSync(RUNS_FILE, JSON.stringify(Object.fromEntries(m), null, 2))
}

function activityOverlay(): Map<string, Activity> {
  try {
    const obj = JSON.parse(readFileSync(ACTIVITIES_FILE, 'utf8')) as Record<string, Activity>
    return new Map(Object.entries(obj))
  } catch {
    return new Map()
  }
}

function saveActivities(m: Map<string, Activity>): void {
  mkdirSync(dirname(ACTIVITIES_FILE), { recursive: true })
  writeFileSync(ACTIVITIES_FILE, JSON.stringify(Object.fromEntries(m), null, 2))
}

// ---- 行 <-> DayRecord 映射（Supabase）----
type Row = Record<string, unknown>
function toRow(d: DayRecord): Row {
  return {
    date: d.date,
    weekday: d.weekday,
    breakfast: d.breakfast ?? null,
    lunch: d.lunch ?? null,
    dinner: d.dinner ?? null,
    snacks: d.snacks,
    total_protein: d.totalProtein,
    total_calories: d.totalCalories,
    plants_today: d.plantsToday,
    base_plants: d.basePlants ?? [],
    week_plant_count: d.weekPlantCount ?? null,
  }
}
function fromRow(r: Row): DayRecord {
  return {
    date: r.date as string,
    weekday: r.weekday as string,
    breakfast: (r.breakfast as DayRecord['breakfast']) ?? undefined,
    lunch: (r.lunch as DayRecord['lunch']) ?? undefined,
    dinner: (r.dinner as DayRecord['dinner']) ?? undefined,
    snacks: (r.snacks as DayRecord['snacks']) ?? [],
    totalProtein: (r.total_protein as number) ?? 0,
    totalCalories: (r.total_calories as number) ?? 0,
    plantsToday: (r.plants_today as string[]) ?? [],
    basePlants: (r.base_plants as string[]) ?? undefined,
    weekPlantCount: (r.week_plant_count as number) ?? undefined,
  }
}

export async function getDay(date: string): Promise<DayRecord | null> {
  if (DEMO) return load().get(date) ?? null
  const { data } = await supabase!.from('days').select('*').eq('date', date).maybeSingle()
  return data ? fromRow(data) : null
}

export async function listDays(limit = 30): Promise<DayRecord[]> {
  if (DEMO) return [...load().values()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, limit)
  const { data } = await supabase!.from('days').select('*').order('date', { ascending: false }).limit(limit)
  return (data ?? []).map(fromRow)
}

// 同一周（周一–周日）的所有记录，用来累计植物多样性
export async function listWeek(date: string): Promise<DayRecord[]> {
  const mon = weekMonday(date)
  const monDate = new Date(mon + 'T00:00:00')
  const sun = new Date(monDate)
  sun.setDate(sun.getDate() + 6)
  const sunStr = fmtLocal(sun)
  if (DEMO) return [...load().values()].filter((d) => d.date >= mon && d.date <= sunStr)
  const { data } = await supabase!.from('days').select('*').gte('date', mon).lte('date', sunStr)
  return (data ?? []).map(fromRow)
}

export async function upsertDay(d: DayRecord): Promise<void> {
  if (DEMO) {
    // 只写覆盖层。用户的 iCloud md 是只读底库，本程序不碰。
    const m = overlay()
    m.set(d.date, d)
    save(m)
    return
  }
  const { error } = await supabase!.from('days').upsert(toRow(d), { onConflict: 'date' })
  if (error) throw error
}

// 跑步是只读的（源头在 running_log md）。Demo 直接解析文件，上线读表。
export async function listRuns(): Promise<Run[]> {
  if (DEMO) {
    return [...localRuns()].sort((a, b) => b.date.localeCompare(a.date))
  }
  const { data } = await supabase!.from('runs').select('*').order('date', { ascending: false })
  return (data ?? []) as Run[]
}

export async function upsertRun(run: Run): Promise<void> {
  if (DEMO) {
    const m = runOverlay()
    m.set(run.date, run)
    saveRuns(m)
    return
  }
  await upsertRuns([run])
}

export async function upsertRuns(runs: Run[]): Promise<void> {
  if (DEMO || runs.length === 0) return
  // 每行的键必须一致，否则 PostgREST 批量 upsert 会报错（有的跑步没写配速/备注）
  const rows = runs.map((r) => ({
    date: r.date,
    distance: r.distance,
    duration: r.duration ?? null,
    pace: r.pace ?? null,
    note: r.note ?? null,
    activities: r.activities ?? null,
  }))
  const { error } = await supabase!.from('runs').upsert(rows, { onConflict: 'date' })
  if (error) throw error
}

function activityRow(a: Activity): Row {
  return {
    id: a.id,
    date: a.date,
    category: a.category,
    type: a.type,
    label: a.label,
    minutes: a.minutes ?? null,
    distance_km: a.distanceKm ?? null,
    count: a.count ?? null,
    title: a.title ?? null,
    note: a.note ?? null,
  }
}

function activityFromRow(r: Row): Activity {
  return normalizeActivity({
    id: String(r.id),
    date: String(r.date),
    category: r.category as Activity['category'],
    type: r.type as Activity['type'],
    label: String(r.label),
    minutes: r.minutes == null ? undefined : Number(r.minutes),
    distanceKm: r.distance_km == null ? undefined : Number(r.distance_km),
    count: r.count == null ? undefined : Number(r.count),
    title: r.title == null ? undefined : String(r.title),
    note: r.note == null ? undefined : String(r.note),
  })
}

export async function upsertActivity(activity: Activity): Promise<Activity> {
  const normalized = normalizeActivity(activity)
  if (DEMO) {
    const m = activityOverlay()
    m.set(normalized.id, normalized)
    saveActivities(m)
    return normalized
  }
  const { error } = await supabase!.from('activities').upsert(activityRow(normalized), { onConflict: 'id' })
  if (error) throw error
  return normalized
}

export async function deleteActivity(id: string): Promise<void> {
  if (DEMO) {
    const m = activityOverlay()
    m.delete(id)
    saveActivities(m)
    return
  }
  const { error } = await supabase!.from('activities').delete().eq('id', id)
  if (error) throw error
}

export async function listActivities(date?: string): Promise<Activity[]> {
  if (!DEMO) {
    const query = supabase!.from('activities').select('*').order('date', { ascending: false }).order('id')
    const { data, error } = date ? await query.eq('date', date) : await query
    if (error) throw error
    return (data ?? []).map(activityFromRow)
  }

  const all = new Map<string, Activity>()
  for (const run of await listRuns()) {
    for (const activity of activityFromRun(run)) all.set(activity.id, activity)
  }
  for (const [id, activity] of activityOverlay()) all.set(id, normalizeActivity(activity))
  return [...all.values()]
    .filter((activity) => !date || activity.date === date)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
}
