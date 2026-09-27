# Dashboard 运维系统 UI 蒸馏与升级开发计划

> 状态：已确认的开发计划；本文件只定义设计与实施方向，尚未修改运行时代码。  
> 范围：`eks-dashboard-frontend` 的应用壳、通用 UI 基础设施和高频运维页面。  
> 参考来源：本机 `/Users/liuzelin/gitlab/web-admin-new` 的 `prod` 分支（检查时 HEAD 为 `e17e382`）。  
> UI 范围事实来源：`eks-dashboard-frontend/src/App.tsx` 的实际注册路由和权限菜单；`dashboard.pen` 仅为待同步的设计镜像。具体协作规范见 [Pencil + Codex 工作流](./pencil-codex-workflow.md)。

## Phase 0 执行记录（2026-09-27）

### 已完成的基线确认

- 已以 `eks-dashboard-frontend/src/App.tsx` 而非 `.pen` 盘点真实 UI：当前有 **37 个 Route**（含登录、SSO、403、重定向和兜底路由），菜单按云资源、资产管理、线路管理、监控与告警、运维工具、系统管理、证书题库、Signal Monitor 等业务域和权限动态生成。
- 已确认 `dashboard.pen` 仅有 **12 个页面帧**：`Environments`、`S3Upload`、`Deployments`、`WindowsJumpServers`、`DataQuery`、`SecurityGroups`、`Lines`、`SiteMonitors`、`Home`、`AccessControl`、`Login`、`LineOnboarding`。它未覆盖当前高价值试点中的 Oncall、资产管理和 Signal Monitor，也未覆盖 SiteConf、KMS、管理端 Ingress 等路由，不能作为当前实现依据。
- 已确认当前应用壳已具备权限过滤菜单、环境切换、身份信息和侧栏折叠；环境选择写入 `currentEnvironmentId` 并驱动 API 环境上下文，故 UI 重构不得缓存或覆盖旧环境上下文。
- 已确认样式基线问题：`index.css` 仍存在 Vite 初始项目的 `color-scheme`、深色背景、`body` 居中和通用 button 规则；`App.tsx` 的壳层存在较多内联布局/颜色配置。这两项是 Phase 1 的明确改造目标，不在本阶段更改。
- 已完成状态词典草案，见下表；它只标准化展示语义，不修改任何后端枚举或处置流程。

### 状态词典（展示层）

| 展示语义 | 现有来源示例 | 文本要求 | 推荐视觉语义 |
| --- | --- | --- | --- |
| 健康 / 已完成 | Deployment `completed` | 显示“已完成”并保留就绪副本等证据 | success |
| 处理中 | Deployment `in_progress` / 操作 `progressing` | 显示“发布中/处理中”，不得伪装为失败 | processing |
| 受阻 | Deployment `blocked` | 显示“受阻”；提示可继续观察或按原流程回退 | warning |
| 失败 / 异常 | Deployment `failed`、通知 `FAILED` | 显示“发布异常/发送失败”及诊断入口 | error |
| 告警触发 | Oncall `FIRING` | 显示“告警中”，不能仅显示英文枚举 | error |
| 已确认 | Oncall `ACKED` | 显示“已确认”，不等同于已恢复 | warning |
| 已恢复 | Oncall `RESOLVED` | 显示“已恢复”，来源仍是 Alertmanager 状态 | success |
| 能力不支持 | 升级记录 `UNSUPPORTED` | 显示“当前能力不支持”及原因，不能降级成成功或静默隐藏 | warning |
| 未知 / 未确认 | 资产 `unknown`、监控未知态 | 显示“未知/未确认”，并提示刷新或补充信息 | default |

### 设计稿同步策略

1. `dashboard.pen` 不重绘为旧 UI 的静态副本；先补齐能支撑 Phase 1–3 实施的组件帧和试点页面帧。
2. 组件帧按 `Cmp/AppShell`、`Cmp/PageHeader`、`Cmp/FilterBar`、`Cmp/MetricCard`、`Cmp/OpsTable`、`Cmp/StatusBadge`、`Cmp/DetailDrawer`、`Cmp/RiskConfirm` 命名，并各自包含 `State/Loading`、`State/Empty`、`State/Error`（状态不适用者除外）。
3. 首批页面帧为 `Page/Deployments`（更新既有）、`Page/SiteMonitors`（更新既有）、`Page/Oncall`（新增）、`Page/AssetManagementOverview`（新增）。页面中的菜单、权限、环境和操作文字以真实代码为准。
4. `.pen` 的更新与代码实现分开提交；每次页面改造前先更新对应 Frame，每次实现后用真实页面复核 Frame，避免设计稿再次落后。

