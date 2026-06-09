# Dashboard 资产管理模块设计方案（轻量 CMDB）

## 1. TL;DR

本模块定位为现有 Dashboard 中的 **资产管理 / 轻量 CMDB 模块**，用于结构化记录工作中常见的运维资产信息：

- 云账号：例如阿里云账号、其他云平台账号
- CDN / DCDN / ESA 服务资源
- 域名资产
- 域名与环境、租户、业务用途之间的关系
- 其他工作账号及其使用环境
- 凭证索引：只记录凭证在哪里，不保存密码、AK/SK、私钥等敏感明文

当前阶段目标不是做完整 CMDB，也不是做自动监控系统，更不是多人协作资产平台，而是先给管理员 `admin` 提供一个可用的轻量资产台账：**资产信息结构化、可查询、可维护，排查时能快速知道域名/账号/环境/租户关系**。

---

## 2. 背景与问题

当前工作中有一些信息需要长期维护和查询，例如：

- 有哪些阿里云账号？
- 每个阿里云账号里部署了哪些 ESA、DCDN、CDN 等服务？
- 阿里云账号下有哪些域名？
- 域名是否在用？
- 域名是否备案？备案主体是什么？
- 域名给哪个环境使用？例如开发、测试、生产、hashdev、hash、vlink1、vlink2 等
- 域名给哪个租户使用？例如 mini、icoin、teb、vlink 等
- 除阿里云以外，还有哪些 DCDN/CDN/域名/第三方服务账号？
- 这些账号分别对应什么使用场景、环境和负责人？
- 密码、AccessKey、私钥等凭证应该去哪里查？

如果只用 Lark 云文档记录，短期方便，但长期容易出现以下问题：

- 结构化不足，难以筛选和查询
- 字段不统一，数据容易失真
- 关系表达困难，例如账号、资源、域名、环境、租户之间的关系
- 现阶段主要由管理员维护，不需要先解决多人协作权限模型
- 变更记录和审计能力弱
- 后续难以扩展自动同步、到期提醒、域名解析检查等能力

因此建议在现有 Dashboard 中新增一个独立的 **资产管理模块**，作为轻量 CMDB 使用。

---

## 3. 模块定位

### 3.1 产品定位

模块名称建议：

```text
资产管理
```

技术定位：

```text
轻量 CMDB / 运维资产台账 / 基础资产 Source of Truth
```

核心链路：

```text
账号 → 服务资源（ESA/DCDN/CDN）→ 域名 → 环境 / 租户 → 业务用途 / 负责人
```

### 3.2 不做什么

当前阶段不做以下能力：

- 多人协作使用模型
- 只读用户 / 运维编辑 / 管理员多角色体系
- 批量导入 / 批量导出
- 域名到期提醒
- 证书监控
- 域名解析自动同步
- 阿里云 API 自动同步
- DCDN / ESA 自动拉取
- 自动巡检
- 密钥托管
- 审批流
- 复杂拓扑图

这些能力可以作为后续阶段扩展，但不进入当前 MVP。

### 3.3 要做什么

当前阶段重点做：

- 仅面向管理员账号 `admin` 使用
- 新增资产管理菜单，并通过菜单权限控制入口
- 权限模式参考现有 `menu:cert-study`：管理员可在权限配置中手动勾选菜单权限
- 结构化记录资产信息
- 支持人工录入、编辑、查询
- 建立账号、服务资源、域名、环境、租户之间的关系
- 支持基础筛选和搜索
- 支持凭证索引，但不保存敏感明文
- 支持变更记录和操作留痕
- 暂不做导入导出，避免扩大 MVP 范围

---

## 4. 信息架构

### 4.1 推荐菜单结构

建议作为一级菜单：

```text
资产管理
  ├── 资产总览
  ├── 账号管理
  ├── 服务资源
  ├── 域名管理
  ├── 凭证索引
  └── 变更记录
```

如果当前 Dashboard 菜单不适合新增一级菜单，也可以短期放在：

```text
系统管理
  └── 资产管理
      ├── 账号管理
      ├── 服务资源
      ├── 域名管理
      ├── 凭证索引
      └── 变更记录
```

长期建议升级为一级菜单，因为资产管理属于运维核心业务数据，不只是系统配置。

