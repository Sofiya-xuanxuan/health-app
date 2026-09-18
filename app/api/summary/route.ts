import { listActivities, listDays } from '@/lib/db'
import { summarize, monthRange, weekRange } from '@/lib/summary'
import { authed } from '@/lib/auth'
import { today } from '@/lib/week'

function validDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  const d = new Date(date + 'T00:00:00')
  return !Number.isNaN(d.getTime()) && d.toLocaleDateString('sv-SE') === date
}

export async function GET(req: Request) {
  if (!authed(req)) return Response.json({ error: '未授权' }, { status: 401 })

  const q = new URL(req.url).searchParams
  const period = q.get('period') ?? 'week'
  const date = q.get('date') ?? today()
  if (period !== 'week' && period !== 'month') {
    return Response.json({ error: 'period 只能是 week 或 month' }, { status: 400 })
  }
  if (!validDate(date)) return Response.json({ error: 'date 格式不对' }, { status: 400 })

  const range = period === 'week' ? weekRange(date) : monthRange(date)
  const [days, activities] = await Promise.all([listDays(400), listActivities()])
  return Response.json({ summary: summarize(days, activities, range) })
}