### Phase 0 结论

Phase 0 的范围确认、试点确认、状态词典和 `.pen` 同步规则已完成。`dashboard.pen` 已新增 `Phase0/UIFoundation`，其中包括八个组件帧、统一状态词典，以及 Deployments、SiteMonitors、Oncall、AssetManagementOverview 四个试点页面帧。它们是基于真实路由的实施蓝图，不取代真实代码。下一步可进入 Phase 1 的运行时代码改造。

## Phase 1 执行记录（2026-09-27）

- 已新增 `src/components/AppShell.tsx`，仅承载布局职责；路由、权限菜单构建、环境上下文、认证和业务动作仍保留在 `App.tsx`，因此没有改变既有访问控制或 API 契约。
- 已移除 `App.tsx` 应用壳中的内联布局/颜色样式，改用 `AppShell` 和 `App.css` 的响应式工作区样式：侧栏、顶栏、环境区域、身份区域、工作区和窄屏断点均有统一约定。
- 已替换 Vite 初始全局规则：不再强制深色 `color-scheme`、居中 `body`、默认大号 `h1` 或覆盖 Ant Design button；`html`、`body`、`#root` 现在按全高的浅色运维工作区运行。
- 已在 `main.tsx` 的 `ConfigProvider` 设定 Dashboard 的首批 Ant Design token，包括主色、成功/警告/错误语义色、工作区背景、圆角、字体以及深色导航菜单 token。
- 验证：`npm run build --prefix eks-dashboard-frontend` 通过；针对 `src/App.tsx` 与 `src/components/AppShell.tsx` 的 ESLint 通过；`git diff --check` 通过。全仓 `npm run lint --prefix eks-dashboard-frontend` 仍报告 163 个既有错误（主要是多处 `any`、既有 Hooks 依赖和 Fast Refresh 规则），本阶段未扩大范围修复这些非 UI 基线问题。

## Phase 2 执行记录（2026-09-27）

- 已新增 `src/components/ops/`，包含 `PageHeader`、`FilterBar`、`MetricGrid`、`StatusBadge`、`OpsTable`、`DetailDrawer`、`RiskConfirm` 和共享样式；通过 `index.ts` 作为统一导出入口。
- 组件只定义展示与交互容器：它们不调用 API、不读取或写入环境、不自行发起危险操作，也不替换各页面的权限控制、dry-run、确认或审计逻辑。
- `StatusBadge` 已落实 Phase 0 状态词典中的 completed / progressing / blocked / firing / acked / resolved / unsupported / failed / unknown 等展示映射，并允许页面传入领域专属文案。
- `OpsTable` 已提供统一的加载失败、重试入口、空态与默认横向滚动；`RiskConfirm` 固定展示目标环境、目标资源和影响说明，但仍由页面传入执行回调。
- 验证：`npm run build --prefix eks-dashboard-frontend` 通过；新增组件及 AppShell/App 的定向 ESLint 通过；`git diff --check` 通过。全仓既有 lint 错误未纳入本阶段范围。

## 1. 结论

本次采用“蒸馏设计模式、保留业务语义”的路径：借鉴 `web-admin-new` 成熟后台在页面层级、数据密集型列表、指标卡片、筛选工具栏、多任务切换方面的做法；**不**复制其商户后台业务、菜单权限模型、接口封装、路由缓存实现或主题色。

Dashboard 的目标不是视觉重皮，而是让操作者在环境明确、风险可见、操作可控、结果可追溯的前提下，更快完成日常运维任务。

## 2. 已确认的现状与可蒸馏资产

