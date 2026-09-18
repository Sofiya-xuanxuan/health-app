-- 在 Supabase 的 SQL Editor 里执行一次。
-- 已经建过表的话重跑也安全：下面的 add column 都带 if not exists。

create table if not exists days (
  date            text primary key,   -- YYYY-MM-DD
  weekday         text,
  breakfast       jsonb,
  lunch           jsonb,
  dinner          jsonb,
  snacks          jsonb not null default '[]',
  total_protein   real not null default 0,
  total_calories  int  not null default 0,
  plants_today    jsonb not null default '[]',
  week_plant_count int
);

-- 来自 iCloud md 的按天植物（原文没按餐拆）。和各餐的 plants 分开存，
-- 否则在这种天里记一餐会把原有植物汇总没了。见 lib/day.ts recalc。
alter table days add column if not exists base_plants jsonb not null default '[]';

-- 跑步记录来自另一个 md（running_log）。手机上读不到你 Mac 的 iCloud 路径，
-- 所以也得进库，否则那张蓝卡片在手机上会整个消失。
create table if not exists runs (
  date     text primary key,   -- YYYY-MM-DD
  distance real not null,
  duration text,
  pace     text,
  note     text
);

alter table runs add column if not exists activities jsonb;

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

-- 这两个表只由服务端用 service_role key 读写（service_role 绕过 RLS）。
-- 开着 RLS 且不建任何 policy = 就算 anon key 泄漏，外人也读不到你的饮食记录。
alter table days enable row level security;
alter table runs enable row level security;
alter table activities enable row level security;