当前阶段建议新增菜单权限 key：

```text
menu:asset-management
```

实现方式参考现有 `menu:cert-study`：

- 后台权限表增加菜单权限点
- 管理员可在权限配置中手动勾选
- 前端路由使用现有 `ProtectedRoute` / 菜单权限机制控制入口
- 后端资产管理 API 同步校验该权限或管理员身份
- 当前只要求 `admin` 能用，不要求普通用户或多人协作可用


---

## 5. 核心对象模型

### 5.1 核心对象

第一版建议抽象为以下对象：

| 对象 | 说明 |
|---|---|
| Account / 账号资产 | 阿里云账号、DCDN/CDN账号、域名注册商账号、其他工作账号 |
| CloudResource / 服务资源 | ESA、DCDN、CDN、DNS、WAF、OSS、SLB 等服务资源 |
| Domain / 域名资产 | 域名、子域名、备案、DNS、CDN、用途、环境、租户 |
| CredentialRef / 凭证索引 | 凭证存放位置，不存敏感明文 |
| ChangeLog / 变更记录 | 资产新增、修改、状态变更、删除等记录；当前阶段不记录导入导出 |

### 5.2 后续可扩展对象

后续可以扩展：

| 对象 | 说明 |
|---|---|
| Environment / 环境 | dev、test、prod、hashdev、hash、vlink1、vlink2 等 |
| Tenant / 租户 | mini、icoin、teb、vlink 等 |
| AssetRelation / 通用资产关系 | 用于表达复杂资产依赖关系 |
| Tag / 标签 | 用于灵活分类 |
| Attachment / 附件 | 用于保存截图、说明文档、合同等链接或附件 |

---

## 6. 数据模型设计

> 以下为 MVP 级别表结构建议，具体字段类型可根据现有 Dashboard 技术栈调整。

---

### 6.1 账号资产表：asset_accounts

用于记录阿里云账号、DCDN 服务商账号、域名注册商账号、其他工作账号。

#### 字段建议

| 字段 | 说明 |
|---|---|
| id | 主键 |
| account_name | 账号名称 |
| account_type | 账号类型 |
| provider | 服务商，例如 aliyun、cloudflare、tencent_cloud |
| login_url | 登录地址 |
| account_identifier | 账号标识，例如邮箱、手机号、主账号 ID |
| owner | 负责人 |
| department | 所属部门 / 团队 |
| usage_scope | 使用范围说明 |
| environment_scope | 使用环境范围 |
| credential_ref_id | 关联凭证索引 |
| mfa_enabled | 是否开启 MFA |
| status | 状态 |
| remark | 备注 |
| created_by | 创建人 |
| updated_by | 更新人 |
| created_at | 创建时间 |
| updated_at | 更新时间 |

#### account_type 建议枚举

```text
cloud_provider      云平台账号，例如阿里云、AWS、腾讯云
cdn_provider        CDN / DCDN / ESA 服务商账号
domain_registrar    域名注册商账号
monitoring          监控系统账号
devops              Jenkins / GitLab / Rancher 等
database            数据库管理账号
third_party         第三方服务账号
other               其他
```

#### status 建议枚举

```text
active      在用
standby     备用
disabled    已停用
unknown     未确认
```

---

### 6.2 服务资源表：asset_resources

用于记录阿里云账号下的 ESA、DCDN、CDN，以及其他服务商下的类似资源。

#### 字段建议

| 字段 | 说明 |
|---|---|
| id | 主键 |
| resource_name | 资源名称 |
| resource_type | 资源类型，例如 ESA、DCDN、CDN |
| provider | 服务商 |
| account_id | 所属账号 ID |
| resource_identifier | 资源 ID / 实例 ID / 配置 ID |
| console_url | 控制台链接 |
| environment | 使用环境 |
| tenant | 租户 |
| business | 所属业务 |
| usage_desc | 用途说明 |
| owner | 负责人 |
| status | 状态 |
| remark | 备注 |
| created_by | 创建人 |
| updated_by | 更新人 |
| created_at | 创建时间 |
| updated_at | 更新时间 |

#### resource_type 建议枚举

```text
esa
dcdn
cdn
dns
domain
waf
oss
slb
ecs
rds
redis
mongodb
kafka
other
```

