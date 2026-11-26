# 任务单：基础管理 CRUD 与纠错能力补全

- **任务编号**：`TASK-005`
- **对应阶段**：Phase 1
- **前置依赖**：`TASK-002`
- **当前负责人（Agent）**：Antigravity
- **状态**：已完成

---

## 1. 目标与范围

- **包含范围（In Scope）**：
  - **学员管理**：`POST /api/coach/student/update`（改名）、`POST /api/coach/student/archive`（软归档与恢复，`students.archived` 双库幂等迁移），历史训练记录与外键完整保留；
  - **团队管理**：`POST /api/coach/team/update`（修改名称与成员）、`POST /api/coach/team/delete`（删除团队）；
  - **模板管理**：`POST /api/coach/template/update`（重命名、用当前草稿覆盖更新动作列表）、`POST /api/coach/template/delete`（删除模板）；
  - **体能测评**：`POST /api/coach/assessments/update`（单条成绩修正）、`POST /api/coach/assessments/delete`（单条删除）；
  - **多周周期**：`POST /api/coach/cycle/delete`（事务级联删除周期及其复盘/报告/周草稿，保留日历上已发布快照与反馈）；
  - 新增 `verify-crud.mjs` 并纳入 `verify-all.mjs`。

## 2. 验收标准（Definition of Done）

- [x] SQLite 与 PostgreSQL Schema/迁移同步
- [x] `npm.cmd run typecheck`、`npm.cmd run build` 与 `npm.cmd run verify:all`（10 套脚本）全量通过

---

## 3. 交接记录

### 验证输出
- `npm.cmd run typecheck`：Exit 0
- `npm.cmd run build`：Exit 0
- `npm.cmd run verify:all`：Exit 0，全量 10 套脚本（含 `verify-crud.mjs`）100% 通过。
