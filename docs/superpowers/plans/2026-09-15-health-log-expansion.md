# Health Log Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将当前饮食记录器扩展为可记录饮食、运动、学习，并提供每日展示以及周/月汇总。

**Architecture:** 饮食继续使用现有 `DayRecord`。运动和学习统一使用按日期保存的 `Activity`，同一天允许多条活动；现有 iCloud 跑步 Markdown 和旧 `Run` 数据通过适配器转换成 `Activity`，避免重写历史源文件。周/月汇总只从日期范围内的饮食和活动即时计算，不保存冗余汇总值。

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Node `node:test`, Supabase, 本地 JSON Demo 存储。

---

## 产品口径

- 饮食：保留现有早、午、晚、加餐、蛋白质、热量和植物多样性。
- 运动：支持跑步、力量训练、瑜伽、普拉提、网球等；同一天的跑步和网球是两条并列活动。
- 学习：支持阅读、英语、AI 技术、vlog。
- 学习指标口径：
  - 英语、AI 技术：累计分钟数，展示时换算成小时。
  - vlog：每条“完成/产出 vlog”计 1 个。
  - 阅读产出：明确写“读完”“完成阅读”“输出读书笔记/总结”的记录计 1 个；只写阅读时长不计产出。
- 第一版每次提交创建一条或一组同类活动；同一天多次提交会追加，不覆盖当天其他活动。
- 每日页面顺序：饮食汇总、运动模块、学习模块、饮食明细。学习模块固定放在运动模块下方；没有记录时显示空状态。

## 文件地图

- Modify `lib/types.ts`: 增加 `Activity` 和汇总结果类型。
- Create `lib/activity.ts`: 活动类型标签、旧跑步记录适配、活动字段规范化。
- Modify `lib/claude.ts`: 在保留餐食解析的前提下增加运动/学习输入解析。
- Modify `lib/db.ts`: 本地活动覆盖层、Supabase 活动读写，以及旧跑步数据合并。
- Modify `app/api/log/route.ts`: 记录入口按餐食、运动、学习分流。
- Modify `app/api/days/route.ts`: 日期接口返回当天活动。
- Create `app/api/summary/route.ts`: 周/月汇总接口。
- Create `lib/summary.ts`: 周/月日期范围和汇总计算。
- Modify `app/page.tsx`: 今日运动/学习模块和周/月汇总视图。
- Modify `supabase/schema.sql`: 增加 `activities` 表。
- Modify `scripts/import.ts`: 导入 iCloud 跑步活动。
- Modify `lib/*.test.ts`: 增加解析、活动兼容、汇总测试。
- Create `docs/superpowers/plans/2026-09-15-health-log-expansion.md`: 本计划。

### Task 1: 建立统一活动数据模型

**Files:**
- Modify: `lib/types.ts`
- Create: `lib/activity.ts`
- Test: `lib/activity.test.ts`

- [ ] **Step 1: Write the failing type/normalization tests**

```ts
import assert from 'node:assert'
import test from 'node:test'
import { activityFromRun, normalizeActivity } from './activity.ts'

test('旧 Run 的复合记录拆成并列活动', () => {
  const activities = activityFromRun({
    date: '2026-09-13',
    distance: 10.32,
    duration: '1:00:12',
    pace: '5\'50"',
    note: '均心率124',
    activities: [
      { type: 'tennis', label: '网球', duration: '1小时28分' },
      {
        type: 'run',
        label: '慢跑',
        distance: 10.32,
        duration: '1:00:12',
        pace: '5\'50"',
        heartRate: 124,
      },
    ],
  })
  assert.deepEqual(activities.map((a) => a.type), ['tennis', 'run'])
  assert.equal(activities[1].distanceKm, 10.32)
})

test('活动数值统一为合法的非负值', () => {
  assert.deepEqual(
    normalizeActivity({
      id: 'x',
      date: '2026-09-15',
      category: 'study',
      type: 'english',
      minutes: -20,
      count: -1,
    }),
    {
      id: 'x',
      date: '2026-09-15',
      category: 'study',
      type: 'english',
      minutes: 0,
      count: 0,
    },
  )
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test lib/activity.test.ts`

Expected: FAIL because `Activity`, `activityFromRun`, and `normalizeActivity` do not exist.

- [ ] **Step 3: Add the minimum data types**

Add to `lib/types.ts`:

