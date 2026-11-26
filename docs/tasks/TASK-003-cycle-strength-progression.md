# 任务单：多周训练周期力量处方与递进比例升级

- **任务编号**：`TASK-003`
- **对应阶段**：Phase 1
- **前置依赖**：`TASK-002`
- **当前负责人（Agent）**：Antigravity
- **状态**：已完成

---

## 1. 目标与范围

- **要解决的问题**：多周训练周期（`cycles.mjs`、`cycles.tsx`）此前仅支持编辑基础 `动作/组数/每组/单位`，且“复用上一周”只能按百分比调节次数或秒数，无法在周期内做渐进超负荷（如每周负重 +5% 或按目标 RPE 递增）。
- **包含范围（In Scope）**：
  - `cycles.mjs` 复用 `strength.mjs` 校验逻辑，支持自定义动作及完整结构化力量处方字段（`load`、`loadUnit`、`targetRpe`、`restSec`、`tempo`、`cue`）；
  - `coach/cycle/copy` 扩展可选参数 `scaleTarget: 'qty' | 'load'`（默认 `'qty'` 保持完全向后兼容），支持按比例缩放每组次数/时长或负重重量（按 `0.5` 步长取整，并按单位限制在合法上下界内，自重动作保持不变）；
  - `cycles.tsx` 与 `app.tsx` 接入自定义动作列表、单日动作完整力量字段编辑与“调整目标（每组次数或时长 vs 负重负荷）”选择；
  - 扩充 `verify-cycles.mjs` 覆盖自定义动作、力量处方发布到日计划及 `100 kg -> 105 kg` 按负重比例复用上一周与移动端展示。

## 2. 验收标准（Definition of Done）

- [x] `npm.cmd run typecheck` 与 `npm.cmd run build` 通过
- [x] SQLite / PostgreSQL 兼容且 `verify-cycles.mjs`、`verify:all` 全部通过

---

## 3. 交接记录

### 实现摘要
- **`cycles.mjs`**：重构为规范多行排版，引入 `normalizeExerciseItem` 校验并透传全部结构化力量字段与自定义动作；`action === 'copy'` 新增 `scaleTarget`（`'qty' | 'load'`）按 `0.5` 步长缩放负重并完整保留其他字段；`action === 'generate'` 上下文同步透传上周已发布计划中的力量参数。
- **`cycles.tsx` & `app.tsx`**：将 `me.customExercises` 传入 `CycleDesk` 并入 `<datalist id="cycle-moves">`，补齐每日动作的力量处方编辑区（`负荷类型`、`负荷`、`目标 RPE`、`间歇(秒)`、`节奏 Tempo`、`提示备注`），并在复用上一周控件中新增 `调整目标` 选择器。
- **`verify-cycles.mjs`**：在保留原双学员回归基础上，新增自定义动作 `周期前蹲`、全套力量字段发布、第 2 周按 `load × 105%` 递进至 `105 kg` 及学员手机端完整展示验证。

### 验证输出
- `npm.cmd run typecheck`：Exit 0（零错误）
- `npm.cmd run build`：Exit 0（`app.js 1.3mb`, `Done in 105ms`）
- `npm.cmd run verify:all`：Exit 0，全量 9 套回归脚本全部通过（`verify-cycles.mjs` 输出 `PASS cycle strength fields, custom exercise, and 100 kg -> 105 kg load progression`）。
