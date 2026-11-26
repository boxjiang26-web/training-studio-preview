# 任务单：自定义动作库与结构化专业力量处方

- **任务编号**：`TASK-002`
- **对应阶段**：Phase 1
- **分支 / Worktree**：当前工作区主线
- **当前负责人（Agent）**：Antigravity
- **状态**：已完成

---

## 1. 目标与范围

- **要解决的问题**：
  1. 当前单条训练处方仅支持 `组数 × 次数/秒`，无法表达真实力量训练所需的负重（kg / lb / %1RM / 自重）、目标 RPE、组间歇、节奏（Tempo）与动作提示；
  2. 学员反馈仅支持布尔勾框，无法记录逐组实际完成重量与次数，也无法自动统计单次训练总容量（吨位 kg）与动作预估 1RM；
  3. 动作库固定为 648 条 ReadyNex 目录 + 5 个内置动作，教练无法新增自用专项/康复动作。
- **包含范围（In Scope）**：
  - 数据库双端同步新增 `custom_exercises` 表及 `feedback.set_logs` 可空列（自动向后兼容存量 SQLite/PostgreSQL 数据）；
  - 新增共享领域模块 `strength.mjs`，统一处方校验、规范化、`lb -> kg` 折算、总容量（kg）与经典 Epley 预估 1RM（1 次取 `weightKg`，2–12 次取 `weightKg * (1 + reps / 30)`，仅统计有效负重次数组）；
  - 教练端动作库支持新建与删除自定义动作，并与 648 条目录统一搜索和加入计划；
  - 教练日计划编辑区支持完整结构化力量字段；团队模板保存与分发自动透传保留全部力量字段；
  - 学员端逐组默认预填处方重量与次数，支持修改实际重量/次数并实时展示本场总容量与各动作预估 1RM，提交后教练端完整回读；
  - 新增 `verify-strength.mjs` 回归脚本并纳入 `verify:all`，确保所有存量脚本 100% 兼容通过。
- **不包含范围（Out of Scope）**：
  - 组间倒计时器与 `localStorage` 草稿缓存（归入 Phase 2 UI 重构）；
  - 多周周期 UI 适配（归入 `TASK-003`）、个人报告/周期复盘图表升级（归入 `TASK-004`）。

## 2. 架构与接口契约

### 数据表变更（SQLite 与 PostgreSQL 同步）
- 新增表 `custom_exercises`：
  - `id TEXT PRIMARY KEY`
  - `name TEXT NOT NULL UNIQUE`
  - `category TEXT NOT NULL`（复用现有 7 个类别或 `custom`）
  - `muscles TEXT NOT NULL`（JSON 字符串数组）
  - `equipment TEXT NOT NULL`（JSON 字符串数组）
  - `notes TEXT NOT NULL DEFAULT ''`
  - `created TEXT NOT NULL`
- 扩展表 `feedback`：
  - 幂等追加可空列 `set_logs TEXT`（历史记录为 `NULL`，旧接口不传 `setLogs` 时保持原行为）。

### 结构化数据格式
- **`ExerciseItem`**（向后兼容旧记录）：
  ```ts
  {
    id?: string;
    name: string;
    sets: number;      // 1-30
    qty: number;       // 1-3600
    unit: '次' | '秒';
    load?: number | null;              // 0-2000，自重时为 null
    loadUnit?: 'kg' | 'lb' | '%1RM' | '自重';
    targetRpe?: number | null;         // 1-10，支持 0.5 步长
    restSec?: number | null;           // 0-1800 整数
    tempo?: string;                    // 最长 16 字，如 "3-1-1-0"
    cue?: string;                      // 最长 120 字，教练动作提示
  }
  ```
- **`SetLogEntry`**（逐组实际执行记录）：
  ```ts
  {
    done: boolean;
    weight?: number | null;     // 0-2000，非负重动作可为 null
    unit?: 'kg' | 'lb';         // 默认 'kg'
    reps?: number | null;       // 0-3600 整数
    rpe?: number | null;        // 可选单组 RPE 1-10
  }
  ```

