# Dashboard 资产管理账号维度域名同步方案 v1（siteconf 凭证池过渡版）

> 日期：2026-07-02  
> 项目：`dashboard`  
> 范围：`eks-dashboard-frontend` / `eks-dashboard-backend`  
> 目标：在不引入额外安全存储的前提下，基于现有“资产管理”模块，支持**按账号维度**读取 siteconf 中维护的 AK/SK，并同步该账号下的 DCDN / ESA / CDN 域名到资产域名表。

---

## 1. TL;DR

本方案建议：

1. **不新增一级菜单，不推翻现有“资产管理”信息架构**。
2. **保留 siteconf 作为本期凭证实体存储位置**，但不把多账号 AK/SK 直接硬编码到同步逻辑中。
3. **以 `asset_accounts` 为账号主数据，以 `credential_refs` 为映射层，以 `siteconf` 为凭证池**，建立“账号 -> 凭证引用 -> siteconf key -> provider client -> 域名同步”的闭环。
4. **把“按账号同步域名”挂到“账号管理”作为主入口**；“域名管理”作为结果页；现有“CDN同步”保留为调试/过渡入口，不再承担最终业务主入口职责。
5. 一期优先支持：
   - 多个阿里云账号
   - 按账号预览 DCDN 域名
   - Dry Run 同步预检
   - 正式同步到 `asset_domains`
   - 域名展示来源账号、来源 provider、最近同步结果
6. ESA 保持二期接入，不阻塞一期落地。

一句话总结：

> **这一版不是做“全局 DCDN 同步页面增强”，而是把现有资产管理升级成“账号驱动的域名发现与同步”系统。**

---

## 2. 背景与现状

## 2.1 当前业务诉求

当前存在多个阿里云账号，且多个账号下分别管理 DCDN / ESA / 其他服务中的域名。希望在 Dashboard 的“资产管理”模块内：

- 从“账号”维度查看资产
- 通过账号对应的 AK/SK 主动拉取当前生效域名
- 将域名与环境、租户、业务、负责人建立关系
- 在**同一个菜单体系**内完成查看、同步、下钻、编辑，减少用户跳转和理解成本

核心诉求不是“新增一个同步菜单”，而是：

> **围绕账号看它有哪些服务、哪些域名，并能把外部实际数据同步回资产台账。**

---

## 2.2 当前项目已有能力（已读代码确认）

当前项目已经具备以下基础：

### 资产管理基础数据模型

已有数据表：

- `asset_accounts`
- `asset_resources`
- `asset_domains`
- `credential_refs`
- `asset_change_logs`

### 资产管理前端结构

已有菜单与页面：

- 资产总览
- 账号管理
- 服务资源
- 域名管理
- 凭证索引
- CDN同步
- 变更记录

当前交互模式：

- 单菜单内分 tab/子页
- 通用表格 + Drawer 编辑
- 变更记录已可追溯

### 域名同步基础逻辑

当前后端已存在：

- 网宿 CDN 域名预览 / 同步
- 阿里云 DCDN 域名预览 / 同步
- ESA 占位逻辑（尚未正式接入）

当前同步逻辑已具备：

- 预览
- Dry Run
- 正式同步
- 基于域名的 upsert
- provider conflict 防护
- 变更日志记录

### 当前不足

当前的同步能力**不是按账号维度**，而是按“系统全局配置”维度，即：

- 读取 siteconf 中的一套全局 AK/SK
- 面向 provider 发起统一同步
- 无法选择账号
- 无法体现多个阿里云账号的差异
- 无法回答“这个域名是从哪个账号发现的”

所以现有“CDN同步”页：

- 适合验证 provider API 是否可用
- 适合单账号/单凭证场景
- **不适合作为多账号资产同步的最终主入口**

---

## 3. 本方案的设计目标

本期方案目标：

1. 支持**多个阿里云账号**并行管理。
2. 支持将每个账号与一套 siteconf 中的 AK/SK 建立**显式映射关系**。
3. 支持在“账号管理”页中直接：
   - 预览该账号下域名
   - Dry Run 同步
   - 正式同步
   - 查看已同步域名
4. 域名管理页可展示：
   - 来源账号
   - 来源 provider
   - 最近同步时间/结果
   - 环境归属
