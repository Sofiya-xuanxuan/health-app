"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Button } from "antd";

type Point = {
  from: string;
  to: string;
  label: string;
  snackCalories: number;
  runningKm: number;
  foodDiversity: number;
  learningMinutes: number;
  englishMinutes: number;
  aiMinutes: number;
  readingOutputs: number;
  vlogCount: number;
};

type RawPoint = Partial<Point> & { calories?: number };

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

function todayStr() {
  return new Date().toLocaleDateString("sv-SE");
}

function initialDate() {
  if (typeof window === "undefined") return todayStr();
  return new URLSearchParams(window.location.search).get("date") || todayStr();
}

export default function SnackTrendPage() {
  const [points, setPoints] = useState<Point[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api(`/api/snacks/trend?date=${initialDate()}&weeks=8`)
      .then((res) => res.json())
      .then((json) => {
        if (json.error) setError(json.error);
        else setPoints((json.points ?? []).map(normalizePoint));
      })
      .catch(() => setError("趋势加载失败"));
  }, []);

  const total = points.reduce((sum, point) => sum + point.snackCalories, 0);
  const average = points.length ? Math.round(total / points.length) : 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col bg-white px-4 py-5">
      <header className="flex items-center justify-between">
        <Link href="/?tab=summary">
          <Button type="text">返回</Button>
        </Link>
        <div className="text-[15px] font-semibold text-neutral-900">趋势分析</div>
        <span className="w-[56px]" />
      </header>

      <section className="mt-5 rounded-2xl bg-neutral-950 p-4 text-white">
        <div className="text-[11px] text-white/50">最近 8 周</div>
        <div className="mt-1 text-[28px] font-semibold leading-none">周趋势</div>
        <div className="mt-2 text-[12px] text-white/50">零食合计 {total} kcal · 周均 {average} kcal</div>
      </section>

      {error ? (
        <p className="mt-4 rounded-2xl border border-rose-100 bg-rose-50/60 py-16 text-center text-[13px] text-rose-500">{error}</p>
      ) : points.length ? (
        <div className="mt-4 flex flex-col gap-3">
          <TrendCard title="零食热量" tone="rose" unit="kcal" points={points.map((p) => ({ ...p, value: p.snackCalories }))} />
          <TrendCard title="周跑量" tone="sky" unit="km" points={points.map((p) => ({ ...p, value: p.runningKm }))} />
          <TrendCard title="食物多样性" tone="emerald" unit="种" points={points.map((p) => ({ ...p, value: p.foodDiversity }))} />
          <TrendCard
            title="学习时长"
            tone="amber"
            unit="h"
            points={points.map((p) => ({ ...p, value: Math.round((p.learningMinutes / 60) * 10) / 10 }))}
            tooltip={(point) => studyDetail(point)}
          />
        </div>
      ) : (
        <p className="mt-4 rounded-2xl border border-neutral-100 bg-white py-16 text-center text-[13px] text-neutral-400">加载中</p>
      )}
    </main>
  );
}

type ChartPoint = Point & { value: number };

function TrendCard({
  title,
  tone,
  unit,
  points,
  tooltip,
}: {
  title: string;
  tone: "rose" | "sky" | "emerald" | "amber";
  unit: string;
  points: ChartPoint[];
  tooltip?: (point: ChartPoint) => string[];
}) {
  const [active, setActive] = useState<number | null>(null);
  const styles = {
    rose: "border-rose-100 bg-rose-50/60 text-rose-700 stroke-rose-600",
    sky: "border-sky-100 bg-sky-50/60 text-sky-700 stroke-sky-600",
    emerald: "border-emerald-100 bg-emerald-50/60 text-emerald-700 stroke-emerald-600",
    amber: "border-amber-100 bg-amber-50/60 text-amber-700 stroke-amber-600",
  }[tone].split(" ");
  const [border, bg, color, stroke] = styles;

  return (
    <section className={`rounded-2xl border ${border} ${bg} p-4`}>
      <div className={`mb-2 flex items-center justify-between text-[12px] font-semibold ${color}`}>
        <span>{title}</span>
        <span>{formatValue(safeNumber(points.at(-1)?.value), unit)}</span>
      </div>
      <LineChart points={points} unit={unit} strokeClass={stroke} active={active} onActive={tooltip ? setActive : undefined} tooltip={tooltip} />
    </section>
  );
}