---

### 6.3 域名资产表：asset_domains

用于记录域名、用途、备案、所属账号、关联资源、环境、租户。

#### 字段建议

| 字段 | 说明 |
|---|---|
| id | 主键 |
| domain | 域名，例如 api.example.com |
| root_domain | 根域名，例如 example.com |
| provider | 域名注册商 / 管理服务商 |
| account_id | 所属账号 ID |
| resource_id | 关联的 ESA / DCDN / CDN 资源 ID |
| icp_status | 备案状态 |
| icp_entity | 备案主体 |
| dns_provider | DNS 服务商 |
| cdn_provider | CDN / DCDN / ESA 服务商 |
| environment | 使用环境 |
| tenant | 租户 |
| business | 所属业务 |
| usage_desc | 用途说明 |
| owner | 负责人 |
| status | 状态 |
| remark | 备注 |
| created_by | 创建人 |
| updated_by | 更新人 |
| created_at | 创建时间 |
| updated_at | 更新时间 |

#### domain status 建议枚举

```text
active        在用
standby       备用
migrating     迁移中
unused        未使用
deprecated    废弃
unknown       未确认
```

#### icp_status 建议枚举

```text
filed         已备案
not_filed     未备案
not_required  不需要备案
unknown       未确认
```

---

### 6.4 凭证索引表：credential_refs

用于记录凭证在哪里，但不保存敏感明文。

#### 重要原则

不要在普通资产管理模块里保存以下明文：

- 登录密码
- AccessKey Secret
- API Token
- SSH 私钥
- 证书私钥
- MFA recovery code
- 数据库密码

只保存凭证索引，例如：

- 1Password 条目名
- Bitwarden 条目名
- 内部密钥系统路径
- Lark 文档位置
- 本地密钥文件路径
- 谁有权限访问

#### 字段建议

| 字段 | 说明 |
|---|---|
| id | 主键 |
| ref_name | 凭证名称 |
| ref_type | 凭证类型 |
| storage_type | 存储位置类型 |
| storage_path | 存储路径 / 条目名 |
| related_account_id | 关联账号 ID |
| visibility_level | 可见级别 |
| owner | 负责人 |
| remark | 备注 |
| created_by | 创建人 |
| updated_by | 更新人 |
| created_at | 创建时间 |
| updated_at | 更新时间 |

#### ref_type 建议枚举

```text
password
access_key
ssh_key
api_token
certificate
private_key
mfa_recovery
other
```

#### storage_type 建议枚举

```text
1password
bitwarden
lark_doc
local_file
kms
vault
manual
other
```

---

### 6.5 变更记录表：asset_change_logs

用于记录资产新增、编辑、删除、状态变化等行为。当前阶段不做导入导出，因此不记录导入/导出日志。

#### 字段建议

| 字段 | 说明 |
|---|---|
| id | 主键 |
| asset_type | 资产类型 |
| asset_id | 资产 ID |
| action | 操作类型 |
| before_data | 修改前数据，JSON |
| after_data | 修改后数据，JSON |
| operator | 操作人 |
| remark | 备注 |
| created_at | 操作时间 |

#### action 建议枚举

```text
create
update
status_change
delete
restore
import
export
```

---

## 7. 关系设计

### 7.1 MVP 推荐关系

第一版建议使用字段直连，不要一开始就做过度抽象的关系表。

核心关系：

```text
asset_accounts.id → asset_resources.account_id
asset_accounts.id → asset_domains.account_id
asset_resources.id → asset_domains.resource_id
asset_accounts.id → credential_refs.related_account_id
```

也就是：

```text
账号 → 服务资源 → 域名
账号 → 域名
账号 → 凭证索引
```

域名上直接记录：

```text
environment
tenant
business
usage_desc
owner
```

这样查询和录入都比较直观。

### 7.2 后续可扩展为通用关系表

如果后续发现一个域名对应多个资源、多个环境、多个租户，或者需要做拓扑图，可以增加：

```text
asset_relations
```

字段：

| 字段 | 说明 |
|---|---|
| id | 主键 |
| source_type | 源资产类型 |
| source_id | 源资产 ID |
| relation_type | 关系类型 |
| target_type | 目标资产类型 |
| target_id | 目标资产 ID |
| remark | 备注 |
| created_at | 创建时间 |
| updated_at | 更新时间 |

