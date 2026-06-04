# MR2525 方案模板库 — Agent 指南

本文件供 AI coding agent 读取项目级约定。详细架构见 `architecture.md`，协作流程见 `docs/WORKFLOW.md`。

## 技术栈

- **后端**：Node.js 18+、Express、SQLite（WAL）、原生 JS
- **前端**：无构建步骤的 SPA（`public/index.html` + `app.js` + `styles.css`）
- **部署**：本地 / 局域网 / Docker / NAS；数据目录可放在 Nutstore 同步盘

## 开发约定

- 修改后端代码后需重启服务（默认端口 3847）
- 已发布模板除标签外不可改；须先下架再编辑
- 领域术语与状态机以 `docs/WORKFLOW.md` 和 `architecture.md` 为准

## Agent skills

### Issue tracker

GitHub Issues on `raintea223-art/Parti-MR2525`（via `gh` CLI）。See `docs/agents/issue-tracker.md`.

### Triage labels

Default mattpocock vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout; `CONTEXT.md` and `docs/adr/` created lazily by `/grill-with-docs`. See `docs/agents/domain.md`.
