# 新增线路：DCDN 根域名归属验证自动化开发计划

> 日期：2026-05-15  
> 范围：dashboard「新增线路」流程；仅开发计划，暂不实现。  
> 背景问题：首次将某个新根域名接入阿里云 DCDN 时，`AddDcdnDomain` 可能返回 `Owner verification of the root domain failed.`，需要在根域名 DNS 托管处添加 TXT 记录完成归属验证。

## 1. 结论先行

推荐分阶段建设：

1. **第一阶段：半自动化归属验证流程**
   - 捕获 DCDN owner verification 错误，不再直接失败。
   - 页面展示需要添加的 TXT 记录、根域名、DNS 托管商提示、操作说明。
   - 用户手动添加 TXT 后，在页面点击「我已添加，继续验证 / 重试创建」。

2. **第二阶段：抽象 DNS Provider 插件机制**
   - 为后续第三方 DNS 托管商 API 权限接入做准备。
   - 先不优先支持 Route53 一键添加 TXT。
   - 原因：lineurl 一般需要使用备案域名，实际根域名通常不托管在 Route53。

3. **第三阶段：按实际 DNS 托管商接入自动 TXT**
   - 优先接入真实 lineurl 使用的 DNS 托管商，例如阿里云云解析、腾讯云 DNSPod、Cloudflare、其他备案域名服务商。
   - 在「新增线路」流程中自动添加 TXT、轮询 DNS 生效、重试 DCDN 创建。

## 2. 当前问题说明

当新增线路域名属于一个首次接入阿里云 DCDN 的根域名时，阿里云需要确认该根域名归属权。

典型错误：

```text
Owner verification of the root domain failed., URL: https://dcdn.aliyuncs.com
```

该错误通常不是 AK 权限失效，而是：

- 当前阿里云账号尚未完成该 root domain 的归属验证；
- 新增的是一个新的备案根域名；
- DNS TXT 验证记录缺失或尚未生效；
- DCDN AK 所属阿里云账号与域名归属验证所在账号不一致。

## 3. 目标与非目标

### 3.1 目标

- 降低首次接入新 root domain 时的人工排查成本。
- 将「Owner verification failed」从技术错误转成可操作流程。
- 为后续自动调用第三方 DNS 托管商 API 添加 TXT 记录预留架构。
- 避免每次新域名失败后都需要开发/运维手动看日志、手工解释。

### 3.2 非目标

- 本阶段不实现具体自动化代码。
- 暂不优先做 Route53 一键添加 TXT。
- 不自动删除 TXT 验证记录，除非后续确认阿里云 DCDN 不再需要保留。
- 不把 DNS 托管商凭证直接写死在代码或普通文档中。

## 4. 推荐产品流程

### 4.1 正常路径

```text
用户填写新增线路
  -> dashboard 调 AddDcdnDomain
  -> 成功
  -> 获取 CNAME / 配 HTTPS / 配 WAF / 配 WebSocket / 后续流程
```

### 4.2 需要根域名归属验证路径

```text
用户填写新增线路
  -> dashboard 调 AddDcdnDomain
  -> 阿里云返回 Owner verification failed
  -> dashboard 解析出 root domain
  -> dashboard 获取或生成需要展示的验证信息
  -> 前端进入「根域名归属验证」步骤
  -> 用户手动或系统自动添加 TXT
  -> dashboard 轮询 DNS / 用户点击重试
  -> dashboard 重试 AddDcdnDomain
  -> 成功后继续新增线路后续步骤
```

### 4.3 前端展示建议

在新增线路向导中新增一个中间状态卡片：

标题：

```text
需要验证根域名归属权
```

展示字段：

- 当前线路域名：`xxx.example.com`
- 根域名：`example.com`
- DNS 记录类型：`TXT`
- 记录名：例如 `_dnsauth.example.com` / 阿里云返回的实际记录名
- 记录值：阿里云要求的 token
- DNS 托管商：未知 / 用户选择 / 系统识别
- 状态：待添加 / 等待 DNS 生效 / 验证成功 / 验证失败

按钮：

- 「复制记录名」
- 「复制记录值」
- 「我已添加，继续验证」
- 后续如支持 provider API：`一键添加 TXT`

错误提示不要直接显示原始堆栈，建议转义成：

```text
该根域名首次接入阿里云 DCDN，需要先完成域名归属验证。请在 DNS 托管处添加以下 TXT 记录，生效后点击继续。
```

## 5. 后端设计草案

### 5.1 错误识别

新增 helper：

```ts
private isDcdnOwnerVerificationError(error: any): boolean
```

识别维度：

- `error.message` 包含 `Owner verification of the root domain failed`
- `error.data.Code` / `error.code` 如阿里云返回专用 code，也纳入判断

### 5.2 API 草案

#### 5.2.1 新增线路接口返回 verification required

当前新增线路流程如果调用 DCDN 失败，不应直接抛 500，而是返回业务状态：