5. 保持现有“资产管理”菜单心智稳定，不新增复杂菜单分叉。
6. 给后续二期留出扩展空间：
   - ESA 接入
   - 多 provider 适配器
   - 更规范的来源表 / 同步任务表
   - 更安全的 secret store 迁移

---

## 4. 非目标（本期不做）

本期明确不做：

- 引入 Vault / KMS / 外部 secret store
- 改造为完整的多租户 CMDB 平台
- 大规模批量导入导出
- 自动定时同步调度系统
- 域名生命周期监控 / 到期提醒
- DNS / SSL / 解析健康自动校验
- 多套凭证轮换编排
- ESA 的完整站点到域名映射闭环
- 通用图谱化资产关系系统

---

## 5. 总体设计

## 5.1 核心原则

### 原则 1：账号主数据与凭证实体分离

- `asset_accounts` 管账号的业务信息
- `credential_refs` 管账号与凭证位置的引用关系
- `siteconf` 管真正的 AK/SK 值

不要把 AK/SK 直接保存进资产表。

### 原则 2：显式映射，禁止隐式命名拼接

不采用这类脆弱方式：

- 根据 `account_name` 动态拼 siteconf key
- 根据 provider 默认 key 猜应该用哪个账号凭证

而是：

- 账号记录明确绑定一个 `credential_ref_id`
- `credential_refs.storage_path` 明确指向 siteconf key 前缀

### 原则 3：同步入口放在“账号管理”

因为用户真正关心的是：

- 我有哪些账号？
- 这个账号下有哪些域名？
- 同步结果怎样？

而不是：

- 当前某个 provider 的全局同步接口是否可调用

### 原则 4：域名管理是最终结果视图

所有同步结果仍落到 `asset_domains`，并在该页提供：

- 过滤
- 查看详情
- 编辑补充环境/业务信息
- 回溯来源

### 原则 5：siteconf 只做“凭证池”，不做账号主数据源

siteconf 只存：

- access_key_id
- access_key_secret
- endpoint / region / enabled 等该凭证相关配置

不要在 siteconf 里维护“账号有哪些”“账号是谁负责”这类业务主数据。

---

## 5.2 建议的核心链路

```text
资产账号（asset_accounts）
  -> 绑定凭证引用（credential_refs）
    -> 指向 siteconf 凭证池 key 前缀
      -> 凭证解析器读取 AK/SK
        -> provider adapter 调用阿里云 DCDN / ESA API
          -> 生成域名预览结果
            -> Dry Run 差异分析
              -> 正式 upsert 到 asset_domains
                -> 写入 asset_change_logs / 同步日志
```

---

## 6. 数据结构设计

## 6.1 沿用现有表，不推翻现有资产模型

### 现有表继续使用

- `asset_accounts`
- `asset_resources`
- `asset_domains`
- `credential_refs`
- `asset_change_logs`

本期原则：

> **优先在现有表上做增量补充，不重建新模型。**

---

## 6.2 `asset_accounts` 建议约束

建议将可同步账号约定为：

- `provider = aliyun` / `wangsu` / 其他 provider code
- `account_type = cloud_provider` 或 `cdn_provider`
- `status = active` 时允许同步
- `account_identifier` 必填，且业务上唯一
- `credential_ref_id` 必填（对于可同步账号）

### 建议新增或强化规则

#### 字段规则

- `account_identifier`：建议必填
- `provider + account_identifier`：建议唯一
- `credential_ref_id`：同步型账号建议必填

#### 建议新增字段（可选）

如果希望更直观，可新增：

- `sync_enabled`：是否允许同步（`tinyint(1)`）
- `sync_provider_type`：例如 `aliyun_dcdn` / `aliyun_esa` / `wangsu_cdn`

但本期也可以先不加，通过：

- `provider`
- `account_type`
- `status`

先完成功能。

---

## 6.3 `credential_refs` 作为映射层

建议本期强化其语义：

- `storage_type = siteconf`
- `storage_path = siteconf key 前缀`
- `related_account_id = asset_accounts.id`

### 建议约定

一个可同步账号，一期内只绑定一个主凭证引用：

```text
asset_accounts.credential_ref_id -> credential_refs.id
```

### 示例

#### asset_accounts

- `id = 101`
- `account_name = aliyun-prod-main`
- `provider = aliyun`
- `account_type = cloud_provider`
- `account_identifier = aliyun_prod_main`
- `credential_ref_id = 9001`