| 维度 | `web-admin-new` 已验证模式 | Dashboard 现状 | 蒸馏决定 |
| --- | --- | --- | --- |
| 应用壳 | 固定顶部栏、侧栏折叠、标签式历史工作区、页面缓存 | 有权限过滤菜单、环境切换和侧栏折叠 | 保留权限/环境能力；引入统一工作区布局。历史 Tab 单独试点，不能直接复制 KeepAlive。 |
| 页面层级 | 页面标题、筛选和操作、指标、表格/详情区分层明确 | 多数页面功能齐全，但布局、间距和卡片用法不一致 | 统一为可复用的运维页面模板。 |
| 数据列表 | `ProTable`/SchemaList 统一搜索、密度、列设置、刷新和分页边界 | 多个页面各自实现 `Table`、筛选、分页和工具栏 | 先抽取 Dashboard 自己的轻量 `OpsTable`，不在第一阶段引入 `@ant-design/pro-components`。 |
| 指标概览 | 响应式统计卡；少量卡片不拉满；支持收起 | 部分页面仅显示数字或使用样式不一致的 `Statistic` | 建立 `MetricGrid` 和状态色规范。 |
| 全局样式 | 有变量、功能色、Ant Design 覆盖层 | `index.css` 仍有 Vite 默认深色主题、居中 body、通用 button 覆盖 | Phase 1 清理冲突样式，并以 Ant Design token 为唯一主题入口。 |

## 3. 设计原则与非目标

### 3.1 设计原则

1. **环境始终可见。** 顶栏环境选择是所有环境相关页面的上下文来源；高风险动作必须在确认区再次显示目标环境。
2. **状态优先于装饰。** 健康、告警、发布中、失败、未知、已确认等状态通过统一文字、Tag、图标和辅助说明表达，不能只依赖颜色。
3. **先读后写。** 查询、概览和详情优先；重启、回退、创建、同步、ACK 等写操作与只读内容视觉分组，并保留现有确认、dry-run、审计语义。
4. **一致的密集信息体验。** 表格列、筛选区、分页、空态、加载态、错误态和详情抽屉以同一组件约定实现。
5. **Ant Design 优先。** 复用 `Layout`、`Table`、`Form`、`Card`、`Drawer`、`Descriptions`、`Steps`、`Result` 等现有依赖；只对无法表达运维语义的部分创建薄组件。
6. **渐进替换。** 一次只落地一个基础能力或一类页面；不在 UI 升级中改变 API、权限判断、环境切换、审计或实际执行逻辑。

### 3.2 非目标

- 不迁入 `web-admin-new` 的商户/资金/风控业务代码、接口、菜单配置、Tailwind、Zustand、KeepAlive 或 ProComponents 依赖。
- 不改变现有菜单权限键、路由 URL、后端 API 契约或数据库结构。
- 不将危险动作仅做成视觉优化；确认、dry-run、执行结果和审计仍由原业务模块负责。
- 不为所有页面强制加入历史 Tab；只有多任务、表单未提交或上下文切换确有收益的页面再评估。

## 4. 目标信息架构

```text
应用壳
├── Sidebar：按现有权限过滤的业务域菜单
├── Header：环境上下文 | 全局状态入口（后续） | 当前身份与退出
└── Workspace
    ├── PageHeader：标题、说明、当前环境/范围、页面级动作
    ├── FilterBar：筛选条件、查询/重置、次级动作
    ├── MetricGrid：健康、容量、风险、待处理数量等摘要
    ├── MainPanel：表格、图表或配置主体
    └── DetailDrawer / OperationPanel：详情、诊断、写操作确认与结果
```

### 4.1 页面模板分型

| 模板 | 适用页面 | 目标结构 |
| --- | --- | --- |
| 资源列表 | EKS 部署、线路总览、站点监控、安全组、资产管理 | `PageHeader → FilterBar → MetricGrid（可选）→ OpsTable → DetailDrawer` |
| 事件响应 | Oncall 告警、Signal Monitor | `PageHeader → 状态摘要 → 事件列表 → 详情/时间线 → ACK 或处置操作` |
| 向导/受控写入 | 新增线路、管理端 Ingress、监控资源申请 | `PageHeader → ContextBanner → Steps → Preview/Dry-run → RiskConfirm → Result` |
| 配置管理 | SiteConf、环境管理、KMS 配置加解密 | `PageHeader → Scope/权限说明 → 列表或表单 → 变更预览 → 审计/回显` |