```json
{
  "status": "owner_verification_required",
  "domainName": "a.example.com",
  "rootDomain": "example.com",
  "dnsRecord": {
    "type": "TXT",
    "name": "_dnsauth.example.com",
    "value": "aliyun-site-verification=xxxx"
  },
  "autoDnsSupported": false,
  "message": "该根域名首次接入阿里云 DCDN，需要完成 TXT 归属验证。"
}
```

> 注：具体 TXT 记录名和值需确认阿里云 DCDN 是否有查询/生成接口；如果 `AddDcdnDomain` 错误响应里不包含，需要调研阿里云相关 API 或控制台行为。

#### 5.2.2 查询验证状态

```http
GET /api/lines/domain-ownership-verification/status?rootDomain=example.com
```

返回：

```json
{
  "rootDomain": "example.com",
  "status": "pending|dns_record_created|dns_propagating|verified|failed|manual_required",
  "dnsRecord": {
    "type": "TXT",
    "name": "_dnsauth.example.com",
    "value": "aliyun-site-verification=xxxx"
  },
  "lastError": null,
  "verifiedAt": null
}
```

#### 5.2.3 手动确认后重试

```http
POST /api/lines/domain-ownership-verification/retry
```

请求：

```json
{
  "domainName": "a.example.com",
  "originDomain": "origin.example.net",
  "scope": "global"
}
```

动作：

- 可选：先解析 TXT，确认记录值存在。
- 重试 `AddDcdnDomain`。
- 成功后继续原新增线路后续流程或返回可继续状态。

#### 5.2.4 后续自动 DNS Provider 接口

```http
POST /api/lines/domain-ownership-verification/dns-record/upsert
```

请求：

```json
{
  "rootDomain": "example.com",
  "provider": "alidns|dnspod|cloudflare|custom",
  "record": {
    "type": "TXT",
    "name": "_dnsauth.example.com",
    "value": "aliyun-site-verification=xxxx",
    "ttl": 60
  }
}
```

## 6. 数据模型建议

新增表：`domain_ownership_verifications`

```sql
CREATE TABLE domain_ownership_verifications (
  id BIGINT PRIMARY KEY AUTO_INCREMENT,
  root_domain VARCHAR(255) NOT NULL,
  dns_provider VARCHAR(64) DEFAULT NULL,
  verification_record_type VARCHAR(16) DEFAULT 'TXT',
  verification_record_name VARCHAR(255) DEFAULT NULL,
  verification_record_value TEXT DEFAULT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  last_error TEXT DEFAULT NULL,
  verified_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL DEFAULT UTC_TIMESTAMP(),
  updated_at DATETIME NOT NULL DEFAULT UTC_TIMESTAMP() ON UPDATE UTC_TIMESTAMP(),
  UNIQUE KEY uk_root_domain_provider (root_domain, dns_provider)
);
```

状态建议：

- `pending`：已识别需要验证，但尚未添加 TXT。
- `manual_required`：当前没有 DNS API 权限，需要用户手工添加。
- `dns_record_created`：已通过 API 添加 TXT。
- `dns_propagating`：等待 DNS 生效。
- `verified`：DCDN 已成功添加或验证通过。
- `failed`：验证失败，需要人工介入。

## 7. DNS Provider 插件化设计

定义统一接口：

```ts
type DnsProviderType = 'alidns' | 'dnspod' | 'cloudflare' | 'custom';

interface DnsTxtRecord {
  name: string;
  value: string;
  ttl?: number;
}

interface DnsProvider {
  type: DnsProviderType;
  supports(rootDomain: string): Promise<boolean>;
  upsertTxtRecord(rootDomain: string, record: DnsTxtRecord): Promise<void>;
  getTxtRecord(rootDomain: string, name: string): Promise<string[]>;
}
```

### 7.1 Provider 优先级

鉴于 lineurl 通常需要备案域名，实际 DNS 托管商大概率不是 Route53。因此优先级建议：

1. 阿里云 DNS / 云解析（如果备案域名托管在阿里云）
2. 腾讯云 DNSPod（如果备案域名在腾讯云）
3. Cloudflare（如有海外域名）
4. 自定义 provider adapter
5. Route53 暂不作为优先项，仅保留扩展可能

### 7.2 Provider 配置方式

不建议把 provider AK/SK 写入普通 `.env` 后长期扩散。推荐：

- 生产：Secrets Manager / KMS / SSM Parameter Store / 受控密钥文件。
- 本地：`.env.local` 或开发者个人环境变量。
- DB：只保存 provider 类型、root domain 映射、非敏感配置，不保存明文 secret。

示例配置概念：

```json
{
  "rootDomain": "example.com",
  "provider": "alidns",
  "credentialRef": "ssm:/dashboard/dns/alidns/example.com"
}
```

## 8. root domain 识别

不要简单取最后两段，因为存在：

- `example.co.uk`
- `example.com.cn`
- 多级公共后缀

建议引入 public suffix list 相关库，例如：

- `tldts`
- `psl`

目标：

```ts
parse('a.b.example.com.cn').domain === 'example.com.cn'
```