```ts
export type ActivityCategory = 'exercise' | 'study'

export type ExerciseType = 'run' | 'strength' | 'yoga' | 'pilates' | 'tennis' | 'ride' | 'swim' | 'workout'
export type StudyType = 'english' | 'reading' | 'ai' | 'vlog'

export type Activity = {
  id: string
  date: string
  category: ActivityCategory
  type: ExerciseType | StudyType
  label: string
  minutes?: number
  distanceKm?: number
  count?: number
  title?: string
  note?: string
}
```

- [ ] **Step 4: Implement the compatibility adapter**

`lib/activity.ts` must:

```ts
import type { Activity } from './types.ts'
import type { Run } from './icloud.ts'

export function activityFromRun(run: Run): Activity[] {
  const items = run.activities?.length
    ? run.activities
    : [{ type: 'run' as const, label: run.note ?? '跑步', distance: run.distance, duration: run.duration, pace: run.pace }]

  return items.map((item, index) => ({
    id: `${run.date}:legacy:${index}`,
    date: run.date,
    category: 'exercise',
    type: item.type,
    label: item.label,
    minutes: item.duration ? durationMinutes(item.duration) : undefined,
    distanceKm: item.distance,
    note: [item.pace ? `均配速 ${item.pace}/km` : '', item.heartRate ? `均心率${item.heartRate}` : '']
      .filter(Boolean)
      .join(' · ') || undefined,
  }))
}

export function normalizeActivity(activity: Activity): Activity {
  return {
    ...activity,
    minutes: activity.minutes == null ? undefined : Math.max(0, Number(activity.minutes) || 0),
    distanceKm: activity.distanceKm == null ? undefined : Math.max(0, Number(activity.distanceKm) || 0),
    count: activity.count == null ? undefined : Math.max(0, Number(activity.count) || 0),
  }
}
```

`durationMinutes` only needs to handle existing `H:MM:SS`, `MM:SS`, and Chinese `X小时Y分` strings. Do not add a duration library.

- [ ] **Step 5: Run the focused test and the existing test suite**

Run: `node --test lib/activity.test.ts`

Expected: PASS.

Run: `npm test`

Expected: all existing tests and the new activity tests pass.

### Task 2: Add exercise and study parsing to the record entry

**Files:**
- Modify: `lib/claude.ts`
- Modify: `app/api/log/route.ts`
- Modify: `lib/claude.test.ts`

- [ ] **Step 1: Write parser tests**

Add tests for:

```ts
test('网球和慢跑解析为两条运动活动', async () => {
  assert.deepEqual(await parseEntry('打网球1小时28分，慢跑10.32km，平均配速550，平均心率124', '2026-09-15'), {
    kind: 'activities',
    activities: [
      { category: 'exercise', type: 'tennis', label: '网球', minutes: 88, count: 1 },
      {
        category: 'exercise',
        type: 'run',
        label: '慢跑',
        distanceKm: 10.32,
        minutes: 60,
        note: '均配速 5\'50"/km · 均心率124',
      },
    ],
  })
})

test('学习输入识别类别和时长', async () => {
  assert.deepEqual(await parseEntry('学英语听力1小时', '2026-09-15'), {
    kind: 'activities',
    activities: [{ category: 'study', type: 'english', label: '英语', minutes: 60 }],
  })
})

test('产出 vlog 计一次', async () => {
  assert.deepEqual(await parseEntry('今天拍完并发布一个vlog', '2026-09-15'), {
    kind: 'activities',
    activities: [{ category: 'study', type: 'vlog', label: 'vlog', count: 1 }],
  })
})
```

- [ ] **Step 2: Run tests and verify the new tests fail**

Run: `npm test`

Expected: FAIL because `parseEntry` does not exist.

- [ ] **Step 3: Implement the discriminated parser**

Add:

```ts
export type ParsedEntry =
  | { kind: 'meal'; meal: ParsedMeal }
  | { kind: 'activities'; activities: Omit<Activity, 'id' | 'date'>[] }

export async function parseEntry(message: string, date: string): Promise<ParsedEntry> {
  if (isExerciseOnly(message)) {
    return { kind: 'activities', activities: parseExerciseActivities(message) }
  }
  if (isStudyOnly(message)) {
    return { kind: 'activities', activities: parseStudyActivities(message) }
  }
  return { kind: 'meal', meal: await parseMeal(message) }
}
```

Implementation constraints:

- Keep `parseMeal` and the current Anthropic schema intact for food.
- Extract numbers with regular expressions for exercise/study; do not call AI for obvious activity entries.
- Recognize study keywords:
  - English: `英语`, `英文`, `听力`, `口语`, `背单词`, `英語`.
  - Reading: `阅读`, `读书`, `看书`, `读完`, `读完书`, `读书笔记`.
  - AI: `学AI`, `AI技术`, `人工智能`, `机器学习`, `大模型`, `编程`.
  - vlog: `vlog`, `视频`, `拍视频`, `发布视频`, `剪辑`.
