# 任务单：可切换生产级身份认证与学员邀请链接

- **任务编号**：`TASK-009`
- **对应阶段**：Phase 3
- **当前负责人（Agent）**：Antigravity
- **状态**：已完成

---

## 1. 实现摘要
- **新增 `auth.mjs`**：
  - 未配置 `COACH_PASSWORD` 时保持默认零摩擦试验模式（完全兼容开发期与全部自动化回归）；
  - 配置 `COACH_PASSWORD` 后自动启用正式认证模式：禁用 `/api/trial`（除非显式设置 `ALLOW_TRIAL_AUTH=1`），自动跳过 `preview-access.mjs` 的 Basic Auth 弹窗；
  - 支持 `GET /api/auth/mode`、`POST /api/auth/login`（常数时间口令比对 + 14 天 `HttpOnly; SameSite=Lax` Cookie）、`POST /api/auth/redeem`（校验 `students.invite` SHA-256 哈希与 7 天过期时间 + 下发 30 天学员 `HttpOnly` Cookie）、`POST /api/auth/logout`；
  - 教练端提供 `POST /api/coach/student/invite`（生成/重置 7 天专属邀请链接，自动作废旧链接）与 `POST /api/coach/student/revoke`（清除邀请并即时吊销该学员所有设备会话）。
- **验收**：新增自启隔离实例实测脚本 `verify-auth.mjs` 并纳入 `verify-all.mjs`，全部通过。