## 9. DNS TXT 生效检查

使用 Node DNS resolver：

```ts
import { Resolver } from 'node:dns/promises';

const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8']);
const records = await resolver.resolveTxt(recordName);
```

轮询策略：

- 间隔：10-15 秒。
- 超时：5-10 分钟。
- 页面显示倒计时和当前状态。
- 超时后允许用户稍后重试，不要丢失记录信息。

注意：

- TXT 返回值可能是二维数组。
- 同一 name 下可能有多个 TXT 值。
- 不要误删 SPF、DKIM、其他验证记录。

## 10. 安全与权限

### 10.1 权限原则

- 每个 DNS provider 使用最小权限。
- 最好限制到指定 root domain 或 hosted zone。
- 所有自动添加 TXT 的操作必须写审计日志。
- UI 上明确展示将要添加的记录名和值。

### 10.2 审计日志建议

新增审计动作：

- `lines.domainVerification.required`
- `lines.domainVerification.dnsRecordCreated`
- `lines.domainVerification.retry`
- `lines.domainVerification.verified`
- `lines.domainVerification.failed`

审计字段：

- rootDomain
- domainName
- dnsProvider
- recordName
- recordType
- 操作人
- requestId
- result

## 11. 失败场景与处理

| 场景 | 表现 | 处理建议 |
|---|---|---|
| 阿里云未返回 TXT 内容 | 只有 owner verification failed | 调研 DCDN 查询验证 token 的 API；若无 API，页面提示去控制台查看 |
| DNS provider 未配置 | 无法自动添加 | 进入 manual_required，展示复制说明 |
| TXT 已添加但未生效 | DNS 查询不到 | 轮询等待；允许稍后重试 |
| TXT 值冲突 | 同 name 已有其他 TXT | 合并 TXT 值，不覆盖 |
| Provider API 权限不足 | upsert 失败 | 展示 provider 权限错误，保留手动方案 |
| DCDN 账号与 DNS 账号不同 | DNS 添加成功但 DCDN 仍失败 | 检查是否使用正确阿里云账号完成验证 |
| public suffix 识别错误 | root domain 错误 | 使用 PSL 库并记录解析结果 |

## 12. 实施阶段拆分

### Phase 0：调研确认

- 确认阿里云 DCDN owner verification 的 TXT 记录获取方式：
  - 是否在 `AddDcdnDomain` 错误响应中返回；
  - 是否有独立 API 可查询；
  - 是否只能从控制台获取。
- 确认当前 lineurl 常见 DNS 托管商。
- 确认 DCDN 验证通过后 TXT 是否需要长期保留。

### Phase 1：半自动流程

- 捕获 `Owner verification failed`。
- 新增前端验证步骤 UI。
- 展示 root domain、TXT 记录、手工操作说明。
- 支持用户点击「我已添加，继续验证 / 重试创建」。
- 记录验证状态到 DB。

### Phase 2：DNS Provider 抽象

- 引入 root domain -> DNS provider 映射。
- 定义 `DnsProvider` interface。
- 实现 provider registry。
- 增加 provider 权限测试接口。

### Phase 3：接入真实 DNS provider

- 按实际托管商优先接入：AliDNS / DNSPod / Cloudflare / custom。
- 新增一键添加 TXT。
- 新增 DNS 生效轮询。
- 新增审计日志。

### Phase 4：体验优化

- 对已验证 root domain 做缓存，避免重复提示。
- 新增「根域名验证管理」页面。
- 支持过期/失败状态清理。
- 支持批量预验证 root domain。

## 13. 验收标准

### Phase 1 验收

- 新 root domain 首次接入 DCDN 失败时，页面不再只显示 500/原始错误。
- 页面能明确告诉用户需要添加 TXT。
- 用户添加 TXT 后可回到页面继续流程。
- 同一 root domain 验证成功后，后续子域名新增流程正常继续。

### Phase 3 验收

- 对已配置 DNS provider 的 root domain，dashboard 可自动添加 TXT。
- 自动添加动作有审计日志。
- DNS 生效后可自动重试 DCDN 创建。
- Provider API 失败时可降级到手动方案。

## 14. 暂不做 Route53 优先支持的原因

虽然项目已有 Route53 相关能力，但 lineurl 场景一般需要备案域名，实际根域名通常不会托管在 Route53。因此：

- Route53 不作为第一优先级自动化目标。
- 后续如有个别海外/非备案域名托管在 Route53，可以作为普通 DNS provider adapter 接入。
- 当前计划重点放在 provider 抽象和真实备案域名托管商接入能力上。

## 15. 后续待办建议

- [ ] 调研阿里云 DCDN TXT 验证 token 获取方式。
- [ ] 统计当前 lineurl 根域名及 DNS 托管商分布。
- [ ] 设计 `domain_ownership_verifications` 表迁移脚本。
- [ ] 设计前端新增线路向导中的「根域名归属验证」步骤。
- [ ] 确定首个自动化 DNS provider 接入对象。