relation_type 示例：

```text
owns
manages
serves
uses
belongs_to
depends_on
deployed_in
used_by
```

示例：

```text
account:aliyun-main owns resource:dcdn-001
resource:dcdn-001 serves domain:api.example.com
domain:api.example.com used_by environment:hashdev
domain:api.example.com used_by tenant:mini
```

---

## 8. 页面设计

### 8.1 资产总览页

展示统计卡片：

- 账号总数
- 域名总数
- ESA / DCDN / CDN 资源数
- 在用域名数
- 未确认域名数
- 废弃域名数
- 未设置负责人的资产数

展示列表：

- 最近变更记录
- 最近新增资产
- 待确认资产

---

### 8.2 账号管理页

#### 列表字段

- 账号名称
- 类型
- 服务商
- 账号标识
- 使用环境
- 负责人
- MFA 状态
- 状态
- 更新时间
- 操作

#### 筛选项

- 服务商
- 账号类型
- 环境
- 负责人
- 状态
- 是否开启 MFA

#### 详情页

- 基础信息
- 关联服务资源
- 关联域名
- 凭证索引
- 变更记录
- 备注

---

### 8.3 服务资源页

#### 列表字段

- 资源名称
- 资源类型
- 服务商
- 所属账号
- 环境
- 租户
- 负责人
- 状态
- 更新时间
- 操作

#### 筛选项

- 资源类型：ESA / DCDN / CDN / DNS / 其他
- 服务商
- 所属账号
- 环境
- 租户
- 状态
- 负责人

#### 详情页

- 基础信息
- 所属账号
- 关联域名
- 使用环境
- 租户
- 控制台入口
- 凭证索引
- 变更记录
- 备注

---

### 8.4 域名管理页

#### 列表字段

- 域名
- 业务
- 环境
- 租户
- 状态
- 备案状态
- DNS 服务商
- CDN / DCDN / ESA
- 所属账号
- 负责人
- 更新时间

#### 筛选项

- 环境
- 租户
- 业务
- 备案状态
- 状态
- DNS 服务商
- CDN 服务商
- 所属账号
- 负责人

#### 详情页

- 基础信息
- 所属业务
- 环境 / 租户
- 备案信息
- DNS / CDN / DCDN / ESA 信息
- 关联账号
- 关联服务资源
- 凭证索引
- 变更记录
- 备注

---

### 8.5 凭证索引页

该页面需要更严格的权限控制。

#### 列表字段

- 凭证名称
- 凭证类型
- 存储位置类型
- 关联账号
- 负责人
- 可见级别
- 更新时间

#### 详情页

- 凭证名称
- 凭证类型
- 存储位置类型
- 存储路径 / 条目名
- 关联账号
- 权限说明
- 负责人
- 备注

#### 权限要求

- 普通用户可看到资产存在，但不一定能看到完整凭证路径
- 运维编辑或管理员才能查看完整 storage_path
- 查看凭证索引详情建议记录操作日志

---

## 9. 权限设计

当前阶段不做多人使用，不设计只读用户、运维编辑、管理员三层角色。先采用 **admin 单人可用 + 菜单权限开关** 的方式，降低第一版复杂度。

### 9.1 当前阶段权限目标

目标：

- 仅管理员账号 `admin` 使用资产管理模块
- 管理员可在权限管理页面手动给 `admin` 勾选资产管理菜单权限
- 权限模式参考现有 `menu:cert-study`
- 不需要给普通用户、运维编辑、只读用户开放
- 不需要设计导入导出权限

建议新增权限点：

```text
menu:asset-management
```

可选：如果现有权限体系要求 API 级权限，也可以增加以下内部权限点，但当前不强制拆细：

```text
asset-management:view
asset-management:manage
```

### 9.2 前端权限控制

前端实现建议：

- 菜单项只在用户具备 `menu:asset-management` 时展示
- 页面路由使用现有 `ProtectedRoute` 权限机制保护
- 如果用户没有权限，显示无权限页面或跳回首页
- 当前只保证 `admin` 勾选权限后可访问