function LineChart({
  points,
  unit,
  strokeClass,
  active,
  onActive,
  tooltip,
}: {
  points: ChartPoint[];
  unit: string;
  strokeClass: string;
  active?: number | null;
  onActive?: (index: number | null) => void;
  tooltip?: (point: ChartPoint) => string[];
}) {
  const chart = useMemo(() => {
    const w = 640;
    const h = 260;
    const pad = { top: 36, right: 24, bottom: 42, left: 34 };
    const max = Math.max(1, ...points.map((point) => safeNumber(point.value)));
    const coords = points.map((point, i) => {
      const value = safeNumber(point.value);
      const x = pad.left + (i * (w - pad.left - pad.right)) / Math.max(1, points.length - 1);
      const y = pad.top + (1 - value / max) * (h - pad.top - pad.bottom);
      return { ...point, value, x, y };
    });
    return { w, h, coords, path: coords.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ") };
  }, [points]);

  const activePoint = active == null ? null : chart.coords[active];
  const tooltipLines = activePoint && tooltip ? tooltip(activePoint) : [];
  const tooltipX = activePoint ? Math.min(Math.max(12, activePoint.x + 16), chart.w - 220) : 0;
  const tooltipY = activePoint ? Math.max(10, activePoint.y - 88) : 0;

  return (
    <div>
      <svg
        viewBox={`0 0 ${chart.w} ${chart.h}`}
        className={`h-auto w-full overflow-visible ${onActive ? "touch-none" : ""}`}
        role="img"
        aria-label="每周趋势折线图"
        onPointerMove={(event) => onActive?.(nearestPoint(event.currentTarget, event.clientX, chart.coords))}
        onPointerDown={(event) => onActive?.(nearestPoint(event.currentTarget, event.clientX, chart.coords))}
        onPointerLeave={() => onActive?.(null)}
      >
        <line x1="34" y1="218" x2="616" y2="218" stroke="rgba(0,0,0,0.08)" strokeWidth="2" />
        {activePoint && <line x1={activePoint.x} y1="30" x2={activePoint.x} y2="218" stroke="rgba(0,0,0,0.18)" strokeWidth="2" strokeDasharray="6 6" />}
        <path d={chart.path} fill="none" className={strokeClass} strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        {chart.coords.map((point, index) => (
          <g key={point.from}>
            <text x={point.x} y={Math.max(16, point.y - 16)} textAnchor="middle" className="fill-neutral-900 text-[22px] font-semibold">
              {formatValue(point.value, unit)}
            </text>
            <circle cx={point.x} cy={point.y} r={active === index ? "13" : "9"} fill="white" className={strokeClass} strokeWidth="5" />
            <text x={point.x} y="246" textAnchor="middle" className="fill-neutral-500 text-[18px]">
              {point.label}
            </text>
          </g>
        ))}
        {activePoint && tooltipLines.length > 0 && (
          <g>
            <rect x={tooltipX} y={tooltipY} width="208" height={48 + tooltipLines.length * 22} rx="10" fill="rgba(23,23,23,0.92)" />
            <text x={tooltipX + 14} y={tooltipY + 25} className="fill-white text-[18px] font-semibold">
              {activePoint.label} · {formatValue(activePoint.value, unit)}
            </text>
            {tooltipLines.map((line, index) => (
              <text key={line} x={tooltipX + 14} y={tooltipY + 53 + index * 22} className="fill-white/80 text-[16px]">
                {line}
              </text>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

function formatValue(value: number, unit: string) {
  const rounded = Math.round(safeNumber(value) * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}${unit}`;
}

function safeNumber(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizePoint(point: RawPoint): Point {
  return {
    from: point.from ?? "",
    to: point.to ?? "",
    label: point.label ?? "",
    snackCalories: safeNumber(point.snackCalories ?? point.calories),
    runningKm: safeNumber(point.runningKm),
    foodDiversity: safeNumber(point.foodDiversity),
    learningMinutes: safeNumber(point.learningMinutes),
    englishMinutes: safeNumber(point.englishMinutes),
    aiMinutes: safeNumber(point.aiMinutes),
    readingOutputs: safeNumber(point.readingOutputs),
    vlogCount: safeNumber(point.vlogCount),
  };
}

function studyDetail(point: ChartPoint) {
  const items = [
    point.englishMinutes ? `英语 ${formatValue(point.englishMinutes / 60, "h")}` : "",
    point.aiMinutes ? `AI ${formatValue(point.aiMinutes / 60, "h")}` : "",
    point.readingOutputs ? `阅读产出 ${point.readingOutputs}个` : "",
    point.vlogCount ? `vlog ${point.vlogCount}个` : "",
  ].filter(Boolean);
  return items.length ? items : ["无学习记录"];
}

function nearestPoint(svg: SVGSVGElement, clientX: number, points: Array<ChartPoint & { x: number }>) {
  const rect = svg.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * 640;
  return points.reduce((best, point, index) => Math.abs(point.x - x) < Math.abs(points[best].x - x) ? index : best, 0);
}
