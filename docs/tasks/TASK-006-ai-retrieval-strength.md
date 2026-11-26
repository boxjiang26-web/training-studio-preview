# 任务单：AI 编排动作库智能检索与结构化力量输出升级

- **任务编号**：`TASK-006`
- **对应阶段**：Phase 1
- **前置依赖**：`TASK-002`、`TASK-003`
- **当前负责人（Agent）**：Antigravity
- **状态**：已完成

---

## 1. 目标与范围

- **实现内容**：
  - 新增 `exercise-retriever.mjs`：`selectCandidateExercises` 基于目标、训练记忆、肌群、器械、无器械约束、近期动作延续与教练自定义动作，对全部 648 条目录 + 自定义动作智能打分筛选 Top 68 候选并附带肌群/器械元数据，彻底替代 `i % 17 === 0` 机械抽样；同时导出 `searchExercises` 供后续 AI 副驾驶复用；
  - 升级 `ai-week.mjs` 与 `cycles.mjs`：注入历史场次 `volumeKg` 与 `e1rms` 上下文（严格保持姓名脱敏与防 Prompt 注入），复用 `strength.mjs` 校验结构化可选字段（`load`、`loadUnit`、`targetRpe`、`restSec`、`tempo`、`cue`）；
  - 升级 `ai-week.tsx`：AI 周草稿审核区支持完整力量处方字段编辑；
  - 同步更新 `Dockerfile` 与 `verify-ai-retrieval.mjs`，纳入 `verify-all.mjs`。

## 2. 验收标准（Definition of Done）

- [x] 动作检索器对下肢/杠铃、居家无器械、自定义动作与近期动作延续召回准确
- [x] `npm.cmd run typecheck`、`npm.cmd run build` 与 `npm.cmd run verify:all`（11 套脚本）全量通过