### 9.3 后端权限控制

后端实现建议：

- 所有 `/api/assets/**` 接口都要求登录
- 额外校验当前用户是否为 `admin` 或是否具备 `menu:asset-management`
- 当前阶段不拆分 read/edit/export/import 等细粒度权限
- 删除建议仍使用软删除，避免误删数据

### 9.4 后续可扩展权限点

等模块需要多人使用时，再拆分：

```text
asset:view
asset:create
asset:update
asset:delete
credential_ref:view
credential_ref:edit
asset_change_log:view
```

导入导出相关权限暂不规划到当前阶段，后续确有需要时再加：

```text
asset:import
asset:export
```

---

## 10. 安全设计原则

### 10.1 不保存敏感明文

不建议在该模块中保存：

- 阿里云登录密码
- AccessKey Secret
- API Token
- SSH 私钥
- 证书私钥
- 数据库密码
- MFA recovery code

### 10.2 只保存凭证索引

可以保存：

- 凭证名称
- 凭证类型
- 凭证存放系统
- 凭证条目名 / 路径
- 谁有权限访问
- 关联账号
- 备注

### 10.3 操作留痕

以下操作建议记录日志：

- 新增资产
- 修改资产
- 删除 / 恢复资产
- 查看凭证索引详情
- 修改凭证索引

---

## 11. 查询场景

### 11.1 看到一个域名，想知道它是干嘛的

输入：

```text
api.example.com
```

期望返回：

- 业务
- 环境
- 租户
- 用途
- 所属账号
- 关联 DCDN / ESA
- 负责人
- 状态
- 备注

---

### 11.2 要下线一个租户，想看它用了哪些域名

筛选：

```text
租户 = mini
```

期望返回：

- 域名列表
- DCDN / ESA 资源
- 所属账号
- 负责人
- 状态

---

### 11.3 要交接一个阿里云账号

进入账号详情页，查看：

- 账号基础信息
- 关联 ESA
- 关联 DCDN
- 关联域名
- 关联环境
- 凭证索引
- 负责人
- 备注
- 变更记录

---

### 11.4 要排查某个环境有哪些外部入口

筛选：

```text
环境 = hashdev
资源类型 = DCDN / ESA / 域名
```

期望返回：

- 全部域名
- 对应 DCDN / ESA
- 对应账号
- 用途
- 负责人

---

## 12. API 草案

可根据现有 Dashboard 后端风格调整。

```text
GET    /api/assets/overview

GET    /api/assets/accounts
POST   /api/assets/accounts
GET    /api/assets/accounts/:id
PUT    /api/assets/accounts/:id
DELETE /api/assets/accounts/:id

GET    /api/assets/resources
POST   /api/assets/resources
GET    /api/assets/resources/:id
PUT    /api/assets/resources/:id
DELETE /api/assets/resources/:id

GET    /api/assets/domains
POST   /api/assets/domains
GET    /api/assets/domains/:id
PUT    /api/assets/domains/:id
DELETE /api/assets/domains/:id

GET    /api/assets/credential-refs
POST   /api/assets/credential-refs
GET    /api/assets/credential-refs/:id
PUT    /api/assets/credential-refs/:id
DELETE /api/assets/credential-refs/:id

GET    /api/assets/change-logs
```

当前阶段不提供：

```text
POST   /api/assets/import
GET    /api/assets/export
```

删除建议使用软删除，不建议物理删除。

---

## 13. 导入导出设计

当前阶段明确不做导入导出。

原因：

- 当前目标是先给 `admin` 建立可用台账，不是一次性迁移全部历史数据
- 导入会引入字段校验、重复数据合并、失败回滚、模板维护等额外复杂度
- 导出涉及敏感字段脱敏和审计，容易扩大权限与安全范围
- 先人工录入核心资产，更容易发现字段设计是否合理

后续如确实需要，再单独设计：

- CSV / Excel 导入模板
- 重复数据识别策略
- 导入预览与确认
- 导出字段脱敏
- 导入导出操作审计
- `asset:import` / `asset:export` 权限点

---

## 14. Roadmap / 里程碑

---

### Phase 1：MVP 台账能力（admin 单人使用）

目标：先让管理员 `admin` 能在 Dashboard 内结构化记录、查询和维护资产信息。

