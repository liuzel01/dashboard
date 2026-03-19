# 新增线路菜单（Line Onboarding）开发说明

本文档用于说明菜单 **“新增线路”** 的页面流程、后端 API、配置项和关键状态字段，方便后续开发人员或 AI Agent 快速接手。

## 1. 功能目标

- 将“新增线路”从人工散乱操作收敛为可执行向导。
- 核心是步骤化编排：
  - 选择目标租户并确认一级域名
  - 生成并确认线路子域名
  - 自动创建/复用 DCDN 域名
  - 自动配置 HTTPS / WebSocket / WAF
  - 输出 Ingress 与 SQL 指令
  - 通过外部 `/api/lines` 做验收

## 2. 页面与代码位置

- 前端页面：`eks-dashboard-frontend/src/pages/LineOnboardingPage.tsx`
- 前端 API：`eks-dashboard-frontend/src/services/api.ts`
- 后端控制器：`eks-dashboard-backend/src/lines/lines.controller.ts`
- 后端服务：`eks-dashboard-backend/src/lines/lines.service.ts`
- 后端 DTO：
  - `eks-dashboard-backend/src/lines/dto/provision-dcdn-domain.dto.ts`
  - `eks-dashboard-backend/src/lines/dto/get-dcdn-domain-status.dto.ts`
  - `eks-dashboard-backend/src/lines/dto/apply-dcdn-security.dto.ts`
  - `eks-dashboard-backend/src/lines/dto/list-cas-certificates.dto.ts`
- 设计稿：`dashboard.pen`（`Page/LineOnboarding`）

## 3. 向导流程（前端）

### 步骤1：选择目标租户 + 录入一级域名

- 页面会按“左上角当前环境”自动加载租户列表（下拉选择）。
- 页面保留域名与证书购买链接：
  - `https://www.aimi.com.cn/`
  - `https://www.aimi.com.cn/ssl-buy?certId=24`
- 用户确认一级域名（如 `sample.com`）后，进入步骤2。
- 步骤6的 SQL 会自动使用步骤1选中的 `tenant_id`。

### 步骤2：生成并确认子域名

- 生成规则：随机前缀（12~20位十六进制）+ 步骤1域名。
- 示例：`f0c15ebd6dc50f8.sample.com`。

### 步骤3：DCDN 与安全配置（重点）

- 分两段：
  - `1) 创建/复用 DCDN 域名`
  - `2) 配置 HTTPS/WebSocket/WAF`
- “刷新域名状态”只依赖已确认子域名，可单独用于查看域名当前状态。

#### 步骤3-1 创建/复用 DCDN

- 依赖输入：
  - 子域名（步骤2）
  - 源站域名（用户输入）
- 创建参数：
  - 类型：源站域名
  - 端口：443
  - 优先级：主
  - 权重：10
  - 加速区域：global

#### 步骤3-2 HTTPS/WebSocket/WAF

- 证书来源支持：
  - `CAS（推荐）`：上传到 CAS，再绑定到 DCDN（云盾 SSL 证书中心）
  - `直传（备用）`：直接上传证书私钥到 DCDN
- CAS 模式下支持两种子模式：
  - `复用已有 CAS 证书`：按根域名 + 当前目标子域名查询可覆盖证书
  - `上传新证书到 CAS`：手工上传 `cert.crt` + `privkey.key`
- 配置结果会回写到步骤3状态区（HTTPS/WebSocket/WAF、证书字段等）。

### 步骤4：Ingress 手工应用

- 页面仅输出命令，人工执行：
  - `cp ...`
  - `kubectl apply -f ...`

### 步骤5：超级后台登记 + 联通性检查

- 大管理端地址来源：
  - 在“环境管理”中为每个环境维护 `super_admin_url`
  - 步骤5根据左上角当前环境自动展示并可跳转
- 联通性检查地址：
  - `https://{子域名}/pro/p/symbol/list`

### 步骤6：输出 SQL（人工执行）

- tenant_id 自动来源于步骤1的目标租户。
- SQL 模板：
  - `INSERT INTO tenant_domain (tenant_id, domian, status, created_time) VALUES ({步骤1租户ID}, '{步骤2子域名}', 1, NOW());`

### 步骤7：外部 API 验收

- 调用外部系统接口（非本系统）：
  - `http://172.31.29.3:3000/api/lines`

## 4. 相关 API 清单

### 4.1 本系统 API（供页面调用）

- `GET /api/environments/{id}/tenants`
  - 获取当前环境租户列表（步骤1租户下拉）
- `GET /api/environments/config/{id}`
  - 获取当前环境配置（步骤5展示 super admin URL）
- `POST /api/lines/dcdn/provision`
  - 创建或复用 DCDN 域名
- `GET /api/lines/dcdn/status?domainName=...`
  - 刷新 DCDN 状态快照
- `POST /api/lines/dcdn/security/apply`
  - 应用 HTTPS / WebSocket / WAF，支持 `certSource: cas | upload`
- `GET /api/lines/dcdn/cas-certificates?rootDomain=...&targetDomain=...`
  - 查询“可覆盖当前目标子域名”的 CAS 证书（精确匹配或泛域名匹配）

### 4.2 外部系统 API（验收）

- `GET /api/lines/external/check?lineUrl=...`
  - 后端代理调用外部 `LINE_VERIFY_API_URL`，检查线路是否已出现在外部系统中

## 5. 环境变量（后端）

参考：`eks-dashboard-backend/.env-example`

- DCDN
  - `DCDN_ENDPOINT`
  - `ALIYUN_ACCESS_KEY_ID`
  - `ALIYUN_ACCESS_KEY_SECRET`
- 证书与 CAS
  - `DCDN_CERT_SOURCE`（默认 `cas`）
  - `DCDN_CERT_REGION`（默认 `ap-southeast-1`）
  - `CAS_ENDPOINT`（默认 `https://cas.ap-southeast-1.aliyuncs.com`）
  - `CAS_API_VERSION`（默认 `2020-04-07`）
- WAF
  - `DCDN_WAF_CLIENT_IP_TAG`（可选）
- 外部线路验收接口
  - `LINE_VERIFY_API_URL`

## 6. 状态字段说明（步骤3展示）

- `domainStatus`
  - DCDN 域名状态（如 `online`, `configuring`）
- `cnameCheckStatus`
  - CNAME 检测状态：`0=已配置`，非 `0` 通常表示“等待配置/校验中”
- `cnameCheckErrMsg`
  - CNAME 检测说明
- `httpsEnabled / websocketEnabled / wafEnabled`
  - 安全开关状态
- `certName / certRegion / certDomainName / certExpireTime`
  - 当前绑定证书信息
- `certStatus`
  - 若云端未显式返回，后端会在 `HTTPS=on 且证书名存在` 时派生为 `bound`

## 7. 已知注意点

- WebSocket 与 WAF 在部分场景可能互斥，后端会返回 warning，需以实际业务验证为准。
- DCDN 与 DNS 状态存在传播延迟，步骤3建议多次刷新观察。
- 步骤6仍是“输出 SQL + 手工执行”，尚未做数据库直连执行。

## 8. 推荐调试顺序

1. 步骤1先选择目标租户并确认一级域名
2. 步骤2确认线路子域名
3. 步骤3先创建/复用 DCDN，再配置 HTTPS/WebSocket/WAF
4. 刷新域名状态，确认 CNAME / 证书 / 安全状态
5. 继续步骤4~7完成验收