## 5. 组件与样式边界

### 5.1 建议新增的前端基础组件

| 组件 | 职责 | 首批消费者 |
| --- | --- | --- |
| `AppShell` | Dashboard 的 Header、Sider、Workspace 和响应式断点 | `App.tsx` |
| `PageHeader` | 标题、说明、环境/范围、主操作和辅助操作 | 所有试点页面 |
| `FilterBar` | 标准化表单布局、查询/重置/保存筛选、窄屏换行 | 部署、站点监控、Oncall |
| `MetricGrid` / `MetricCard` | 响应式指标、趋势/说明、加载骨架 | 部署、资产、Signal、Oncall |
| `OpsTable` | Table 的密度、列为空值、水平滚动、刷新、分页和空/错态约定 | 资源列表和事件列表 |
| `StatusBadge` | `healthy / warning / critical / progressing / failed / unknown / acknowledged` 的文字、色彩、图标映射 | 全部状态型页面 |
| `DetailDrawer` | 右侧详情、诊断区、复制、关联资源和底部操作区 | 部署、站点监控、Oncall、资产 |
| `RiskConfirm` | 目标环境、影响范围、不可逆提示、确认文案和执行状态展示 | 重启、回退、Ingress 写入、KMS 操作 |

组件放在 `eks-dashboard-frontend/src/components/`；页面保留业务数据获取与领域文案，不把业务 API 调用下沉进通用组件。

### 5.2 Token 与视觉规则

- 在前端入口统一通过 Ant Design `ConfigProvider` 定义主色、圆角、字体、间距和组件 token；不再以页面内硬编码色值作为主题来源。
- 工作区使用浅中性色背景，内容以白色或弱边框面板承载；卡片之间的间距固定为 16 或 24px。
- 状态色有语义而非业务专属含义：成功/健康、注意/等待、危险/失败、处理中、未知/禁用；同一状态同时输出图标或文本。
- 标题层级固定：页面标题、区块标题、表格/抽屉标题；避免单独裸露的大号 `h1`。
- 表格的空值统一为 `--`，时间、数量、环境、资源命名遵循现有页面格式化规则，不能在 UI 升级中改写数据含义。

## 6. 分阶段实施计划

### Phase 0：基线与设计确认

1. 盘点现有全局样式、`App.tsx` 布局、各页面的 Card/Table/Form/状态实现和 1366px、1440px、1920px 下的关键截图。
2. 在 `dashboard.pen` 补齐 `AppShell`、`PageHeader`、`FilterBar`、`MetricCard`、`OpsTable`、`StatusBadge`、`DetailDrawer`、`RiskConfirm` 的组件和 `loading / empty / error` 状态帧。
3. 选择试点页面：`/deployments`、`/site-monitors`、`/oncall`、`/asset-management/overview`。
4. 确认高风险状态词典及写操作确认文案，不改变后端状态枚举。

**验收：** 设计稿和本计划中的组件命名、现有路由、权限边界一致；不产生代码改动。

### Phase 1：应用壳与样式基础

1. 移除 Vite 默认的 `color-scheme`、深色背景、`body` 居中和通用 button 覆盖，保留最小 reset。
2. 建立 Ant Design token、全局页面背景、字体、焦点态、链接和响应式工作区样式。
3. 将 `App.tsx` 的内联壳层样式迁移到 `AppShell`；保留现有菜单权限过滤、环境选择和身份退出。
4. 确保折叠侧栏、窄屏断点、长菜单名、环境加载失败和身份加载失败均有可读行为。

**验收：** 全部现有路由可访问；权限过滤与环境选择行为不变；无 Vite 默认样式泄漏；前端 build 通过。

### Phase 2：通用运维组件

1. 实现 `PageHeader`、`FilterBar`、`MetricGrid`、`StatusBadge`、`OpsTable`、`DetailDrawer` 与 `RiskConfirm`。
2. 统一加载、空数据、错误、权限不足和环境未选择状态。
3. 对写操作定义共享展示契约：目标环境、资源标识、动作、dry-run/确认状态、成功/失败及诊断入口。
4. 不引入新状态管理库；维持 React Context 和页面现有请求方式。

