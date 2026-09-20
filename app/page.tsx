"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { App as AntApp, Button, Form, Input, InputNumber, Modal, Progress, Segmented } from "antd";
import { isWeeklySnackNote, type Activity, type ActivityCategory, type DayRecord, type Meal } from "@/lib/types";
import type { Summary } from "@/lib/summary";

const MEALS: [keyof DayRecord, string][] = [
  ["breakfast", "早"],
  ["lunch", "午"],
  ["dinner", "晚"],
];

const WEEK = ["一", "二", "三", "四", "五", "六", "日"];

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

function shift(date: string, days: number) {
  const d = new Date(date + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("sv-SE");
}

function shiftMonth(date: string, months: number) {
  const d = new Date(date + "T00:00:00");
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + months);
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return d.toLocaleDateString("sv-SE");
}

// 该日期所在周的周一
function monday(date: string) {
  const d = new Date(date + "T00:00:00");
  const dow = d.getDay(); // 0=周日
  d.setDate(d.getDate() + (dow === 0 ? -6 : 1 - dow));
  return d.toLocaleDateString("sv-SE");
}

function label(date: string) {
  const d = new Date(date + "T00:00:00");
  const t = todayStr();
  if (date === t) return "今天";
  if (date === shift(t, -1)) return "昨天";
  return `${d.getMonth() + 1}月${d.getDate()}日 周${WEEK[(d.getDay() + 6) % 7]}`;
}

// 带口令的 fetch：口令存在 localStorage，401 时提示输入
async function api(path: string, init?: RequestInit): Promise<Response> {
  const pass = typeof window !== "undefined" ? localStorage.getItem("pass") ?? "" : "";
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.headers || {}), "Content-Type": "application/json", "x-app-pass": pass },
  });
  if (res.status === 401) {
    const p = window.prompt("请输入访问口令");
    if (p) {
      localStorage.setItem("pass", p);
      return api(path, init);
    }
  }
  return res;
}

export default function Home() {
  const [tab, setTab] = useState<"log" | "day" | "summary">("log");
  const [date, setDate] = useState(todayStr());
  const [day, setDay] = useState<DayRecord | null>(null);
  const [marks, setMarks] = useState<{ meals: string[]; runs: string[] }>({ meals: [], runs: [] });
  const [activities, setActivities] = useState<Activity[]>([]);
  const [msgs, setMsgs] = useState<ChatItem[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function loadDay(d: string) {
    const res = await api(`/api/days?date=${d}`);
    const json = await res.json();
    setDay(json.day ?? null);
    setActivities(json.activities ?? []);
  }

  useEffect(() => {
    loadDay(date);
  }, [date]);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("tab") === "summary") setTab("summary");
  }, []);

  // 周条上的小圆点，进来拉一次就够
  useEffect(() => {
    api("/api/days?marks=1")
      .then((r) => r.json())
      .then((j) => setMarks({ meals: j.meals ?? [], runs: j.runs ?? [] }))
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col bg-white">
      <header className="sticky top-0 z-10 border-b border-neutral-100 bg-white/85 px-5 pt-5 pb-3 backdrop-blur">
        <div className="flex items-baseline justify-between">
          <h1 className="text-[17px] font-semibold tracking-tight">健康记录</h1>
          {day && (
            <span className="text-xs text-neutral-400">
              {day.totalProtein}g · {day.totalCalories} kcal
            </span>
          )}
        </div>
      </header>

      <main className="flex-1 px-4 pb-40">
        {tab === "log" ? (
          <LogTab
            date={date}
            msgs={msgs}
            setMsgs={setMsgs}
            input={input}
            setInput={setInput}
            busy={busy}
            setBusy={setBusy}
            onLogged={(d) => {
              setDay(d);
              setMarks((m) => ({ ...m, meals: [...new Set([...m.meals, d.date])] }));
            }}
            onActivities={(items) => {
              setActivities((old) => {
                const merged = new Map(old.map((item) => [item.id, item]));
                items.forEach((item) => merged.set(item.id, item));
                return [...merged.values()];
              });
              setMarks((m) => ({ ...m, runs: [...new Set([...m.runs, ...items.map((a) => a.date)])] }));
            }}
            onActivityDeleted={(id) => setActivities((items) => items.filter((item) => item.id !== id))}
          />
        ) : tab === "day" ? (
          <DayTab
            date={date}
            setDate={setDate}
            day={day}
            setDay={setDay}
            setActivities={setActivities}
            activities={activities}
            marks={marks}
          />
        ) : (
          <SummaryTab date={date} />
        )}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex w-full max-w-md border-t border-neutral-100 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <TabButton active={tab === "log"} onClick={() => setTab("log")} label="记录" />
        <TabButton
          active={tab === "day"}
          onClick={() => {
            loadDay(date);
            setTab("day");
          }}
          label="今日三餐"
        />
        <TabButton active={tab === "summary"} onClick={() => setTab("summary")} label="汇总" />
      </nav>
    </div>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`relative flex-1 py-3.5 text-[13px] font-medium transition-colors ${
        active ? "text-emerald-600" : "text-neutral-400"
      }`}
    >
      {label}
      {active && <span className="absolute inset-x-0 -top-px mx-auto h-0.5 w-8 rounded-full bg-emerald-500" />}
    </button>
  );
}