#### credential_refs

- `id = 9001`
- `ref_name = 阿里云主账号AK`
- `storage_type = siteconf`
- `storage_path = asset.credentials.aliyun_prod_main`
- `related_account_id = 101`

#### siteconf

- `asset.credentials.aliyun_prod_main.access_key_id = xxx`
- `asset.credentials.aliyun_prod_main.access_key_secret = yyy`
- `asset.credentials.aliyun_prod_main.region_id = cn-hangzhou`
- `asset.credentials.aliyun_prod_main.enabled = true`

---

## 6.4 `siteconf` 凭证池命名规范

## 6.4.1 命名目标

siteconf 中的凭证池 key 必须满足：

- 可预测
- 可审查
- 不依赖中文名
- 不依赖可变展示名
- 能稳定映射一个账号

## 6.4.2 推荐命名

统一采用：

```text
asset.credentials.<account_identifier>.<field>
```

例如：

```text
asset.credentials.aliyun_prod_main.access_key_id
asset.credentials.aliyun_prod_main.access_key_secret
asset.credentials.aliyun_prod_main.region_id
asset.credentials.aliyun_prod_main.enabled
asset.credentials.aliyun_prod_main.endpoint
```

其中：

- `<account_identifier>` 来源于 `asset_accounts.account_identifier`
- 必须使用稳定英文标识，不使用中文名

## 6.4.3 字段建议

### 阿里云 DCDN 一期建议字段

- `access_key_id`
- `access_key_secret`
- `region_id`（可默认 `cn-hangzhou`）
- `endpoint`（可默认 `dcdn.aliyuncs.com` 或 SDK 默认）
- `enabled`（可选）

### ESA 二期可预留字段

- `access_key_id`
- `access_key_secret`
- `region_id`
- `endpoint`
- `enabled`

### 网宿可独立使用自身字段集

---

## 6.5 域名表建议补充字段

当前 `asset_domains` 已有：

- `domain`
- `root_domain`
- `provider`
- `account_id`
- `resource_id`
- `dns_provider`
- `cdn_provider`
- `environment`
- `tenant`
- `business`
- `owner`
- `status`
- `remark`

这些已经能承接第一版同步结果。

### 建议一期新增字段（推荐）

如果允许增量扩表，建议补：

- `source_provider`：外部发现来源，例如 `aliyun_dcdn`
- `source_account_identifier`：来源账号标识
- `last_synced_at`：最后同步时间
- `sync_status`：最近同步结果，例 `success` / `conflict` / `error`

### 若本期不愿扩表

可先过渡为：

- `account_id` 标记来源账号
- `cdn_provider` 标记当前 CDN 来源
- `remark` 记录部分外部元数据

但这只是可用，不够优雅。

### 风险提醒

如果所有外部信息都塞进 `remark`：

- 搜索困难
- 结构不稳定
- 后续 ESA / 多来源接入会变脏

所以建议至少新增：

- `last_synced_at`
- `source_provider`

这两个字段很值。

---

## 6.6 可选新增同步日志表（推荐，但不强制）

建议新增：

```text
asset_sync_runs
```

用于记录每次账号同步执行结果。

### 建议字段

- `id`
- `account_id`
- `provider`
- `sync_type`（preview / dry_run / sync）
- `status`（success / partial / failed）
- `total`
- `created_count`
- `updated_count`
- `unchanged_count`
- `conflict_count`
- `error_message`
- `operator`
- `started_at`
- `finished_at`

### 为什么建议加

因为 `asset_change_logs` 更偏资产级别变更，不适合完整表达：

- 某次同步跑了多少条
- 失败原因是什么
- 是 preview 还是 dry run
- 是否被中途取消

如果本期想控范围，也可以二选一：

- 先只记录 `asset_change_logs`
- 或先在后端 response 中返回 summary，不入库

但从“防走偏”和“后续开发不返工”角度，我建议 **一期就加简单版 `asset_sync_runs`**。

---

## 7. 页面与交互设计

## 7.1 总体信息架构

本期不新增一级菜单，保持：

```text
资产管理
  ├── 资产总览
  ├── 账号管理          <- 主入口
  ├── 服务资源          <- 中间层，可逐步增强
  ├── 域名管理          <- 结果页
  ├── 凭证索引          <- 映射配置入口
  ├── CDN同步           <- 保留为调试/兼容入口
  └── 变更记录
```

