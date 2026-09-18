// 一次性把本机的历史记录（iCloud md + 本地覆盖层）灌进 Supabase。
// 跑法：npm run import
// 可以重复跑：按日期 upsert，同一天会被覆盖成本机的版本。
//
// ponytail: 单向，本机 → 云。手机上新记的不会同步回本机 md——
// 导入完就以 Supabase 为准，本机 md 只是历史底库。
import { DEMO, localDays, localRuns, upsertActivity, upsertDay, upsertRuns } from '../lib/db.ts'
import { activityFromRun } from '../lib/activity.ts'

if (DEMO) {
  console.error('没读到 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY，没什么可导入的。')
  console.error('先把它们写进 .env.local，再跑 npm run import。')
  process.exit(1)
}

const days = localDays()
console.log(`本机有 ${days.length} 天记录，开始导入…`)

for (const d of days) {
  await upsertDay(d)
  console.log(`  ${d.date} ${d.weekday}  蛋白 ${d.totalProtein}g  植物 ${d.plantsToday.length} 种`)
}

const runs = localRuns()
await upsertRuns(runs)
const activities = runs.flatMap(activityFromRun)
for (const activity of activities) await upsertActivity(activity)

console.log(`完成：${days.length} 天饮食，${runs.length} 次旧运动记录，${activities.length} 条活动。`)
