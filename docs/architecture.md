# 系统架构现状（Architecture Snapshot）

最后核对日期：2026-11-25（Phase 0 ~ Phase 3 全部软件能力已完成）

## 1. 技术栈与目录结构

- **前端**：React 19 + TypeScript（`tsconfig.json` + `types.ts` + `strength-calc.ts`，`npm run typecheck` 静态门禁），`esbuild app.tsx --bundle --outfile=app.js --minify`，响应式双端样式 `style.css`，入口 `index.html`。
- **后端**：原生 Node.js 24 HTTP 服务，采用「统一核心路由层 + 极薄数据库适配层」架构：
  - `server-core.mjs`：统一承载 HTTP 路由、可切换认证/Preview Basic Auth、静态资源内存缓存 + `gzip` + `ETag`（304 协商缓存）、JSON/Content-Type 校验与事务调度。
  - `db-sqlite.mjs` + `server.mjs`：本地 SQLite 适配器（`node:sqlite` `DatabaseSync` + WAL + 事务串行队列 + 幂等列迁移），默认数据目录 `data/studio.sqlite`。
  - `db-postgres.mjs` + `server-postgres.mjs`：PostgreSQL 适配器（`pg.Pool` + 无状态局部 `convertPlaceholders` + 独立连接事务 + 幂等列迁移），用于 Docker / Render 云端部署。
- **静态资源与媒体**：
  - `catalog.json`：648 条 ReadyNex 公开动作目录 + `custom_exercises` 教练自定义动作库。
  - `exercise-media.mjs`：按需通过 FFmpeg 截取前 5 秒生成循环 GIF，缓存于 `DATA_DIR/exercise-previews`。

### 模块清单

| 层级 | 文件 | 职责 |
| :--- | :--- | :--- |
| 前端类型与计算 | `tsconfig.json`, `types.ts`, `strength-calc.ts` | TypeScript 类型检查配置、共享领域接口与浏览器端总容量/Epley 1RM 实时计算 |
| 前端入口与工作台 | `app.tsx`, `style.css`, `index.html`, `coach-overview.tsx` | 可切换认证/邀请绑定、教练双栏工作台与今日总览看板、日计划编排、学员单手模式与本地草稿暂存 |
| 前端核心组件 | `roster.tsx`, `calendar.tsx`, `library.tsx`, `rest-timer.tsx` | 学员分组选择、周历导航、动作库（含自定义动作 CRUD）与视频/GIF 播放器、组间倒计时条 |
| 前端业务组件 | `coach-desk.tsx`, `assessment-panel.tsx`, `personal-report.tsx`, `readiness-panel.tsx` | 团队/模板 CRUD 与分发/周报 CSV、测评导入与单条修正/删除、个人容量/1RM PDF 报告、晨起状态打卡与监控 |
| 前端 AI 与周期 | `ai-week.tsx`, `coach-copilot.tsx`, `training-memory.tsx`, `messages.tsx`, `cycles.tsx`, `cycle-review.tsx`, `cycle-reports.tsx` | AI 单周编排、受控工具型 AI 教练副驾驶、训练记忆审核、站内消息、多周周期与力量递进、周期复盘与报告 |
| 后端底座与安全 | `server-core.mjs`, `db-sqlite.mjs`, `db-postgres.mjs`, `server.mjs`, `server-postgres.mjs`, `auth.mjs`, `preview-access.mjs` | 统一 HTTP/API 路由、SQLite/PG 适配器、可切换密码登录/7 天邀请链接/会话撤销、静态资源 gzip/ETag 缓存 |
| 后端业务模块 | `strength.mjs`, `exercise-retriever.mjs`, `readiness.mjs`, `coach-tools.mjs` | 自定义动作/结构化处方/容量与 Epley 1RM、648+自定义动作智能检索、晨起状态与预警、今日总览/团队/模板/个人报告/CRUD |
| 后端 AI 与周期 | `ai-week.mjs`, `coach-copilot.mjs`, `training-memory.mjs`, `assessments.mjs`, `cycles.mjs`, `cycle-review.mjs`, `cycle-reports.mjs`, `messages.mjs` | 智能检索 AI 周编排、受控工具型教练副驾驶、证据指纹记忆、测评 CRUD、周期力量递进与复盘/报告、站内消息 |
| 自动化验证 | `verify-all.mjs`, `verify-phase0.mjs`, `verify-strength.mjs`, `verify-crud.mjs`, `verify-ai-retrieval.mjs`, `verify-ui-ux.mjs`, `verify-readiness.mjs`, `verify-auth.mjs`, `verify-copilot.mjs`, `verify*.mjs` | 一键隔离实例 15 套全量核心回归（`npm run verify:all`）与真实模型套件（`npm run verify:ai`） |

## 2. 数据库核心表与索引

- **基础训练与身份**：`students`（含 `invite`, `expires`, `archived`）、`sessions`、`drafts`、`plans`、`feedback`（含可空 `set_logs`）、`custom_exercises`
  - 复合索引：`plans_owner_day_rev(owner, day, rev)`
- **晨起状态监控**：`readiness`
  - 复合索引：`readiness_day(day, score)`
- **团队与模板**：`training_teams`, `training_templates`
- **体能测评**：`assessments`
  - 复合索引：`assessments_student_day(student, day)`
- **AI 与训练记忆**：`ai_weeks`, `training_memory`
  - 复合索引：`training_memory_student_created(student, created)`
- **站内消息**：`messages`
  - 索引：`messages_thread(student, id)`、`messages_unread(sender, seen, student)`
- **多周周期与报告**：`training_cycles`, `cycle_weeks`, `cycle_reviews`, `cycle_reports`
  - 复合索引：`training_cycles_student_start(student, start_day)`