- Parse `1小时30分`, `90分钟`, and `1.5小时` into minutes.
- A completed/produced vlog gets `count: 1`.
- A reading sentence containing `读完`, `笔记`, `总结`, or `输出` gets `count: 1`; plain reading duration gets only `minutes`.
- A strength/yoga/pilates/tennis session without a duration still gets `count: 1`.
- A pure activity with no usable numeric field must still be saved with `count: 1`; it must not become a fake meal.

- [ ] **Step 4: Route parsed activities into persistent storage**

In `app/api/log/route.ts`:

```ts
const entry = await parseEntry(message, date)
if (entry.kind === 'activities') {
  const activities = await Promise.all(
    entry.activities.map((activity, index) =>
      upsertActivity({
        id: `${date}:${Date.now()}:${index}`,
        date,
        ...activity,
      }),
    ),
  )
  return Response.json({ activities })
}
```

Keep the existing meal branch unchanged except for using the new parser result.

- [ ] **Step 5: Verify parser and API behavior**

Run: `npm test`

Expected: all parser tests pass and pure activity input no longer creates meal records.

Run: `npx tsc --noEmit`

Expected: no TypeScript errors.

### Task 3: Persist activities without losing existing runs

**Files:**
- Modify: `lib/db.ts`
- Modify: `app/api/days/route.ts`
- Modify: `supabase/schema.sql`
- Modify: `scripts/import.ts`
- Test: `lib/db.test.ts`

- [ ] **Step 1: Write the persistence contract test**

The Demo-mode test must prove:

```ts
test('同一天可以保存多条活动，且不覆盖其他活动', async () => {
  await upsertActivity({ id: '2026-09-15:a', date: '2026-09-15', category: 'exercise', type: 'tennis', label: '网球', minutes: 60, count: 1 })
  await upsertActivity({ id: '2026-09-15:b', date: '2026-09-15', category: 'study', type: 'english', label: '英语', minutes: 60 })
  const activities = await listActivities('2026-09-15')
  assert.deepEqual(activities.map((a) => a.type), ['tennis', 'english'])
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `node --test lib/db.test.ts`

Expected: FAIL because `upsertActivity` and `listActivities` do not exist.

- [ ] **Step 3: Add local JSON activity storage**

Use `.data/activities.json` keyed by activity ID:

```json
{
  "2026-09-15:a": {
    "id": "2026-09-15:a",
    "date": "2026-09-15",
    "category": "exercise",
    "type": "tennis",
    "label": "网球",
    "minutes": 60,
    "count": 1
  }
}
```

`listActivities(date)` must return:

1. Activities derived from the existing iCloud `Run` records through `activityFromRun`.
2. Activities from `.data/activities.json`.
3. Deduplicated by `id`, sorted by `date` and insertion key.

Do not write back to iCloud Markdown.

- [ ] **Step 4: Add Supabase persistence**

Add to `supabase/schema.sql`:

```sql
create table if not exists activities (
  id           text primary key,
  date         text not null,
  category     text not null check (category in ('exercise', 'study')),
  type         text not null,
  label        text not null,
  minutes      real,
  distance_km  real,
  count        real,
  title        text,
  note         text
);

create index if not exists activities_date_idx on activities(date);
alter table activities enable row level security;
```

`upsertActivity` uses Supabase `upsert` in production and the local JSON map in Demo mode. Check and throw on Supabase errors instead of silently returning success.

- [ ] **Step 5: Update date API and import**

`GET /api/days?date=YYYY-MM-DD` returns:

```json
{
  "day": {},
  "run": {},
  "activities": []
}
```

Keep `run` temporarily for compatibility, but the UI will use `activities`.

Update `scripts/import.ts` to convert each iCloud `Run` with `activityFromRun` and upsert those activities into Supabase. Existing `runs` import can remain for one migration pass; it must not be used as a second source in the new summary.

- [ ] **Step 6: Run persistence tests**

Run: `npm test`

Expected: all tests pass and existing 9/13-style compound run data returns separate tennis and running activities.

### Task 4: Add daily exercise and study modules

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/api/days/route.ts`

- [ ] **Step 1: Add view-model helpers**

Use a small local helper in `app/page.tsx`:

```ts
function activitiesFor(activities: Activity[], category: ActivityCategory) {
  return activities.filter((activity) => activity.category === category)
}
```

Do not add a component library or state-management package.

