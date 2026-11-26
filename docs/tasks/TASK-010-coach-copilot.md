# 任务单：受控工具调用型体育 AI 副驾驶（Coach Copilot）

- **任务编号**：`TASK-010`
- **对应阶段**：Phase 3
- **当前负责人（Agent）**：Antigravity
- **状态**：已完成

---

## 1. 实现摘要
- **新增 `coach-copilot.mjs`**：提供 `POST /api/coach/copilot`（仅教练 403 隔离），集成 4 个可审计受控工具（`get_student_summary`、`search_exercises`、`save_day_draft`、`add_memory_candidate`），支持 DeepSeek Function Calling 多轮工具循环与离线确定性本地工具模式；严格执行学员姓名脱敏、防 Prompt 注入，且严禁覆盖已反馈训练日、严禁直接发布计划。
- **新增 `coach-copilot.tsx`**：教练侧栏「AI 教练副驾驶」对话框，内置快捷指令芯片、每轮工具调用追踪（`toolTrace`）、写入草稿后自动刷新主工作区周历与日计划编辑区供教练审核发布。
- **验收**：新增 `verify-copilot.mjs` 覆盖全部 4 个工具单测与端到端 UI/草稿护栏实测，纳入 `verify-all.mjs`，全量 15 套回归 100% 通过。
