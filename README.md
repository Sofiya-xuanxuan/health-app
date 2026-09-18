# 健康记录

一个面向个人使用的 AI 健康记录应用。用户可以通过自然语言记录饮食、运动和学习，也可以直接在对话框中提问。应用会把明确的记录写入数据库，并提供日记录、周/月汇总和趋势分析。

## 功能

- **饮食记录**：早餐、午餐、晚餐、加餐和本周零食
- **营养估算**：根据食物内容自动估算蛋白质、热量和植物性食材
- **运动记录**：跑步、骑行、力量训练、瑜伽、普拉提、网球等
- **学习记录**：英语、阅读、AI 技术和 vlog
- **自然语言交互**：记录健康数据，也可以直接询问当天记录、汇总或趋势
- **记录管理**：编辑和删除饮食、运动、学习记录
- **周/月汇总**：食物多样性、周跑量、骑行、训练次数、学习时长和产出
- **趋势分析**：零食热量、跑量、食物多样性和学习时长等趋势
- **提前记录**：支持选择未来日期进行预先记录

## 技术架构

```text
┌──────────────────────────────┐
│ Next.js App Router 前端       │
│ React + TypeScript + Ant Design│
│ 记录页 / 日记录 / 汇总 / 趋势   │
└──────────────┬───────────────┘
               │ HTTP Route Handlers
┌──────────────▼───────────────┐
│ Next.js 服务端 API             │
│ /api/log                       │
│ /api/days                      │
│ /api/summary                   │
│ /api/snacks/trend              │
└───────┬──────────────┬────────┘
        │              │
        │              └────────────────────┐
        │                                   │
┌───────▼───────────────┐       ┌───────────▼──────────┐
│ AI Agent 层            │       │ 数据访问层            │
│ Anthropic Tool Use     │       │ Supabase PostgreSQL   │
│ 记录 / 查询 / 编辑 / 删除│       │ days / runs / activities│
└───────┬───────────────┘       └───────────┬──────────┘
        │                                   │
┌───────▼───────────────┐       ┌───────────▼──────────┐
│ 领域逻辑              │       │ 历史数据导入          │
│ 饮食、运动、学习解析   │       │ iCloud Markdown       │
│ 日汇总、周/月汇总      │       │ scripts/import.ts     │
└───────────────────────┘       └──────────────────────┘
```

### 主要模块

- `app/page.tsx`：主界面、日期选择、聊天记录、日记录和汇总入口
- `app/snacks/page.tsx`：零食汇总和趋势页面
- `app/api/`：服务端 Route Handlers，统一处理鉴权、AI 请求和数据读写
- `lib/agent.ts`：AI Agent 和工具调用循环
- `lib/claude.ts`：自然语言解析、聊天判断和 AI 结果规范化
- `lib/records.ts`：保存、编辑、删除和重算记录的共享逻辑
- `lib/day.ts`：每日营养合计、植物多样性和加餐合并
- `lib/summary.ts`：周/月汇总和趋势数据计算
- `lib/db.ts`：Supabase 数据访问，以及本地 Demo 数据存储
- `lib/icloud.ts`：解析 iCloud 中的历史 Markdown 记录
- `supabase/schema.sql`：Supabase 数据表和 RLS 配置

### 一条记录的处理流程

```text
用户输入
  ↓
记录页 POST /api/log
  ↓
Agent 判断：聊天 / 查询 / 新增 / 编辑 / 删除
  ↓
调用查询或写入工具
  ↓
保存到 Supabase
  ↓
返回更新后的日记录、活动或对话回复
```

普通问题只走查询或对话流程，不会自动写入数据库。只有明确的记录、编辑或删除意图才会修改数据。

## 技术栈

- Next.js 16
- React 19
- TypeScript
- Ant Design 6
- Tailwind CSS 4
- Anthropic SDK
- Supabase PostgreSQL
- Node.js Test Runner

## 本地运行

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

根据需要填写 `.env.local`：

```bash
# AI
ANTHROPIC_API_KEY=
ANTHROPIC_BASE_URL=
AI_MODEL=claude-opus-5

# Supabase
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_SERVICE_ROLE_KEY=你的服务端密钥

# 可选：应用访问口令
APP_PASSPHRASE=
```

### 3. 启动开发服务

```bash
npm run dev
```

打开 <http://localhost:3000>。

未配置 Supabase 时，应用会使用项目目录下 `.data/` 中的本地 JSON 覆盖层，适合本地开发和 Demo。未配置 AI 密钥时，饮食使用演示解析，运动和学习使用本地规则解析。

## Supabase 配置

1. 在 Supabase 项目的 SQL Editor 中执行 [`supabase/schema.sql`](supabase/schema.sql)。
2. 配置 `SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY`。
3. 重启开发服务。

服务端使用 `service_role` 密钥访问数据库，密钥不会发送到浏览器。生产环境不要把 `.env.local` 提交到 Git，也不要在前端代码中使用 `service_role` 密钥。

## 导入历史数据

如果需要导入 iCloud 中已有的饮食和运动 Markdown 记录：

```bash
npm run import
```

导入脚本只读取 macOS iCloud 中的 Markdown 文件，不会回写原文件。默认文件位置和解析规则见 [`lib/icloud.ts`](lib/icloud.ts)。

## 测试与构建

运行单元测试：

```bash
npm test
```

类型检查：

```bash
npx tsc --noEmit
```

生产构建：

```bash
npm run build
```

生产环境启动：

```bash
npm run start
```

## 数据安全

- `.env*` 已加入 `.gitignore`，不会被提交
- `.data/` 已加入 `.gitignore`，本地健康数据不会被提交
- Supabase 表启用了 RLS
- `service_role` 只在服务端使用
- 删除记录需要二次确认

## 项目状态

当前项目已具备个人健康记录应用的主要闭环：自然语言记录、AI Agent 对话、数据持久化、记录编辑和删除、日/周/月汇总以及趋势图。后续可以继续完善 Garmin 数据自动同步、用户账号体系和更细粒度的营养分析。