范围：

- 新增资产管理菜单
- 新增菜单权限 `menu:asset-management`
- 权限配置中允许给 `admin` 手动勾选该菜单权限，参考 `menu:cert-study`
- 前端菜单 / 路由接入现有权限控制
- 后端 `/api/assets/**` 接口校验登录用户为 `admin` 或具备 `menu:asset-management`
- 建表：`asset_accounts`、`asset_resources`、`asset_domains`、`credential_refs`、`asset_change_logs`
- 账号管理 CRUD
- 服务资源 CRUD
- 域名管理 CRUD
- 凭证索引 CRUD，但只保存索引，不保存敏感明文
- 基础状态枚举
- 基础搜索和筛选
- 简单详情页
- 创建人、更新人、创建时间、更新时间
- 软删除 / 恢复
- 基础变更记录

不包含：

- 多人角色体系
- 只读用户 / 运维编辑权限
- 批量导入导出
- 自动同步
- 到期提醒
- 证书监控
- 域名解析监控
- 复杂权限
- 审批流

验收标准：

- `admin` 拥有 `menu:asset-management` 后可以看到资产管理菜单
- 未授权用户看不到资产管理菜单，直接访问路由/API 会被拒绝
- 能手动录入阿里云账号
- 能录入账号下的 ESA / DCDN / CDN 资源
- 能录入域名，并关联账号、资源、环境、租户、用途
- 能通过域名查到对应环境、租户、账号和负责人
- 能通过账号详情看到关联资源和域名
- 编辑/删除/恢复资产有基础变更记录
- 凭证索引只保存存放位置，不保存密码、AK/SK、私钥等明文

---

### Phase 2：数据体验与字段收敛

目标：在 admin 单人使用的前提下，把字段、页面和查询体验打磨到日常可用。

范围：

- 完善资产总览页统计
- 完善账号 / 服务资源 / 域名详情页的关联展示
- 增加常用筛选组合，例如环境、租户、账号、资源类型、状态
- 增加字段字典 / 枚举管理的最小版本
- 补充最后核验时间、待确认状态、备注规范
- 优化变更记录展示
- 优化凭证索引查看体验与提示
- 根据实际录入反馈调整字段命名和必填规则

不包含：

- 多人使用
- 批量导入导出
- 自动同步
- 复杂审批

验收标准：

- admin 能在 1-2 次筛选内定位一个域名/账号/资源
- 详情页能清晰展示账号、资源、域名、环境、租户、负责人之间的关系
- 字段枚举能覆盖当前主要环境和租户
- 待确认资产可以被筛选出来

---

### Phase 3：多人使用与权限增强（后续再做）

目标：当资产管理模块确实需要给更多人使用时，再引入多人权限模型。

范围：

- 角色权限：只读用户、运维编辑、管理员
- 敏感权限点：`credential_ref:view`、`credential_ref:edit` 等
- API 级权限拆分：view/create/update/delete
- 查看凭证索引详情留痕
- 更完整的操作审计
- 可选：删除审批或恢复机制增强

验收标准：

- 普通用户不能查看完整凭证索引路径
- 运维编辑可新增/编辑但不能删除关键资产
- 管理员可管理枚举、恢复资产、查看审计日志
- 所有敏感查看行为有记录

---

### Phase 4：导入导出与历史数据迁移（后续可选）

目标：当字段模型稳定后，再支持批量迁移历史 Lark 文档或表格数据。

范围：

- CSV / Excel 导入模板
- 导入预校验和错误报告
- 重复数据识别与合并策略
- 导入预览与人工确认
- 按筛选条件导出
- 敏感字段脱敏
- 导入导出审计
- `asset:import` / `asset:export` 权限点

验收标准：

- 可以导入一批域名和账号并正常查询
- 导入失败不会产生半成品脏数据
- 导出不包含敏感明文
- 导入导出操作有审计记录

---

### Phase 5：自动同步与校验

目标：减少人工维护成本，提高资产数据准确性。

范围：

- 阿里云账号资源自动同步，优先 ESA / DCDN / CDN / 域名相关资源
- 域名解析信息同步
- 备案状态校验，若接口或数据源可用
- 数据差异检测：系统记录 vs 云端真实资源
- 手动确认同步结果
- 同步日志

