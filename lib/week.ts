// 一周按「周一–周日」计算（跟用户的植物多样性结算口径一致）
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 本地日期格式化，避开 toISOString() 的 UTC 偏移（东八区会差一天）
export function fmtLocal(d: Date): string {
  return d.toLocaleDateString('sv-SE')
}

export function weekdayLabel(date: string): string {
  return WEEKDAYS[new Date(date + 'T00:00:00').getDay()]
}

// 返回该日期所在周的周一日期字符串（作为一周的 key）
export function weekMonday(date: string): string {
  const d = new Date(date + 'T00:00:00')
  const dow = d.getDay() // 0=周日
  const diff = dow === 0 ? -6 : 1 - dow // 回退到本周一
  d.setDate(d.getDate() + diff)
  return fmtLocal(d)
}

export function weekSunday(date: string): string {
  const d = new Date(weekMonday(date) + 'T00:00:00')
  d.setDate(d.getDate() + 6)
  return fmtLocal(d)
}

// 本地日期 YYYY-MM-DD
export function today(): string {
  return fmtLocal(new Date())
}
