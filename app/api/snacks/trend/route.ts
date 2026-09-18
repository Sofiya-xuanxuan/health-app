import { authed } from '@/lib/auth'
import { listActivities, listDays } from '@/lib/db'
import { weeklySnackTrend } from '@/lib/summary'
import { today } from '@/lib/week'

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const d = new Date(date + 'T00:00:00')
  return !Number.isNaN(d.getTime()) && d.toLocaleDateString('sv-SE') === date
}

export async function GET(req: Request) {
  if (!authed(req)) return Response.json({ error: '未授权' }, { status: 401 })

  const q = new URL(req.url).searchParams
  const date = q.get('date') ?? today()
  if (!validDate(date)) return Response.json({ error: 'date 格式不对' }, { status: 400 })

  const weeks = Math.min(26, Math.max(2, Number(q.get('weeks') ?? 8) || 8))
  const [days, activities] = await Promise.all([listDays(400), listActivities()])
  return Response.json({ points: weeklySnackTrend(days, activities, date, weeks) })
}