// ---- 日期条：左右箭头切天，下方一行本周，有记录的日子标点 ----
function DateBar({
  date,
  setDate,
  marks,
}: {
  date: string;
  setDate: (d: string) => void;
  marks: { meals: string[]; runs: string[] };
}) {
  const mon = monday(date);
  const week = Array.from({ length: 7 }, (_, i) => shift(mon, i));
  const t = todayStr();

  return (
    <div className="rounded-2xl border border-neutral-100 bg-white p-3 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="flex items-center justify-between">
        <Arrow onClick={() => setDate(shift(date, -1))} dir="left" />
        <button
          onClick={() => setDate(t)}
          className="text-[15px] font-semibold tracking-tight text-neutral-900"
        >
          {label(date)}
        </button>
        <Arrow onClick={() => setDate(shift(date, 1))} dir="right" />
      </div>

      <div className="mt-2.5 grid grid-cols-7 gap-1">
        {week.map((d, i) => {
          const on = d === date;
          const hasMeal = marks.meals.includes(d);
          const hasRun = marks.runs.includes(d);
          return (
            <button
              key={d}
              onClick={() => setDate(d)}
              className={`flex flex-col items-center rounded-xl py-1.5 transition-colors ${
                on ? "bg-emerald-500 text-white" : "text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              <span className={`text-[10px] ${on ? "text-emerald-50" : "text-neutral-400"}`}>{WEEK[i]}</span>
              <span className="mt-0.5 text-[13px] font-medium">{Number(d.slice(8))}</span>
              <span className="mt-1 flex h-1 items-center gap-0.5">
                {hasMeal && (
                  <i className={`h-1 w-1 rounded-full ${on ? "bg-white" : "bg-emerald-400"}`} />
                )}
                {hasRun && <i className={`h-1 w-1 rounded-full ${on ? "bg-white" : "bg-sky-400"}`} />}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Arrow({ onClick, dir, disabled }: { onClick: () => void; dir: "left" | "right"; disabled?: boolean }) {
  return (
    <Button
      type="text"
      shape="circle"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === "left" ? "前一天" : "后一天"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points={dir === "left" ? "15 18 9 12 15 6" : "9 18 15 12 9 6"} />
      </svg>
    </Button>
  );
}

function minutesText(minutes?: number) {
  if (!minutes) return "";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}分钟`;
  return m ? `${h}小时${m}分` : `${h}小时`;
}

function activityText(a: Activity | Omit<Activity, "id" | "date">) {
  return [
    a.distanceKm ? `${a.distanceKm} km` : "",
    minutesText(a.minutes),
    a.count ? `${a.count}次` : "",
    a.note,
  ].filter(Boolean).join(" · ");
}

function activitiesFor(activities: Activity[], category: ActivityCategory) {
  return activities.filter((activity) => activity.category === category);
}

// ---- 记录 tab（对话式）----
type ChatItem = { role: "user" | "app"; text: string; day?: DayRecord };
type ParsedMealMessage = { meal: string; items: string; protein: number; calories: number; note?: string };

function LogTab({
  date,
  msgs,
  setMsgs,
  input,
  setInput,
  busy,
  setBusy,
  onLogged,
  onActivities,
  onActivityDeleted,
}: {
  date: string;
  msgs: ChatItem[];
  setMsgs: Dispatch<SetStateAction<ChatItem[]>>;
  input: string;
  setInput: Dispatch<SetStateAction<string>>;
  busy: boolean;
  setBusy: Dispatch<SetStateAction<boolean>>;
  onLogged: (d: DayRecord) => void;
  onActivities: (items: Activity[]) => void;
  onActivityDeleted: (id: string) => void;
}) {
  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text }]);
    setBusy(true);
    try {
      const history = msgs.slice(-8).map(({ role, text }) => ({ role, text }));
      const res = await api("/api/log", { method: "POST", body: JSON.stringify({ message: text, date, history }) });
      const json = await res.json();
      if (json.error) {
        setMsgs((m) => [...m, { role: "app", text: "出错了：" + json.error }]);
      } else {
        if (json.day) onLogged(json.day);
        if (json.activities) onActivities(json.activities);
        if (json.deletedActivityId) {
          onActivityDeleted(json.deletedActivityId);
        }

        const meals = json.parsedMeals ?? (json.parsed ? [json.parsed] : []);
        const lines = [
          ...meals.map((p: ParsedMealMessage) => {
            const l = { breakfast: "早", lunch: "午", dinner: "晚", snack: "加餐" }[p.meal as string];
            return `已记【${l}】${p.items}\n蛋白 ${p.protein}g · 热量 ${p.calories} kcal${p.note ? "\n（" + p.note + "）" : ""}`;
          }),
          ...(json.activities ?? []).map((a: Activity) => `已记${a.category === "study" ? "学习" : "运动"}：${a.label}${activityText(a) ? ` · ${activityText(a)}` : ""}`),
          ...(json.weeklySnack ? [`已记本周零食：${json.weeklySnack.items} · ${json.weeklySnack.calories} kcal`] : []),
        ];
        const replyText = [json.reply, lines.join("\n")].filter(Boolean).join("\n");
        if (replyText) {
          setMsgs((m) => [
            ...m,
            {
              role: "app",
              text: replyText,
              day: json.day,
            },
          ]);
        }
      }
    } catch {
      setMsgs((m) => [...m, { role: "app", text: "网络错误，请重试" }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-4">
      {msgs.length === 0 && (
        <div className="mt-16 flex flex-col items-center gap-2 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-xl">🥗</div>
          <p className="text-[15px] font-medium text-neutral-700">记到 {label(date)}</p>
          <p className="max-w-[16rem] text-[13px] leading-relaxed text-neutral-400">
            直接说吃了什么，比如
            <br />
            「早餐 100g馒头+2蒸蛋+2核桃」
          </p>
        </div>
      )}

      {msgs.map((m, i) => (
        <div key={i} className={m.role === "user" ? "self-end" : "self-start"}>
          <div
            className={`max-w-[80vw] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-[14px] leading-relaxed ${
              m.role === "user"
                ? "rounded-br-md bg-emerald-500 text-white"
                : "rounded-bl-md border border-neutral-100 bg-neutral-50 text-neutral-800"
            }`}
          >
            {m.text}
          </div>
          {m.day && (
            <div className="mt-1.5 px-1 text-[11px] text-neutral-400">
              全天 {m.day.totalProtein}g · {m.day.totalCalories} kcal · 本周植物{" "}
              <span className="font-medium text-emerald-600">{m.day.weekPlantCount ?? 0}/30</span>
            </div>
          )}
        </div>
      ))}

      {busy && (
        <div className="self-start rounded-2xl rounded-bl-md border border-neutral-100 bg-neutral-50 px-3.5 py-2.5">
          <span className="flex gap-1">
            {[0, 150, 300].map((d) => (
              <i
                key={d}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-300"
                style={{ animationDelay: `${d}ms` }}
              />
            ))}
          </span>
        </div>
      )}

      <div className="fixed inset-x-0 bottom-[52px] z-30 mx-auto w-full max-w-md border-t border-neutral-100 bg-white/95 px-3 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="flex gap-2">
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 4 }}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="可以记录，也可以直接提问…"
            className="flex-1"
            style={{ borderRadius: 16, background: "#f5f5f5" }}
          />
          <Button
            type="primary"
            shape="circle"
            size="large"
            onClick={send}
            disabled={busy || !input.trim()}
            className="shrink-0"
            aria-label="记录"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="19" x2="12" y2="5" />
              <polyline points="5 12 12 5 19 12" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- 今日三餐 tab ----
function DayTab({
  date,
  setDate,
  day,
  setDay,
  setActivities,
  activities,
  marks,
}: {
  date: string;
  setDate: (d: string) => void;
  day: DayRecord | null;
  setDay: (d: DayRecord | null) => void;
  setActivities: Dispatch<SetStateAction<Activity[]>>;
  activities: Activity[];
  marks: { meals: string[]; runs: string[] };
}) {
  const { modal } = AntApp.useApp();
  const [form] = Form.useForm<ActivityFormValues>();
  const [mealForm] = Form.useForm<MealFormValues>();
  const [editing, setEditing] = useState<Activity | null>(null);
  const [editingMeal, setEditingMeal] = useState<EditingMeal | null>(null);
  const [saving, setSaving] = useState(false);

  function del(meal: string, index?: number) {
    modal.confirm({
      title: "删掉这一餐？",
      content: "删除后需要重新记录。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await api("/api/log", { method: "DELETE", body: JSON.stringify({ date, meal, index }) });
          const json = await res.json();
          if (json.error) modal.error({ title: "删除失败", content: json.error });
          else setDay(json.day);
        } catch {
          modal.error({ title: "删除失败", content: "网络错误，请重试" });
        }
      },
    });
  }

  function deleteActivityItem(activity: Activity) {
    modal.confirm({
      title: `删掉「${activity.label}」？`,
      content: "删除后需要重新记录。",
      okText: "删除",
      cancelText: "取消",
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          const res = await api("/api/log", { method: "DELETE", body: JSON.stringify({ date, activityId: activity.id }) });
          const json = await res.json();
          if (json.error) modal.error({ title: "删除失败", content: json.error });
          else setActivities((items) => items.filter((a) => a.id !== activity.id));
        } catch {
          modal.error({ title: "删除失败", content: "网络错误，请重试" });
        }
      },
    });
  }

  function editActivityItem(activity: Activity) {
    setEditing(activity);
    form.setFieldsValue({
      label: activity.label,
      minutes: activity.minutes,
      distanceKm: activity.distanceKm,
      count: activity.count,
      note: activity.note,
    });
  }

  function editMealItem(mealKey: string, meal: Meal, label: string, index?: number) {
    setEditingMeal({ mealKey, index, label });
    mealForm.setFieldsValue({
      items: meal.items,
    });
  }

  async function saveActivity(values: ActivityFormValues) {
    if (!editing) return;
    setSaving(true);
    try {
      const next = cleanActivity({
        ...editing,
        label: values.label.trim() || editing.label,
        minutes: optionalNumber(values.minutes),
        distanceKm: optionalNumber(values.distanceKm),
        count: optionalNumber(values.count),
        note: values.note?.trim() || undefined,
      });
      const res = await api("/api/log", { method: "PATCH", body: JSON.stringify({ activity: next }) });
      const json = await res.json();
      if (json.error) {
        modal.error({ title: "保存失败", content: json.error });
        return;
      }
      setActivities((items) => items.map((a) => (a.id === editing.id ? json.activity : a)));
      setEditing(null);
    } catch {
      modal.error({ title: "保存失败", content: "网络错误，请重试" });
    } finally {
      setSaving(false);
    }
  }

  async function saveMeal(values: MealFormValues) {
    if (!editingMeal) return;
    setSaving(true);
    try {
      const res = await api("/api/log", {
        method: "PATCH",
        body: JSON.stringify({ date, mealKey: editingMeal.mealKey, index: editingMeal.index, items: values.items.trim() }),
      });
      const json = await res.json();
      if (json.error) {
        modal.error({ title: "保存失败", content: json.error });
        return;
      }
      setDay(json.day);
      setEditingMeal(null);
    } catch {
      modal.error({ title: "保存失败", content: "网络错误，请重试" });
    } finally {
      setSaving(false);
    }
  }

  const pct = Math.min(100, ((day?.weekPlantCount ?? 0) / 30) * 100);
  const exercise = activitiesFor(activities, "exercise");
  const study = activitiesFor(activities, "study");
  const hasContent = Boolean(day || activities.length);

  return (
    <div className="flex flex-col gap-3 pt-4">
      <Modal
        title="编辑记录"
        open={Boolean(editing)}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
        forceRender
        onCancel={() => setEditing(null)}
        onOk={() => form.submit()}
      >
        <Form<ActivityFormValues> form={form} layout="vertical" onFinish={saveActivity}>
          <Form.Item name="label" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
            <Input />
          </Form.Item>
          <Form.Item name="minutes" label="分钟数">
            <InputNumber min={0} className="w-full" />
          </Form.Item>
          <Form.Item name="distanceKm" label="距离 km">
            <InputNumber min={0} className="w-full" />
          </Form.Item>
          <Form.Item name="count" label="次数/产出数量">
            <InputNumber min={0} className="w-full" />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`编辑${editingMeal?.label ?? "饮食"}`}
        open={Boolean(editingMeal)}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        destroyOnHidden
        forceRender
        onCancel={() => setEditingMeal(null)}
        onOk={() => mealForm.submit()}
      >
        <Form<MealFormValues> form={mealForm} layout="vertical" onFinish={saveMeal}>
          <Form.Item name="items" label="内容" rules={[{ required: true, message: "请输入吃了什么" }]}>
            <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} />
          </Form.Item>
        </Form>
      </Modal>

      <DateBar date={date} setDate={setDate} marks={marks} />

      {!hasContent ? (
        <p className="mt-16 text-center text-[13px] text-neutral-300">这天还没有记录</p>
      ) : (
        <>
          {/* 合计卡：全天两个数 + 本周植物进度 */}
          {day && <div className="rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 p-4 text-white shadow-[0_2px_12px_rgba(16,185,129,0.25)]">
            <div className="flex gap-6">
              <div>
                <div className="text-[11px] text-emerald-50/80">蛋白质</div>
                <div className="mt-0.5 text-[22px] font-semibold leading-none tracking-tight">
                  {day.totalProtein}
                  <span className="ml-0.5 text-[13px] font-normal text-emerald-50/70">g</span>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-emerald-50/80">热量</div>
                <div className="mt-0.5 text-[22px] font-semibold leading-none tracking-tight">
                  {day.totalCalories}
                  <span className="ml-0.5 text-[13px] font-normal text-emerald-50/70">kcal</span>
                </div>
              </div>
            </div>

            <div className="mt-3.5 border-t border-white/15 pt-3">
              <div className="flex items-baseline justify-between text-[11px]">
                <span className="text-emerald-50/80">本周植物多样性</span>
                <span className="font-medium">
                  {day.weekPlantCount ?? 0}
                  <span className="text-emerald-50/70">/30</span>
                </span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-white/20">
                <div className="h-full rounded-full bg-white transition-all duration-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          </div>}

          <ActivitySection title="运动" tone="sky" empty="今天还没有运动" activities={exercise} onEdit={editActivityItem} onDelete={deleteActivityItem} />
          <ActivitySection title="学习" tone="amber" empty="今天还没有学习记录" activities={study} onEdit={editActivityItem} onDelete={deleteActivityItem} />

          {day && MEALS.map(([key, l]) => {
            const meal = day[key] as Meal | undefined;
            return (
              <MealCard
                key={key}
                label={l}
                meal={meal}
                onEdit={meal ? () => editMealItem(key as string, meal, l) : undefined}
                onDelete={() => del(key as string)}
              />
            );
          })}
          {day?.snacks?.map((m, i) => isWeeklySnackNote(m.note) ? null : (
            <MealCard
              key={"snack" + i}
              label={m.note || "加餐"}
              meal={m}
              onEdit={() => editMealItem("snack", m, m.note || "加餐", i)}
              onDelete={() => del("snack", i)}
            />
          ))}

          {day && day.plantsToday.length > 0 && (
            <div className="rounded-2xl border border-neutral-100 bg-white p-4">
              <div className="text-[11px] text-neutral-400">本周新增植物 · {day.plantsToday.length} 种</div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {day.plantsToday.map((p) => (
                  <span key={p} className="rounded-md bg-emerald-50 px-2 py-1 text-[12px] text-emerald-700">
                    {p}
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function cleanActivity(activity: Activity): Activity {
  return Object.fromEntries(Object.entries(activity).filter(([, value]) => value !== undefined && value !== "")) as Activity;
}

type ActivityFormValues = {
  label: string;
  minutes?: number | null;
  distanceKm?: number | null;
  count?: number | null;
  note?: string;
};

type MealFormValues = {
  items: string;
};

type EditingMeal = {
  mealKey: string;
  index?: number;
  label: string;
};

function optionalNumber(value?: number | null) {
  return value == null ? undefined : Number(value);
}

function ActivitySection({
  title,
  tone,
  empty,
  activities,
  onEdit,
  onDelete,
}: {
  title: string;
  tone: "sky" | "amber";
  empty: string;
  activities: Activity[];
  onEdit?: (activity: Activity) => void;
  onDelete?: (activity: Activity) => void;
}) {
  const cls = tone === "sky" ? "border-sky-100 bg-sky-50/60 text-sky-900 text-sky-500" : "border-amber-100 bg-amber-50/60 text-amber-900 text-amber-600";
  const [border, bg, titleColor, subColor] = cls.split(" ");
  return (
    <div className={`rounded-2xl border ${border} ${bg} px-4 py-3`}>
      <div className={`mb-2 text-[12px] font-medium ${titleColor}`}>{title}</div>
      {activities.length === 0 ? (
        <div className="text-[13px] text-neutral-300">{empty}</div>
      ) : (
        <div className="flex flex-col gap-2">
          {activities.map((a) => (
            <div key={a.id} className="flex items-center gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/70 text-[13px] font-medium">
                {a.label.slice(0, 1)}
              </span>
              <div className="min-w-0 flex-1">
                <div className={`text-[14px] font-medium ${titleColor}`}>{a.label}</div>
                {activityText(a) && <div className={`truncate text-[11px] ${subColor}`}>{activityText(a)}</div>}
              </div>
              {onEdit && (
                <Button type="text" size="small" onClick={() => onEdit(a)} className="shrink-0">
                  编辑
                </Button>
              )}
              {onDelete && (
                <Button type="text" danger size="small" onClick={() => onDelete(a)} className="shrink-0">
                  删除
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SummaryTab({ date }: { date: string }) {
  const [period, setPeriod] = useState<"week" | "month">("week");
  const [summaryDate, setSummaryDate] = useState(date);
  const [summary, setSummary] = useState<Summary | null>(null);
  const nextDate = shiftSummaryDate(summaryDate, period, 1);
  const nextDisabled = summaryStart(nextDate, period) > summaryStart(todayStr(), period);

  useEffect(() => {
    setSummaryDate(date);
  }, [date]);

  useEffect(() => {
    api(`/api/summary?period=${period}&date=${summaryDate}`)
      .then((r) => r.json())
      .then((j) => setSummary(j.summary ?? null))
      .catch(() => setSummary(null));
  }, [period, summaryDate]);

  return (
    <div className="flex flex-col gap-3 pt-4">
      <Segmented
        block
        value={period}
        onChange={(value) => setPeriod(value as "week" | "month")}
        options={[
          { label: "本周", value: "week" },
          { label: "本月", value: "month" },
        ]}
      />
      <div className="flex items-center justify-between rounded-2xl border border-neutral-100 bg-white px-3 py-2">
        <Button type="text" onClick={() => setSummaryDate(shiftSummaryDate(summaryDate, period, -1))}>
          {period === "week" ? "上周" : "上月"}
        </Button>
        <div className="text-[13px] font-medium text-neutral-500">{summary ? rangeText(summary.from, summary.to) : "加载中"}</div>
        <Button type="text" disabled={nextDisabled} onClick={() => setSummaryDate(nextDate)}>
          {period === "week" ? "下周" : "下月"}
        </Button>
      </div>
      {summary ? (
        <>
          <Link href={`/snacks?date=${summaryDate}`} className="block">
            <section className="rounded-2xl bg-neutral-950 p-4 text-white">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-white/50">{rangeText(summary.from, summary.to)}</div>
                  <div className="mt-1 text-[18px] font-semibold tracking-tight">{summaryTitle(summaryDate, period)}</div>
                </div>
                <div className="rounded-full bg-white/10 px-3 py-1 text-[12px] text-white/70">
                  {summary.foodDiversity}/30
                </div>
              </div>
              <div className="mt-4">
                <div className="mb-1 flex justify-between text-[12px] text-white/60">
                  <span>食物多样性</span>
                  <span>{Math.min(100, Math.round((summary.foodDiversity / 30) * 100))}%</span>
                </div>
                <Progress percent={Math.min(100, Math.round((summary.foodDiversity / 30) * 100))} showInfo={false} strokeColor="#34d399" railColor="rgba(255,255,255,0.16)" />
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2">
                <SummaryStat label="跑量" value={`${round(summary.runningKm)}km`} />
                <SummaryStat label="骑行" value={`${round(summary.rideKm)}km`} />
                <SummaryStat label="力量/瑜伽" value={`${summary.strengthSessions}/${summary.yogaSessions + summary.pilatesSessions}`} />
              </div>
            </section>
          </Link>

          <SummaryGroup tone="emerald" title="饮食" rows={[
            ["食物多样性", `${summary.foodDiversity}种`],
          ]} />
          <SummaryGroup tone="sky" title="运动" rows={[
            ["跑量", `${round(summary.runningKm)} km`],
            ["骑行", `${round(summary.rideKm)} km`],
            ["力量训练/瑜伽", `${summary.strengthSessions}/${summary.yogaSessions + summary.pilatesSessions}`],
          ]} />
          <SummaryGroup tone="amber" title="学习" rows={[
            ["vlog", `${summary.vlogCount}个`],
            ["英语学习", minutesText(summary.englishMinutes) || "0分钟"],
            ["阅读产出", `${summary.readingOutputs}个`],
            ["AI 技术学习", minutesText(summary.aiMinutes) || "0分钟"],
          ]} />
          <SnackSummary calories={summary.snackCalories} />
        </>
      ) : (
        <p className="mt-16 text-center text-[13px] text-neutral-300">汇总加载中</p>
      )}
    </div>
  );
}

function SnackSummary({ calories }: { calories: number }) {
  return (
    <section className="rounded-2xl border border-rose-100 bg-rose-50/60 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-[12px] font-semibold text-rose-700">
        <span className="h-2 w-2 rounded-full bg-rose-400" />
        零食摄入
      </div>
      <div className="flex items-center justify-between border-t border-white/70 pt-2">
        <span className="text-[13px] text-neutral-500">总热量</span>
        <span className="text-[16px] font-semibold text-neutral-900">{round(calories)} kcal</span>
      </div>
    </section>
  );
}

function shiftSummaryDate(date: string, period: "week" | "month", delta: number) {
  return period === "week" ? shift(date, delta * 7) : shiftMonth(date, delta);
}

function summaryStart(date: string, period: "week" | "month") {
  return period === "week" ? monday(date) : `${date.slice(0, 7)}-01`;
}

function summaryTitle(date: string, period: "week" | "month") {
  if (summaryStart(date, period) === summaryStart(todayStr(), period)) return period === "week" ? "本周汇总" : "本月汇总";
  return period === "week" ? "周汇总" : "月汇总";
}

function SummaryStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/8 px-3 py-2">
      <div className="text-[11px] text-white/45">{label}</div>
      <div className="mt-1 truncate text-[15px] font-semibold">{value}</div>
    </div>
  );
}

function SummaryGroup({ title, tone, rows }: { title: string; tone: "emerald" | "sky" | "amber" | "rose"; rows: [string, string][] }) {
  const styles = {
    emerald: "border-emerald-100 bg-emerald-50/50 text-emerald-700",
    sky: "border-sky-100 bg-sky-50/60 text-sky-700",
    amber: "border-amber-100 bg-amber-50/60 text-amber-700",
    rose: "border-rose-100 bg-rose-50/60 text-rose-700",
  }[tone].split(" ");
  const [border, bg, color] = styles;

  return (
    <section className={`rounded-2xl border ${border} ${bg} px-4 py-3`}>
      <div className={`mb-2 flex items-center gap-2 text-[12px] font-semibold ${color}`}>
        <span className={`h-2 w-2 rounded-full ${tone === "emerald" ? "bg-emerald-400" : tone === "sky" ? "bg-sky-400" : tone === "amber" ? "bg-amber-400" : "bg-rose-400"}`} />
        {title}
      </div>
      {rows.map(([name, value]) => (
        <div key={name} className="flex items-start justify-between gap-3 border-t border-white/70 py-2 first:border-t-0">
          <span className="shrink-0 text-[13px] text-neutral-500">{name}</span>
          <span className="min-w-0 text-right text-[14px] font-semibold leading-relaxed text-neutral-900">{value}</span>
        </div>
      ))}
    </section>
  );
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}

function rangeText(from: string, to: string) {
  return `${Number(from.slice(5, 7))}月${Number(from.slice(8))}日 - ${Number(to.slice(5, 7))}月${Number(to.slice(8))}日`;
}

function MealCard({
  label,
  meal,
  onEdit,
  onDelete,
}: {
  label: string;
  meal?: Meal;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  if (!meal) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-dashed border-neutral-200 px-4 py-3.5">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-[11px] font-medium text-neutral-400">
          {label}
        </span>
        <span className="text-[13px] text-neutral-300">未记录</span>
      </div>
    );
  }

  return (
    <div className="group rounded-2xl border border-neutral-100 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-[11px] font-medium text-emerald-600">
          {label.slice(0, 2)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] leading-relaxed text-neutral-800">{meal.items}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-neutral-400">
            <span>
              蛋白 <span className="font-medium text-neutral-600">{meal.protein}g</span>
            </span>
            <span>
              <span className="font-medium text-neutral-600">{meal.calories}</span> kcal
            </span>
          </div>
          {meal.plants && meal.plants.length > 0 && (
            <div className="mt-1.5 text-[11px] text-emerald-600">🌱 {meal.plants.join("、")}</div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button type="text" size="small" onClick={onEdit}>
            编辑
          </Button>
          <Button
            type="text"
            danger
            shape="circle"
            size="small"
            onClick={onDelete}
            aria-label={`删除${label}`}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </Button>
        </div>
      </div>
    </div>
  );
}