**验收：** 组件有最小渲染/交互测试或至少覆盖关键状态的前端测试；所有组件可在无业务 API mock 的静态状态下检查。

### Phase 3：四个高价值页面试点

1. **EKS 部署：** 统一部署健康指标、筛选与操作区；将发布诊断、镜像历史和回退收敛至详情抽屉/操作面板；保留现有发布跟踪与回退确认。
2. **站点监控：** 突出可用性、延迟、证书期限、最近失败原因；保留现有检测详情和原始诊断。
3. **Oncall 告警：** 优先展示未 ACK、高风险、升级中、已恢复数量；事件详情展示状态、时间线、标签、ACK/升级记录，不能暗化 `UNSUPPORTED` 等真实能力边界。
4. **资产总览：** 用统一指标与表格组织资源完整性、缺失负责人、凭证引用和变更记录。

**验收：** 每页覆盖 loading / empty / error / 有数据 / 无权限（适用时）状态；原 API 调用、权限、环境隔离、写操作确认与审计行为不回归。

### Phase 4：推广与历史工作区评估

1. 将已通过试点的模板推广到线路、Signal Monitor、配置中心和受控写入向导。
2. 基于真实使用确认是否需要“最近访问/历史 Tab”：若引入，限制数量、持久化范围和关闭行为，并明确表单草稿处理；禁止未经测试地保活所有页面。
3. 建立视觉回归清单，持续收敛页面内联样式和重复的 Table/Form 状态逻辑。

**验收：** 新页面默认使用通用模板；不存在因历史工作区导致的过期环境上下文、失效权限或未保存写操作误执行。

## 7. 实施顺序与文件影响

| 阶段 | 预计主要文件 | 不应触碰的边界 |
| --- | --- | --- |
| Phase 1 | `src/main.tsx`、`src/index.css`、`src/App.tsx`、`src/App.css`、`src/components/AppShell/*` | AuthContext、EnvironmentContext、路由路径、权限 key |
| Phase 2 | `src/components/{PageHeader,FilterBar,MetricGrid,StatusBadge,OpsTable,DetailDrawer,RiskConfirm}/*` | `src/services/api.ts` 的 API 契约 |
| Phase 3 | 四个试点页面及必要页面样式 | 发布跟踪、Oncall ACK、Dry-run、审计和数据格式化语义 |
| Phase 4 | 其余页面与设计稿 | 后端、数据库、生产配置，除非另行立项 |

## 8. 质量门槛与回归清单

- 每一阶段执行 `npm run build --prefix eks-dashboard-frontend`；有新增测试时执行对应测试命令。
- 验证至少 1366px、1440px 和窄屏下的导航、标题、筛选、长表格横向滚动和抽屉。
- 验证环境切换期间旧请求不会覆盖新环境视觉状态；所有危险操作确认框显示当前目标环境。
- 验证无权限菜单不展示，直接访问仍由 `ProtectedRoute` 拒绝。
- 验证 loading、empty、error、partial-data 和未知状态均不是空白页面。
- 写操作在 UI 改造前后使用同一 API、同一确认条件和同一审计路径；只允许改变呈现，不允许降低安全措施。
- 进行键盘焦点、按钮可读标签、色彩对比度和状态文本检查。

## 9. 风险与控制

| 风险 | 控制措施 |
| --- | --- |
| 直接搬运商户后台导致依赖/样式膨胀 | 仅实现模式，Phase 2 使用当前 Ant Design 依赖的薄组件。 |
| 壳层改造造成所有路由回归 | 先建 AppShell，再逐页验证；不同时重写路由、权限与数据层。 |
| 视觉优化掩盖危险操作 | `RiskConfirm` 复用现有业务确认语义；文案明确目标环境与影响。 |
| 历史 Tab 保留过期环境或权限状态 | 延后到 Phase 4，先设计状态失效规则与表单草稿策略。 |
| 页面逐个改造造成风格再分叉 | 先交付组件和 token，试点验收后再推广。 |

## 10. 下一次开发的起点

下一次实施从 **Phase 0 的视觉基线盘点与 `dashboard.pen` 组件帧** 开始；确认设计稿后进入 Phase 1。第一笔运行时代码改动应只处理应用壳和全局样式，不与任一业务页面重构混合提交。