- [ ] **Step 2: Make the page show a day even without diet**

Replace the current `!day` gate with:

```ts
const hasContent = Boolean(day || activities.length)
```

When `hasContent` is false, show the existing empty-day message. This allows a day with only exercise or study to render.

- [ ] **Step 3: Render the exercise module**

Use the existing blue visual style. Each activity is an independent row:

```tsx
<ActivitySection title="运动" tone="sky">
  {exercise.length === 0 ? <EmptyActivity text="今天还没有运动" /> : exercise.map(...)}
</ActivitySection>
```

Render:

- running distance and duration
- strength/yoga/pilates/tennis labels
- minutes as `X小时Y分` or `X分钟`
- count when relevant
- note/title when supplied

- [ ] **Step 4: Render the study module directly below exercise**

Use a separate neutral/amber module directly after the exercise module:

```tsx
<ActivitySection title="学习" tone="amber">
  {study.length === 0 ? <EmptyActivity text="今天还没有学习记录" /> : study.map(...)}
</ActivitySection>
```

Labels:

- `英语`
- `阅读`
- `AI 技术`
- `vlog`

Show duration for English/AI/reading and count for reading output/vlog output.

- [ ] **Step 5: Update the record response handling**

When `POST /api/log` returns `{ activities }`, append the user-visible confirmation in the existing chat and update the current-day activities in state. Do not put activities into `DayRecord.snacks`.

- [ ] **Step 6: Verify the daily UI**

Run: `npx tsc --noEmit`

Expected: no TypeScript errors.

Run: `npm test`

Expected: all tests pass.

Manual check with `npm run dev`:

1. Submit `打网球1小时，慢跑10km，平均配速550`.
2. Submit `英语学习1小时`.
3. Open “今日” view.
4. Verify tennis and running are parallel rows.
5. Verify the learning module is immediately below exercise.
6. Verify no activity appears in the meal cards or nutrition totals.

### Task 5: Implement weekly and monthly summaries

**Files:**
- Create: `lib/summary.ts`
- Create: `app/api/summary/route.ts`
- Modify: `app/page.tsx`
- Test: `lib/summary.test.ts`

- [ ] **Step 1: Write date-range and aggregation tests**

