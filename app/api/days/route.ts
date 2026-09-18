import { getDay, listActivities, listDays, listRuns } from '@/lib/db'
import { authed } from '@/lib/auth'
import { isWeeklySnackNote, type DayRecord } from '@/lib/types'

function hasVisibleMeal(day: DayRecord): boolean {
  return Boolean(day.breakfast || day.lunch || day.dinner || day.snacks.some((snack) => !isWeeklySnackNote(snack.note)))
}

export async function GET(req: Request) {
  if (!authed(req)) return Response.json({ error: '未授权' }, { status: 401 })

  const q = new URL(req.url).searchParams
  const date = q.get('date')

  // 周条要在日期上标点，只需要「哪些天有记录」，别把 44 天正文全传过去
  if (q.has('marks')) {
    const days = await listDays(400)
    const runs = await listRuns()
    const activities = await listActivities()
    return Response.json({
      meals: days.filter(hasVisibleMeal).map((d) => d.date),
      runs: [...new Set([...runs.map((r) => r.date), ...activities.map((a) => a.date)])],
    })
  }

  if (date) {
    // 跑步记录来自另一个 md，按日期挂到当天
    const runs = await listRuns()
    return Response.json({
      day: await getDay(date),
      run: runs.find((r) => r.date === date) ?? null,
      activities: await listActivities(date),
    })
  }
  return Response.json({ days: await listDays(30), runs: await listRuns(), activities: await listActivities() })
}