### 主入口定义

- **主入口：账号管理**
- **结果页：域名管理**
- **辅助页：凭证索引**
- **调试页：CDN同步**

---

## 7.2 账号管理页增强

### 当前账号管理页保留能力

- 查询
- 新增
- 编辑
- 删除/恢复

### 一期新增行内动作

建议每行账号新增：

- `绑定凭证`
- `预览域名`
- `Dry Run`
- `同步域名`
- `查看域名`
- `详情`

### 行为说明

#### 绑定凭证

打开弹窗 / Drawer：

- 展示当前绑定的 `credential_ref`
- 可选择已有凭证索引
- 可快速新建凭证索引
- 新建时：
  - `storage_type` 默认 `siteconf`
  - `storage_path` 自动建议为 `asset.credentials.<account_identifier>`

#### 预览域名

打开 Drawer / Modal：

- 拉取该账号下当前可发现域名列表
- 展示：域名、状态、cname、domainId、修改时间等
- 不落库

#### Dry Run

执行预检：

- 返回将新增/更新/跳过/冲突的结果
- 展示 summary
- 不写 `asset_domains`

#### 同步域名

正式执行：

- upsert 到 `asset_domains`
- 写同步日志 / 变更日志
- 完成后可快捷跳转到域名管理并带上账号过滤

#### 查看域名

跳转到域名管理并自动带过滤条件：

- `account_id`
- `provider`

#### 详情

展示该账号：

- 基础信息
- 绑定凭证引用
- 最近同步记录
- 已同步域名数
- 可选：服务资源数

---

## 7.3 域名管理页增强

### 一期建议新增列

- 来源账号
- 来源 provider
- 最近同步时间
- 最近同步状态

### 一期建议新增动作

- `详情`
- `编辑`
- `查看来源`
- `查看历史`

### 详情 Drawer 建议展示

#### 基础信息

- 域名
- 根域名
- 当前状态
- 备案状态
- DNS provider
- CDN provider

#### 归属信息

- 所属账号
- 所属环境
- 租户
- 业务
- 负责人

#### 同步来源

- source_provider
- source_account_identifier
- 外部 domainId / siteId
- 最近同步时间
- 最近同步摘要

#### 原始信息

- 外部 API 返回关键信息
- 不建议全文原样大量灌进 remark，可按结构化字段 + 少量 raw 摘要显示

---

## 7.4 凭证索引页增强

当前凭证索引页已有基础 CRUD。

### 建议增强点

- `storage_type = siteconf` 时，表单展示说明：
  - `storage_path` 需要填写 key 前缀，不含最终字段名
- 增加“反向查看关联账号”能力
- 增加快速跳回账号页的链接

### 是否需要单独“配置 siteconf 密钥值”按钮？

建议：**有，但不要和账号绑定动作混在同一个表单中写死。**

更合理的方式：

- 账号页做“绑定凭证引用”
- 凭证索引页做“维护 storage_path”
- siteconf 页做“维护真实 AK/SK”

这样职责更清晰：

- 账号页：业务对象
- 凭证索引：映射对象
- siteconf：值对象

如果想进一步降低用户心智，也可以在“绑定凭证”弹窗里放一个：

- `打开 siteconf 配置`
- `复制建议 key 前缀`

---

## 7.5 现有“CDN同步”页的处理建议

### 本期建议

保留，不删，但定位改为：

- 运维调试入口
- provider 连通性验证入口
- 老逻辑兼容入口

### 不建议做的事

不建议投入时间把它改造成：

- 多账号切换大页
- 账号中心化主入口
- 复杂筛选同步工作台

因为这会和“账号管理”职责冲突，后面容易重复建设。

---

## 8. 后端设计

## 8.1 新增核心能力模块

建议在 `assets` 模块内新增“账号域名同步”相关服务，避免散落在 siteconf 或独立 provider 文件里。

建议结构：

```text
src/assets/
  assets.controller.ts
  assets.service.ts
  account-sync.service.ts           // 新增：账号同步协调器
  credential-resolver.service.ts    // 新增：凭证解析器
  providers/
    aliyun-dcdn.provider.ts         // 新增或从现逻辑抽出
    aliyun-esa.provider.ts          // 二期
    wangsu-cdn.provider.ts          // 可逐步抽象
```

