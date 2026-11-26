# 任务单：晨起状态（Readiness）监控与团队异常预警

- **任务编号**：`TASK-008`
- **对应阶段**：Phase 3
- **当前负责人（Agent）**：Antigravity
- **状态**：已完成

---

## 1. 实现摘要
- **新增 `readiness.mjs`**：定义 `readiness` 表与 `readiness_day` 索引（SQLite 与 PostgreSQL 同步），支持 1–5 分制四维打卡（睡眠质量、精力恢复、肌肉轻松度、训练状态）+ 可选备注，自动计算综合分（1.0–5.0）与偏低预警判定（综合分 ≤ 2.5 或任一核心维度 ≤ 1）。
- **API 与看板融合**：`server-core.mjs` 路由 `GET/POST /api/readiness`（严格隔离学员权限，禁止教练代填）；`coach-tools.mjs` `/api/coach/overview` 同步聚合当日状态偏低预警与学员今日状态分。
- **前端组件**：新增 `readiness-panel.tsx`（学员手机端折叠式晨起状态打卡与近 5 日记录、教练侧栏学员 7 日状态监控回读）。
- **验收**：新增 `verify-readiness.mjs` 并纳入 `verify-all.mjs`，全量 13 套回归 100% 通过。
