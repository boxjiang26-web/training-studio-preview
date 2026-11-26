# 任务单：Phase 0 止血与工程底座统一

- **任务编号**：`TASK-001`
- **对应阶段**：Phase 0
- **分支 / Worktree**：当前工作区主线
- **当前负责人（Agent）**：Antigravity
- **状态**：已完成

---

## 1. 目标与范围

- **要解决的问题**：
  1. `Dockerfile` 漏拷 `cycle-review.mjs` / `cycle-reports.mjs`，云端镜像无法启动；
  2. `server-postgres.mjs` 中 `sql.index` 挂载于函数对象，存在并发占位符编号竞态；
  3. `cycle-review.mjs` 写死 `p.rev = 1`，导致周期周发布后再做单日修订（`rev = 2`）时学员反馈在复盘与周期报告中静默丢失；
  4. `server.mjs` 与 `server-postgres.mjs` 路由高度重复，存在日期校验/事务保护漂移，且缺少核心索引与静态资源压缩/ETag 缓存；
  5. 前端多文件为单行高密度压缩风格、缺乏 `tsconfig.json` 与共享领域类型，不利于多 Agent 协作与评审；
  6. 缺少隔离实例一键全量回归入口，且 4 个早期 `verify-*.mjs` 脚本因 `<details>新建学员档案` 折叠与 `Roster` 分组而老化。
- **包含范围（In Scope）**：
  - 统一后端核心 `server-core.mjs` + `db-sqlite.mjs` / `db-postgres.mjs` 适配层与精简入口；
  - 修复 `Dockerfile`、`cycle-review.mjs`、`db-postgres.mjs` 缺陷；
  - 新增 `tsconfig.json`、`types.ts`，格式化前端组件与 `style.css`（零业务/DOM 契约变更）；
  - 新增 `verify-phase0.mjs`、`verify-all.mjs` 及 `package.json` 门禁脚本，修复 4 个历史验证脚本选择器；
  - 更新 `docs/architecture.md` 与 `docs/roadmap.md`。
- **不包含范围（Out of Scope）**：
  - 不改变任何表名、列名或既有 API 契约；
  - 不新增业务功能（留待 Phase 1+）。

## 2. 架构与接口契约

### 数据表变更（SQLite 与 PostgreSQL 同步）
- 表结构零破坏变更；双库统一补充 4 个复合索引：
  - `plans_owner_day_rev ON plans(owner, day, rev)`
  - `assessments_student_day ON assessments(student, day)`
  - `training_cycles_student_start ON training_cycles(student, start_day)`
  - `training_memory_student_created ON training_memory(student, created)`

### 涉及文件
- 新增：`server-core.mjs`、`db-sqlite.mjs`、`db-postgres.mjs`、`tsconfig.json`、`types.ts`、`verify-phase0.mjs`、`verify-all.mjs`
- 修改：`server.mjs`、`server-postgres.mjs`、`cycle-review.mjs`、`Dockerfile`、`package.json`、`.gitignore`、`app.tsx`、`style.css`、`cycles.tsx`、`ai-week.tsx`、`roster.tsx`、`training-memory.tsx`、`cycle-review.tsx`、`cycle-reports.tsx`、`messages.tsx`、`personal-report.tsx`、`library.tsx`、`verify.mjs`、`verify-library.mjs`、`verify-teams.mjs`、`verify-assessments.mjs`、`verify-ai.mjs`、`docs/architecture.md`、`docs/roadmap.md`

## 3. 验收标准（Definition of Done）

- [x] `npm.cmd run typecheck` 通过（零报错）
- [x] `npm.cmd run build` 通过且生成最新 `app.js`
- [x] SQLite 与 PostgreSQL 共用 `server-core.mjs` 且 `Dockerfile` 通过传递模块覆盖校验
- [x] `npm.cmd run verify:all` 全量 8 套回归脚本通过（隔离测试实例，不污染 `data/studio.sqlite`）

---

## 4. 交接记录

### 实现摘要
- **后端底座统一**：抽离 `server-core.mjs` 统一处理路由、鉴权、参数校验、单日写事务（`/api/draft`、`/api/publish`、`/api/feedback`）、JSON/Content-Type 兼容解析及静态资源内存缓存 + `gzip` + `ETag/304`。`db-sqlite.mjs` 引入轻量事务串行队列，`db-postgres.mjs` 将占位符替换改为无状态局部计数器 `convertPlaceholders`。
- **静默统计 Bug 修复**：`cycle-review.mjs` 改用 `p.rev = (SELECT MAX(q.rev) ...)`，并使用最新版本的 `plan.items` 统计计划组数，保证 `rev=2+` 修订与反馈准确计入周期复盘与报告。
- **前端工程治理**：安装 `typescript`、`@types/react`、`@types/react-dom`（`devDependencies`），新增 `tsconfig.json` 与 `types.ts`，并将 11 个前端组件与 `style.css` 格式化为清晰多行代码。
- **回归基线加固**：新增 `verify-phase0.mjs` 与隔离端口/隔离临时目录运行的 `verify-all.mjs`；修复 `verify.mjs`、`verify-library.mjs`、`verify-teams.mjs`、`verify-assessments.mjs` 中因早期 `<details>` 折叠与 `Roster` 分组导致的老化选择器。

### 验证输出
- `npm.cmd run typecheck`：Exit 0（零错误）
- `npm.cmd run build`：Exit 0（`app.js 1.3mb`, `Done in 107ms`）
- `npm.cmd run verify:all`：Exit 0，全部 8 套脚本在隔离 SQLite 实例上通过：
  - `verify-phase0.mjs`：PASS（PG 占位符并发、`Dockerfile` 13 个传递 `.mjs` 覆盖、ETag/304 + charset JSON + bad JSON 400 + 无效日期拒绝、周期 `rev=2` 复盘统计）
  - `verify.mjs`：PASS
  - `verify-library.mjs`：PASS（含真实视频播放与 320px GIF 生成）
  - `verify-teams.mjs`：PASS
  - `verify-assessments.mjs`：PASS
  - `verify-report.mjs`：PASS
  - `verify-messages.mjs`：PASS
  - `verify-cycles.mjs`：PASS

### 遗留说明
- 涉及真实 DeepSeek 模型调用的 5 套脚本（`verify-ai.mjs`、`verify-memory.mjs`、`verify-cycle-ai.mjs`、`verify-cycle-review.mjs`、`verify-cycle-reports.mjs`）已集成至 `npm.cmd run verify:ai`，因本次未改动模型提示词与生成逻辑且避免消耗 API 额度，未自动触发；后续进入 Phase 3 改动 AI 编排时再运行实测。
- 本地未运行真实 PostgreSQL 实例，PG 适配层已通过无状态占位符并发单测及语法/模块依赖检查，部署至 Render 预览环境后建议按 `README.md` 验证公网 `/healthz` 与一次完整发布读回。
