# 任务单：个人训练报告与周期复盘容量/1RM 趋势升级

- **任务编号**：`TASK-004`
- **对应阶段**：Phase 1
- **前置依赖**：`TASK-002`
- **当前负责人（Agent）**：Antigravity
- **状态**：已完成

---

## 1. 目标与范围

- **要解决的问题**：个人训练报告与周期复盘/报告此前仅展示完成组数占比、平均 RPE 与测评成绩，缺少力量训练核心指标「总容量（吨位 kg）」与「动作预估 1RM」进展。
- **包含范围（In Scope）**：
  - `coach-tools.mjs` `/api/coach/personal-report` 结合 `feedback.set_logs` 与 `strength.mjs` 返回 `totalVolumeKg`、每场 `volumeKg` 与按动作分组的 `e1rmSeries`；
  - `personal-report.tsx` 预览与导出 PDF 新增区间总容量、每场容量、动作预估 1RM 较上次变化表，以及「场次总容量 (kg)」与各动作「预估 1RM (kg)」趋势图；
  - `cycle-review.mjs`、`cycle-review.tsx` 与 `cycle-reports.tsx` 每周汇总新增周总容量（kg）、较上周容量变化（`volumeDeltaPct`）及本周最高预估 1RM（`topE1rms`）；
  - 扩充 `verify-report.mjs` 与 `verify-phase0.mjs` 验收新口径，历史无 `set_logs` 记录保持 100% 兼容。

## 2. 验收标准（Definition of Done）

- [x] `npm.cmd run typecheck` 与 `npm.cmd run build` 通过
- [x] 历史无 `set_logs` 记录的旧反馈不报错且正常展示为 `—`
- [x] `npm.cmd run verify:all` 全量 9 套脚本通过

---

## 3. 交接记录

### 验证输出
- `npm.cmd run typecheck`：Exit 0
- `npm.cmd run build`：Exit 0
- `npm.cmd run verify:all`：Exit 0（`verify-phase0.mjs` 验证周总容量 `+10%` 与 Epley 1RM；`verify-report.mjs` 验证 `3075 kg` 区间总容量、`+5.8 kg` 预估 1RM 变化与 4 张趋势图）。