### 角色划分

#### `AssetsService`

- 继续负责资产 CRUD
- 继续负责域名表 upsert 通用逻辑

#### `CredentialResolverService`

负责：

- 根据 `account_id` / `credential_ref_id`
- 找到 `credential_refs`
- 校验 `storage_type`
- 从 `siteconf` 读取对应 key 前缀下 AK/SK
- 组装 provider 所需 credential object

#### `AccountSyncService`

负责：

- 校验账号是否允许同步
- 判断 provider 类型
- 调用具体 provider adapter
- 执行 preview / dryRun / sync
- 汇总 summary
- 写同步日志

#### provider adapter

负责：

- 封装具体云厂商 API
- 输出统一域名预览格式

---

## 8.2 统一的 provider 输出模型

建议统一成：

```ts
type AccountDomainPreviewItem = {
  provider: string;
  sourceType: string;               // aliyun_dcdn / aliyun_esa / wangsu_cdn
  accountId: number;
  accountIdentifier: string;
  domain: string;
  domainId?: string;
  cname?: string;
  status?: string;
  sslProtocol?: string;
  gmtCreated?: string;
  gmtModified?: string;
  raw?: Record<string, unknown>;
};
```

统一后：

- 前端表格能复用
- sync 流程能复用
- ESA 接进来时也不必重做 UI

---

## 8.3 新增接口建议

### 账号维度同步接口

#### 1）预览域名

```http
GET /api/assets/accounts/:id/domain-preview
```

查询参数：

- `sourceType=aliyun_dcdn`（可选，一期可默认）

返回：

- 当前账号下预览结果
- summary
- fetchedAt

#### 2）Dry Run

```http
POST /api/assets/accounts/:id/domain-sync/dry-run
```

请求体：

```json
{
  "sourceType": "aliyun_dcdn"
}
```

返回：

- 将新增/更新/不变/冲突的域名列表
- summary

#### 3）正式同步

```http
POST /api/assets/accounts/:id/domain-sync
```

请求体：

```json
{
  "sourceType": "aliyun_dcdn"
}
```

返回：

- 实际同步 summary
- 结果列表
- runId（如果有同步日志表）

#### 4）查看账号最近同步记录（可选）

```http
GET /api/assets/accounts/:id/sync-runs
```

---

## 8.4 凭证解析器设计

凭证解析器建议逻辑：

1. 根据 `account_id` 查 `asset_accounts`
2. 校验：
   - `provider`
   - `status`
   - `credential_ref_id`
3. 查 `credential_refs`
4. 校验：
   - `storage_type === siteconf`
   - `storage_path` 非空
5. 从 siteconf 读取：
   - `${storage_path}.access_key_id`
   - `${storage_path}.access_key_secret`
   - `${storage_path}.region_id`
   - `${storage_path}.endpoint`
   - `${storage_path}.enabled`
6. 校验必要字段完整性
7. 返回统一 credential object

### 错误类型建议

- 账号不存在
- 账号未绑定凭证
- 凭证引用不存在
- storage_type 非 `siteconf`
- siteconf key 缺失
- access_key_secret 为空
- 凭证已禁用
- provider 不支持

所有错误都要返回**可读提示**，避免用户只能看到 SDK 异常。

---

## 8.5 域名同步 upsert 规则

建议一期继续沿用当前按 `domain` 唯一的 upsert 策略。

### 建议写入策略

如果域名不存在：

- 新建 `asset_domains`
- 赋值 `account_id`
- 赋值 `cdn_provider`
- 赋值 `source_provider`
- 赋值 `last_synced_at`
- 赋值默认 `status`

如果域名已存在：

- 若来源 provider 一致：更新外部同步字段
- 若来源 provider 不一致：
  - 标记 conflict
  - 不强行覆盖核心归属字段

### 不建议覆盖的字段

外部 API 同步时，不要轻易覆盖人工维护字段：

- `environment`
- `tenant`
- `business`
- `owner`
- `usage_desc`

除非用户明确要求“外部数据优先”。

### 推荐覆盖的字段

- `account_id`（若当前为空且本次来源明确）
- `cdn_provider`
- `status`
- `remark` 中的同步摘要
- `last_synced_at`
- `source_provider`