### API 契约
- `GET /api/me`：响应新增 `customExercises: CustomExercise[]`（教练与学员均只读本人工作区动作元数据，方便学员查看自定义动作说明）。
- `GET /api/coach/exercises`：仅教练（403）；返回 `{ exercises: CustomExercise[] }`。
- `POST /api/coach/exercises`：仅教练（403）；请求 `{ name, category, muscles, equipment, notes }`；重名（含与目录或内置动作重名）返回 `409`；成功返回 `{ exercise }`。
- `POST /api/coach/exercises/delete`：仅教练（403）；请求 `{ id }`；不存在返回 `404`；成功返回 `{ deleted: id }`（不影响历史已发布快照中的动作名称）。
- `POST /api/draft`：校验并保留上述扩展字段，动作名允许命中内置动作、648 目录或 `custom_exercises`。
- `POST /api/feedback`：向后兼容仅传 `sets: boolean[][]`；若同时传 `setLogs`，逐项校验维度与数值合法性，自动同步 `sets` 并持久化 `set_logs`；幂等重试时同时比对 `set_logs`。
- `GET /api/day`：`feedback` 返回增加 `setLogs` 与服务端汇总 `metrics`（`totalVolumeKg`、`exercises: [{ volumeKg, bestE1rmKg }]`）。

### 涉及文件
- 新增：`strength.mjs`、`verify-strength.mjs`
- 修改：`db-sqlite.mjs`、`db-postgres.mjs`、`server-core.mjs`、`coach-tools.mjs`、`Dockerfile`、`types.ts`、`library.tsx`、`app.tsx`、`style.css`、`verify-all.mjs`

## 3. 验收标准（Definition of Done）

- [x] `npm.cmd run typecheck` 通过
- [x] `npm.cmd run build` 通过
- [x] SQLite 与 PostgreSQL 建表/迁移及 `Dockerfile` 同步（`verify-phase0.mjs` 通过）
- [x] `verify-strength.mjs` 通过（自定义动作增删、结构化处方保存/发布/模板透传、学员逐组录入实际重量/次数、kg/lb 总容量与 Epley 1RM 精确校验、移动端 390px 无横向溢出、跨学员越权 403）
- [x] `npm.cmd run verify:all` 全量回归脚本全部通过

---

## 4. 交接记录

### 实现摘要
- **新增模块**：
  - `strength.mjs`：自定义动作表结构与 CRUD、结构化力量处方校验（`load` / `loadUnit` / `targetRpe` / `restSec` / `tempo` / `cue`）、`setLogs` 校验、`lb -> kg` 折算总容量与经典 Epley 1RM（1 次取 `weightKg`，2–12 次取 `weightKg * (1 + reps / 30)`，跳过自重/秒数/未勾选组）。
  - `strength-calc.ts`：浏览器端无 Node 依赖的同口径实时容量/1RM 计算与处方标签格式化。
  - `verify-strength.mjs`：覆盖纯计算单测、自定义动作 UI 增删与 409/403 边界、结构化处方保存/发布/模板分发继承、移动端 390px 布局与逐组录入、实时与回读容量 `1420 kg` + Epley 1RM `119 kg`、幂等重试与冲突 409。
- **双库与兼容**：`db-sqlite.mjs` 与 `db-postgres.mjs` 同步新增 `custom_exercises` 及幂等追加 `feedback.set_logs` 列；`server-core.mjs` 兼容旧客户端仅传 `sets` 的提交与幂等重试；`Dockerfile` 已纳入 `strength.mjs`。
- **前端界面**：`library.tsx` 新增教练自定义动作新建/搜索/详情/删除；`app.tsx` 教练日计划支持完整力量处方字段，学员手机端支持预填处方重量/次数、逐组改写实际重量/次数并实时展示总容量与各动作预估 1RM；`coach-desk.tsx` 模板预览同步展示力量参数。

### 验证输出
- `npm.cmd run typecheck`：Exit 0（零错误）
- `npm.cmd run build`：Exit 0（`app.js 1.3mb`, `Done in 100ms`）
- `npm.cmd run verify:all`：Exit 0，全部 9 套脚本（`verify-phase0`、`verify-strength`、`verify`、`verify-library`、`verify-teams`、`verify-assessments`、`verify-report`、`verify-messages`、`verify-cycles`）在隔离 SQLite 实例上 100% 通过。

### 遗留说明与下一棒建议
- 下一棒可按依赖顺序认领 `TASK-003`（多周周期支持完整力量字段与按负重比例复用上一周）或 `TASK-004`（个人报告与周期复盘接入总容量/1RM 趋势图）。
