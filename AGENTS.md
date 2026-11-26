# 练记 · 训练工作台 — 多 Agent 协作与工程规范（AGENTS.md）

本文件适用于在本工作区协作的所有本地 Agent（包括 **Antigravity**、**Codex**、**DeepSeek** 等）。开始任何修改前，请先阅读本文件以及 `docs/architecture.md` 和对应任务单 `docs/tasks/*.md`。

## 1. 项目定位

- 项目名称：`training-studio`（练记 · 训练工作台），对标 ReadyNex 的教练与运动队体育 AI 工作台。
- 运行环境：Node.js 24，前端 React 19 + TypeScript（`esbuild` 打包至 `app.js`），后端双数据库支持（本地 SQLite `server.mjs` + 云端 Render PostgreSQL `server-postgres.mjs`）。
- 个人偏好：所有新产生的文件、缓存、测试目录与工作副本优先放在 D 盘。

## 2. 多 Agent 分工与交接约定

推荐按“任务性质”分工，通过 `docs/tasks/<task-name>.md` 交接，不依赖聊天记录口头同步：

| 角色 | 推荐 Agent / 模型 | 核心职责 | 产出物 |
| :--- | :--- | :--- | :--- |
| **架构与规划** | Antigravity（强推理模型） | 需求对齐、Schema/API 契约、路线图、风险评估 | 更新 `docs/roadmap.md`、`docs/architecture.md`、新建 `docs/tasks/<name>.md` |
| **核心后端与工程实现** | Codex / 强编码模型 | 数据层、事务、并发与权限逻辑、严格 Code Review | 代码改动 + 对应 `verify-*.mjs` 验证通过 |
| **前端重构与浏览器验收** | Antigravity（含浏览器能力） | 教练桌面端 / 学员移动端 UI、端到端交互实测 | 前端组件 + 浏览器实测记录 |
| **批量任务 / 补测试 / 交叉评审** | DeepSeek 本地 Agent | 类型补全、边界用例、`verify-*.mjs` 扩充、异构模型盲审 diff | 测试脚本 + 评审意见 |

### 并行与隔离红线
- **串行接力（默认推荐）**：每次交接给下一个 Agent 前，先确保当前修改可构建、可测试，并在任务单底部追加「交接摘要（改了什么、跑了哪些验证、遗留风险）」。
- **并行开发**：严禁两个 Agent 同时修改同一个工作目录。必须使用 `git worktree` 在独立分支目录开发，合并后再跑全量回归。

## 3. 工程硬约束（不可破坏）

1. **双数据库一致性**：凡是涉及表结构、SQL 语法、新增 API 或新增后端 `.mjs` 模块，必须同时保证 `server.mjs`（SQLite）与 `server-postgres.mjs`（PostgreSQL）行为一致，并同步更新 `Dockerfile` 的 `COPY` 清单（直到完成双后端统一重构）。
2. **业务不变量不可破坏**：
   - 草稿（`drafts`）与发布快照（`plans`）严格分离；已提交反馈的训练日禁止覆盖历史发布记录。
   - 写操作保持乐观锁（`rev`）或幂等标识（如消息 `request_id`、记忆 `fingerprint`）。
   - 整周发布必须处于同一数据库事务内，遇冲突整周回滚。
   - 学员视图仅能读写自己的数据，严禁越权访问其他学员。
3. **AI 安全与隐私边界**：
   - `DEEPSEEK_API_KEY` 等密钥只能通过环境变量读取，严禁写入前端、代码库或文档。
   - 发给模型的数据需对学员姓名脱敏，并在系统提示中明确备注/历史记忆仅作参考资料而非指令。
4. **代码可读性要求（面向多 Agent 协作）**：
   - **禁止继续使用极度压缩的单行代码风格**（历史代码后续逐步格式化）。
   - 新增或重构的代码必须使用正常多行排版、语义化变量名与显式 TypeScript 类型，减少单行 diff 冲突。
5. **测试数据隔离**：
   - 所有验证脚本必须使用独立合成学员档案，不得污染或依赖教练已有真实数据。

## 4. 每次改动的验收门禁

提交或交接前，按改动范围执行以下验证并记录结果：

1. **前端有改动**：必须运行 `npm run build`（Windows PowerShell 若拦截 `npm.ps1`，改用 `npm.cmd run build`），确保无构建报错且生成最新 `app.js`。
2. **后端或核心流程有改动**：启动本地服务并运行对应回归脚本（如 `verify.mjs`、`verify-library.mjs`、`verify-teams.mjs`、`verify-assessments.mjs`、`verify-report.mjs`、`verify-memory.mjs`、`verify-messages.mjs`、`verify-cycles.mjs`、`verify-cycle-review.mjs`、`verify-cycle-reports.mjs`；涉及真实 DeepSeek 调用时再跑 `verify-ai.mjs` / `verify-cycle-ai.mjs`）。
3. **跨 Agent 评审**：重大改动交由另一模型只读 `git diff` 与任务单验收条件做独立审查。
