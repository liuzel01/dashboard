# Pencil + Codex 工作流规范（EKS Dashboard）

本规范面向本仓库（前端 React + Vite + Ant Design；后端 NestJS），用于在 VS Code 里用 Pencil 产出 UI 设计，并通过 Codex 协助实现前端页面。

## 目标与原则

- `dashboard.pen` 是 UI 设计的单一事实来源。
- 设计落地优先复用 Ant Design 组件，降低自定义样式成本。
- 每个页面必须覆盖 `loading / empty / error` 三种状态。
- 设计和实现均以现有路由和页面文件为基准，避免随意新增路径。

## 关键路径与文件

- 设计文件：`dashboard.pen`
- 规范文档：`docs/pencil-codex-workflow.md`
- 前端入口：`eks-dashboard-frontend/src/App.tsx`
- 页面目录：`eks-dashboard-frontend/src/pages/`
- 组件目录：`eks-dashboard-frontend/src/components/`

## 页面清单（与路由保持一致）

以下页面已在 `App.tsx` 注册：

- `/environments` -> `EnvironmentManagementPage.tsx`
- `/s3-upload` -> `S3UploadPage.tsx`
- `/deployments` -> `DeploymentListPage.tsx`
- `/jump-servers` -> `WindowsJumpServerPage.tsx`
- `/data-query` -> `DataQueryPage.tsx`
- `/security-groups` -> `SecurityGroupPage.tsx`
- `/lines` -> `LineListPage.tsx`
- `/site-monitors` -> `SiteMonitorPage.tsx`
- `/` -> `Home.tsx`

## 设计文件结构约定（Pencil）

在 `dashboard.pen` 中使用以下层级约定：

- `Page/<Route>`：页面级 Frame（例如 `Page/Deployments`）
- `Section/<Name>`：页面内板块（例如 `Section/Filters`）
- `Cmp/<ComponentName>`：可复用组件（例如 `Cmp/EnvSwitcher`）
- `State/<StateName>`：状态帧（例如 `State/Loading`）

命名请与代码路径保持一致，便于 Codex 做映射与生成。

## 组件映射约定（Ant Design 优先）

Pencil 里出现以下视觉组件时，默认映射到 Ant Design：

- 表格 -> `Table`
- 表单/输入 -> `Form`, `Input`, `Select`, `DatePicker`
- 弹窗 -> `Modal`
- 消息 -> `Alert`, `Message`, `Empty`
- 布局 -> `Layout`, `Sider`, `Header`, `Content`

如需自定义组件，优先放在 `eks-dashboard-frontend/src/components/`，并在 Pencil 里用 `Cmp/` 标记。

## Codex 实施流程（建议顺序）

1. 在 Pencil 中完成页面框架与关键状态。
2. 用 Codex 读取 `dashboard.pen`，生成/更新对应页面文件。
3. 手工或用 Codex 补齐 API 绑定与业务逻辑（保持与现有 services 一致）。
4. 统一调整 `App.css`/`index.css` 的全局样式（避免页面内过多内联样式）。

## 交付规范（Review Checklist）

- 页面结构与 `dashboard.pen` 命名对齐。
- 组件尽量复用 Ant Design。
- `loading / empty / error` 三态都有 UI 兜底。
- 新增组件放 `src/components`，页面保持可读性。
- 新增样式集中在 `App.css` 或页面同名 CSS 文件。

## 建议的协作方式（Pencil + Codex）

- 用 Codex 进行“结构/布局/组件”生成。
- 由人或 Codex 进行“样式微调/交互状态/数据绑定”。
- 每次变更锁定一个页面，避免跨页面混改。