这条很关键：

> **同步逻辑应优先补充“发现型字段”，尽量不覆盖“人工归属字段”。**

这样后续开发最不容易走偏。

---

## 8.6 同步日志与审计建议

### 最低要求

至少要记录：

- 谁发起同步
- 针对哪个账号
- 同步哪种 provider
- 结果 summary
- 失败原因

### 推荐落点

#### 方案 A：专用表 `asset_sync_runs`（推荐）

优点：

- 结构清晰
- 后续好展示
- 可按账号查历史

#### 方案 B：仅 `asset_change_logs` + remark

优点：

- 省事

缺点：

- 表意不足
- 不适合表达整次同步

建议：一期如果能多做半步，直接上 `asset_sync_runs`。

---

## 9. 前端开发计划

## 9.1 Phase 1：账号主入口成型（必须做）

### 目标

让用户能在“账号管理”里完成：

- 绑定凭证
- 预览域名
- Dry Run
- 同步
- 查看结果

### 前端任务

1. 账号管理表格新增操作按钮
2. 新增“绑定凭证”弹窗 / Drawer
3. 新增“域名预览”弹窗 / Drawer
4. 新增同步结果提示和 summary 展示
5. 新增“查看域名”跳转联动

### 验收标准

- 同一页面可完成账号到同步动作发起
- 不需要进入旧“CDN同步”菜单才能操作
- 用户能明确知道当前操作的是哪个账号

---

## 9.2 Phase 2：域名管理结果页增强（必须做）

### 目标

让用户同步完成后，在域名管理页看到明确结果。

### 前端任务

1. 域名管理新增来源列
2. 域名管理新增最近同步列
3. 域名详情 Drawer 新增来源信息区域
4. 支持按账号/来源 provider 过滤

### 验收标准

- 可按账号快速找到同步回来的域名
- 可区分是阿里云 DCDN 还是其他来源

---

## 9.3 Phase 3：凭证映射体验优化（推荐）

### 目标

减少凭证绑定走错。

### 前端任务

1. 在账号页“绑定凭证”时自动建议 `storage_path`
2. 增加 siteconf key 前缀 copy 按钮
3. 增加未绑定凭证的醒目提示
4. 对未配置 AK/SK 的账号禁用同步按钮或给出前置校验弹窗

---

## 10. 后端开发计划

## 10.1 Phase 1：凭证解析与账号同步接口（必须做）

### 任务

1. 新增凭证解析器
2. 新增账号维度预览接口
3. 新增 Dry Run 接口
4. 新增正式同步接口
5. 抽离/复用现有 DCDN 同步逻辑

### 验收标准

- 不依赖全局 siteconf key 也能按账号同步
- 同一 provider 下多个账号可独立执行
- 错误提示可读

---

## 10.2 Phase 2：同步落库策略完善（必须做）

### 任务

1. 明确 upsert 字段白名单
2. 明确 conflict 行为
3. 增加来源字段 / 最后同步字段
4. 写入变更日志
5. 写入同步运行日志（推荐）

### 验收标准

- 同步不会误覆盖人工维护字段
- 可追溯每次同步动作

---

## 10.3 Phase 3：siteconf 默认项与校验（推荐）

### 任务

1. 在 siteconf defaults 中补充说明性配置
2. 增加 key 命名校验文档
3. 对敏感项继续保持脱敏展示

### 注意

这期不一定要把每个账号密钥 seed 到 defaults；更多是补充：

- `asset.credentials.*` 约定文档
- provider 默认 endpoint / timeout 等系统级配置

---

## 11. 建议的实施顺序

## 11.1 推荐执行顺序

### 第一步：先定约束，不急着写同步

先定清楚：

- `account_identifier` 规范
- `storage_path` 规范
- 哪些字段允许同步覆盖
- 哪些字段只允许人工维护

这一步是防止后面走偏的关键。

### 第二步：做账号 -> 凭证 -> siteconf 的闭环

优先打通：

- 账号绑定凭证
- 凭证能解析到 siteconf
- 可以做最小连通性校验

### 第三步：接入阿里云 DCDN 账号维度 preview/dry-run/sync

先支持一个 provider，把框架搭稳。

### 第四步：域名管理页补结果视图

让同步结果可见、可验证、可回查。