```ts
import assert from 'node:assert'
import test from 'node:test'
import { summarize, monthRange, weekRange } from './summary.ts'

test('周汇总使用周一到周日', () => {
  assert.deepEqual(weekRange('2026-09-15'), { from: '2026-09-14', to: '2026-09-20' })
})

test('月汇总使用自然月', () => {
  assert.deepEqual(monthRange('2026-09-15'), { from: '2026-09-01', to: '2026-09-30' })
})

test('汇总饮食、运动和学习指标', () => {
  const result = summarize(
    [
      { date: '2026-09-15', plantsToday: ['大米', '油菜'] },
      { date: '2026-09-16', plantsToday: ['油菜', '香蕉'] },
    ] as DayRecord[],
    [
      { id: 'r1', date: '2026-09-15', category: 'exercise', type: 'run', label: '跑步', distanceKm: 10 },
      { id: 'r2', date: '2026-09-15', category: 'exercise', type: 'strength', label: '力量训练', minutes: 45, count: 1 },
      { id: 'r3', date: '2026-09-16', category: 'exercise', type: 'yoga', label: '瑜伽', count: 1 },
      { id: 's1', date: '2026-09-15', category: 'study', type: 'english', label: '英语', minutes: 90 },
      { id: 's2', date: '2026-09-16', category: 'study', type: 'vlog', label: 'vlog', count: 1 },
      { id: 's3', date: '2026-09-16', category: 'study', type: 'reading', label: '阅读', count: 1 },
    ],
  )
  assert.deepEqual(result, {
    foodDiversity: 3,
    runningKm: 10,
    strengthMinutes: 45,
    strengthSessions: 1,
    yogaSessions: 1,
    pilatesSessions: 0,
    vlogCount: 1,
    englishMinutes: 90,
    readingOutputs: 1,
    aiMinutes: 0,
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `node --test lib/summary.test.ts`

Expected: FAIL because `weekRange`, `monthRange`, and `summarize` do not exist.

- [ ] **Step 3: Implement summary functions**

`lib/summary.ts` must:

- use existing `weekMonday` and `fmtLocal` helpers;
- calculate week range as Monday through Sunday;
- calculate month range as the first through last local calendar day;
- filter records by inclusive `from <= date <= to`;
- union `plantsToday` for food diversity;
- sum `distanceKm` only for `type === 'run'`;
- sum `minutes` and `count ?? 1` for strength/yoga/pilates;
- sum `minutes` for English and AI;
- sum `count ?? 1` for vlog;
- count reading outputs from `count`, with no duration-based fallback.

Return:

```ts
export type Summary = {
  from: string
  to: string
  foodDiversity: number
  runningKm: number
  strengthMinutes: number
  strengthSessions: number
  yogaSessions: number
  pilatesSessions: number
  vlogCount: number
  englishMinutes: number
  readingOutputs: number
  aiMinutes: number
}
```

- [ ] **Step 4: Add the summary API**

`GET /api/summary?period=week&date=2026-09-15` and `GET /api/summary?period=month&date=2026-09-15` return one `Summary`.

The route loads the existing day records and activities, filters them to the selected date range, and calls `summarize`. Validate `period` and `date`; return HTTP 400 for invalid values.

- [ ] **Step 5: Add a summary view**

Add a third bottom tab named `汇总`. Inside it:

- segmented control: `本周` / `本月`;
- date title showing the actual range, such as `9月14日 - 9月20日`;
- food section: `食物多样性`;
- exercise section: `周跑量`, `力量训练`, `瑜伽`, `普拉提`;
- study section: `vlog`, `英语学习`, `阅读产出`, `AI 技术学习`.

Use compact rows rather than nested cards. The existing mobile width and bottom navigation remain.

- [ ] **Step 6: Verify weekly/monthly summaries**

Run: `npm test`

Expected: all tests pass.

Manual check:

1. Use one week containing existing meals and runs.
2. Confirm plant diversity equals the union of daily `plantsToday`.
3. Add a 45-minute strength session and a 1-hour English session.
4. Confirm the weekly values update.
5. Switch to `本月` and confirm the same metrics use the natural month.

### Task 6: Migration, cleanup, and release verification

**Files:**
- Modify: `README.md`
- Modify: `.gitignore` only if the new local file is not covered by the existing `.data` rule.
- Modify: `supabase/schema.sql` if the final table needs an additional index.

- [ ] **Step 1: Migrate the current local compound activity**

Run a one-off Node command or migration script that converts the existing `.data/runs.json` entry for `2026-09-13` into two `Activity` records:

```json
[
  {
    "id": "2026-09-13:legacy:tennis",
    "date": "2026-09-13",
    "category": "exercise",
    "type": "tennis",
    "label": "网球",
    "minutes": 88,
    "count": 1
  },
  {
    "id": "2026-09-13:legacy:run",
    "date": "2026-09-13",
    "category": "exercise",
    "type": "run",
    "label": "慢跑",
    "distanceKm": 10.32,
    "minutes": 60,
    "note": "均配速 5'50\"/km · 均心率124"
  }
]
```

Do not delete or modify the iCloud Markdown source.

- [ ] **Step 2: Update README setup instructions**

Document:

```text
npm install
cp .env.example .env.local
npm run dev
npm test
npx tsc --noEmit
```

Also document Supabase initialization with `supabase/schema.sql`, importing historical data with `npm run import`, and the distinction between local Demo storage and Supabase production storage.

- [ ] **Step 3: Run the complete verification**

Run:

```bash
npm test
npx tsc --noEmit
npm run build
```

Expected:

- tests pass;
- TypeScript passes;
- production build passes without requiring Google Fonts network access.

Before this step, replace `next/font/google` in `app/layout.tsx` with the already-defined system font stack if the build still depends on external font fetching.

- [ ] **Step 4: Check the user-visible workflows**

Verify:

- food input updates only diet cards and nutrition totals;
- same-day tennis and running remain parallel activities;
- strength, yoga, and pilates show below the exercise heading;
- study appears immediately below exercise;
- reading output and vlog count are not confused with study duration;
- changing the selected day reloads meals and activities together;
- week/month switching changes only the selected summary range;
- a day containing only learning or exercise is still visible.

## Milestones

- **M1: Daily data foundation:** Tasks 1-3. Unified activities persist without damaging existing diet/run data.
- **M2: Daily experience:** Task 4. The user can record and review diet, exercise, and study on one day.
- **M3: Review loop:** Task 5. Weekly and monthly metrics are visible and computed from the same source data.
- **M4: Ready to deploy:** Task 6. Historical data, docs, Supabase schema, tests, and build are aligned.

## Deliberately Deferred

- No account system or multi-user model.
- No iCloud write-back.
- No charts or trend analysis beyond the requested counters and totals.
- No natural-language batch editor for correcting old records.
- No arbitrary custom activity types until the requested categories prove insufficient.