验收标准：

- 能从阿里云账号拉取 ESA / DCDN / CDN 资源列表
- 能发现云端存在但系统未记录的资源
- 能发现系统记录但云端可能不存在的资源
- 自动同步不会直接覆盖人工字段，需要人工确认
- 同步过程有日志和错误信息

---

### Phase 6：运维增强与治理能力

目标：从资产台账升级为具备治理能力的轻量 CMDB。

范围：

- 域名到期提醒
- 证书到期提醒
- 域名解析变更提醒
- DCDN / ESA 配置变更提醒
- Lark 通知
- 资产健康分
- 待确认资产清单
- 资产巡检报告
- 可选：关系拓扑图
- 可选：审批流 / 变更流程

验收标准：

- 域名或证书即将到期时能提醒负责人
- 资产长时间未核验会进入待确认清单
- 每周或每月可生成资产巡检报告
- 重要资产变更可以通知到 Lark 群
- 运维交接时可以直接从系统查看完整资产清单

---

## 15. 推荐实施顺序

建议实际开发按以下顺序推进：

1. 阅读现有 Dashboard 技术栈和权限模型，重点参考 `menu:cert-study`
2. 新增权限点 `menu:asset-management`
3. 在权限配置中支持给 `admin` 手动勾选资产管理菜单权限
4. 新增资产管理菜单和前端路由保护
5. 后端新增 `/api/assets/**` 权限校验：当前阶段仅允许 `admin` 或具备 `menu:asset-management` 的用户访问
6. 建表：asset_accounts、asset_resources、asset_domains、credential_refs、asset_change_logs
7. 先实现账号管理 CRUD
8. 再实现服务资源 CRUD
9. 再实现域名管理 CRUD
10. 做详情页关联展示
11. 实现凭证索引 CRUD，但只保存索引，不保存敏感明文
12. 增加基础变更记录
13. 根据实际录入反馈收敛字段和枚举
14. 后续再做多人权限、导入导出、环境/租户规范化和自动同步

---

## 16. 风险与注意事项

### 16.1 最大风险：敏感信息误存

不要因为方便，把密码、AccessKey Secret、私钥明文塞进普通数据库。

第一版只做凭证索引，不做密钥管理。

### 16.2 数据失真风险

人工维护的资产台账容易过期，因此需要：

- 更新时间
- 更新人
- 最后核验时间，后续可加
- 待确认状态
- 变更记录

### 16.3 模型过度设计风险

不要第一版就做完整 CMDB、复杂关系图、自动同步和审批流。

正确路线：

```text
先 admin 单人 CRUD → 再字段/体验收敛 → 再多人权限 → 再导入导出 → 再自动同步 → 再治理能力
```

### 16.4 权限范围扩大风险

当前阶段不需要多人使用，最大的权限风险不是“拆得不够细”，而是过早开放给太多人。

建议第一版坚持：

- 仅 `admin` 使用
- 通过 `menu:asset-management` 控制入口
- 后端 API 同步做权限校验，不只依赖前端菜单隐藏
- 不做导入导出，避免敏感字段被批量带出
- 凭证索引只保存位置，不保存敏感明文

等确实需要多人协作时，再补只读用户、运维编辑、管理员等角色。

---

## 17. 最终建议

该模块应作为现有 Dashboard 的独立模块开发，定位为：

```text
资产管理模块：用于记录账号、云服务、DCDN/ESA、域名、环境、租户之间关系的轻量 CMDB。
```

第一版核心目标：

```text
让管理员 `admin` 能快速查清楚：某个账号有什么资源，某个域名属于哪个环境/租户/业务，谁负责，凭证在哪里。
```

推荐 MVP 菜单：

```text
资产管理
  ├── 资产总览
  ├── 账号管理
  ├── 服务资源
  ├── 域名管理
  ├── 凭证索引
  └── 变更记录
```

推荐第一版数据表：

```text
asset_accounts
asset_resources
asset_domains
credential_refs
asset_change_logs
```

后续再逐步扩展：

```text
字段/体验收敛 → 多人权限 → 导入导出 → 环境/租户规范化 → 自动同步 → 到期提醒 → 巡检治理
```