### 第五步：再决定 ESA 接入和旧 CDN同步 页收缩策略

---

## 11.2 一期建议拆分

### P0（必须）

- `account_identifier` 规范化
- `credential_ref_id` 绑定链路
- siteconf 命名规范
- 阿里云 DCDN 账号维度 preview / dry-run / sync
- 账号页按钮
- 域名页来源展示

### P1（强烈建议）

- `asset_sync_runs`
- `last_synced_at`
- `source_provider`
- 账号详情 Drawer
- 绑定凭证体验优化

### P2（后置）

- ESA 接入
- 网宿按账号同步重构
- 服务资源联动下钻
- 多标签环境字段

---

## 12. 完成链路（端到端）

本节用于确保开发、联调、验收不会走偏。

## 12.1 配置链路

1. 管理员在账号管理新增/编辑一个账号
2. 填写：
   - `provider=aliyun`
   - `account_type=cloud_provider`
   - `account_identifier=aliyun_prod_main`
3. 在凭证索引中创建 / 绑定：
   - `storage_type=siteconf`
   - `storage_path=asset.credentials.aliyun_prod_main`
4. 在 siteconf 中维护：
   - `asset.credentials.aliyun_prod_main.access_key_id`
   - `asset.credentials.aliyun_prod_main.access_key_secret`

### 通过标准

- 账号能找到凭证引用
- 凭证引用能解析到 siteconf key
- siteconf key 完整存在

---

## 12.2 预览链路

1. 用户进入账号管理
2. 点击某账号“预览域名”
3. 后端：
   - 查账号
   - 查凭证引用
   - 查 siteconf
   - 创建阿里云 DCDN client
   - 拉取域名列表
4. 前端 Drawer 显示预览结果

### 通过标准

- 用户知道当前预览的是哪个账号
- 不落库
- 错误可读

---

## 12.3 Dry Run 链路

1. 用户点击“Dry Run”
2. 后端拉取域名并与 `asset_domains` 比较
3. 返回：
   - 新增多少
   - 更新多少
   - 冲突多少
   - 不变多少
4. 前端展示 summary + 列表

### 通过标准

- 不改库
- 差异结果正确
- 冲突可识别

---

## 12.4 正式同步链路

1. 用户点击“同步域名”
2. 后端执行 upsert
3. 写域名表、写变更日志、写同步日志
4. 前端收到 summary
5. 用户点击“查看域名”进入域名管理查看结果

### 通过标准

- 同步结果可复查
- 不误覆盖环境/租户/负责人等人工字段
- 同步后的域名能按账号找到

---

## 12.5 结果校验链路

同步完成后，验收者应能在域名管理页验证：

- 域名数量符合预期
- 来源账号正确
- provider 正确
- 最近同步时间正确
- 历史变更可回查
- 人工维护的环境/租户字段未被误覆盖

---

## 13. 防走偏约束（非常关键）

以下约束用于保证开发过程中不跑偏。

## 13.1 不要把“旧 CDN同步 页面升级”为主方案

这是最容易走偏的点。

正确方向：

- 账号管理是主入口
- 域名管理是结果页
- CDN同步是兼容/调试页

---

## 13.2 不要把 AK/SK 直接写入 `asset_accounts`

即便本期仍用 siteconf，也不要偷懒把密钥直接进资产表。

否则后面迁移 secret store 成本会陡增。

---

## 13.3 不要通过 `account_name` 猜 siteconf key

必须用稳定的：

- `account_identifier`
- `credential_ref_id`
- `storage_path`

形成显式映射。

---

## 13.4 不要让同步覆盖人工治理字段

同步逻辑默认只覆盖“发现字段”，不覆盖“治理字段”。

### 发现字段

- `cdn_provider`
- `status`
- `source_provider`
- `last_synced_at`
- `external id / cname / ssl info`

### 治理字段

- `environment`
- `tenant`
- `business`
- `owner`
- `usage_desc`

治理字段默认以人工维护为准。

---

## 13.5 不要第一期就把 ESA 抽象复杂化

ESA 现在仍是站点维度，域名映射细节还未最终确认。

所以：

- 先把 DCDN 跑通
- adapter 模型设计成可扩展
- ESA 第二期接入

不要为了等 ESA 把一期卡住。

---

## 13.6 不要把所有外部原始数据都灌进 `remark`

`remark` 可以放摘要，不要作为唯一结构化来源字段。

至少应逐步沉淀：

- `source_provider`
- `last_synced_at`
- `external_domain_id`（如需要）

---

## 14. 风险与应对

## 14.1 风险：siteconf 中多账号密钥管理变乱

### 表现

- key 命名无规范
- 中文名/展示名频繁变更
- 无法判断哪个 key 对应哪个账号

### 应对

- 强制 `asset.credentials.<account_identifier>.*`
- `account_identifier` 一旦启用，不轻易修改
- 文档中固定规范

---

## 14.2 风险：账号与凭证绑定错误

### 表现

- 点 A 账号同步，结果拉的是 B 账号的域名

### 应对

- 绑定凭证弹窗中展示 `storage_path`
- 详情页明确显示绑定关系
- preview 先行，避免直接 sync
- 同步接口响应回显 `account_name / account_identifier`

---

## 14.3 风险：同步误覆盖人工字段

### 应对

- 白名单更新字段
- 单元测试覆盖
- Dry Run 先看差异
- 必要时在前端确认文案中强调“不覆盖环境/负责人等人工字段”

---

## 14.4 风险：阿里云 API 限流或返回不稳定

### 应对

- 账号级同步天然降低单次压力
- 增加 timeout / retry 上限
- 同步日志记录失败原因
- 不做静默失败

---

## 15. 验收标准

## 15.1 功能验收

必须满足：

1. 能创建多个阿里云账号资产
2. 每个账号能显式绑定一个 siteconf 凭证引用
3. siteconf 中能以规范 key 保存多套 AK/SK
4. 账号管理页可按账号预览域名
5. 账号管理页可按账号 Dry Run
6. 账号管理页可按账号正式同步域名
7. 域名管理页可查看来源账号和最近同步结果
8. 同步不会误覆盖环境、租户、负责人等人工字段

## 15.2 交互验收

必须满足：

1. 用户无需进入旧“CDN同步”页也能完成核心同步操作
2. 同步动作始终明确“当前操作的是哪个账号”
3. 预览、Dry Run、正式同步三者区分明确
4. 结果可快速跳转到域名管理页查看

## 15.3 工程验收

必须满足：

1. 账号 -> 凭证 -> siteconf 的映射清晰
2. 后续可平滑迁移到外部 secret store
3. DCDN 一期接入完成后，ESA 二期不需要推翻模型
4. 同步逻辑可复用于其他 provider adapter

---

## 16. 建议的开发任务清单

## 16.1 后端任务

1. 补充/校验 `asset_accounts` 约束
2. 补充 `credential_refs` 绑定逻辑
3. 新增 `CredentialResolverService`
4. 新增 `AccountSyncService`
5. 抽象阿里云 DCDN provider adapter
6. 新增账号维度 preview / dry-run / sync 接口
7. 域名 upsert 增加来源字段和同步字段
8. 增加同步日志表或最小日志能力
9. 增加必要 SQL migration
10. 增加单元/集成测试

## 16.2 前端任务

1. 账号管理页新增行内动作
2. 绑定凭证弹窗 / Drawer
3. 预览域名弹窗 / Drawer
4. Dry Run summary 展示
5. 正式同步确认交互
6. 域名管理新增来源列与过滤
7. 域名详情 Drawer 增强
8. 凭证索引页补充说明与联动入口

## 16.3 文档任务

1. 更新资产管理设计文档
2. 更新 siteconf 开发计划文档（补充凭证池约定）
3. 增加联调与验收 checklist

---

## 17. 最终建议

如果只给一个建议，我的结论是：

> **本期应明确采用“asset_accounts + credential_refs + siteconf 凭证池”的过渡方案，并把“账号管理”作为域名同步主入口。**

这是当前约束下最稳的路径，因为它：

- 不引入新的安全基础设施
- 能支持多阿里云账号
- 能复用现有资产管理与 DCDN 同步基础能力
- 不会把后续 secret store 迁移路径堵死
- 最符合“同一菜单内下钻账号、服务、域名”的产品心智

---

## 18. 后续建议（可选）

建议在本方案评审通过后，继续补两份小文档：

1. **前后端任务拆解清单**
2. **联调验收 checklist**

这样可以把“方案正确”进一步转成“执行不跑偏”。
