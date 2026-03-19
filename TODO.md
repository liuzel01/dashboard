# TODO List

This file outlines the current development tasks for the project.

## High Priority

1. 站点监控页面分页选择器 ✅ 已完成

    - 前端：`eks-dashboard-frontend/src/pages/SiteMonitorPage.tsx`
      - Table 增加分页器配置：`defaultPageSize: 10`，`showSizeChanger: true`，`pageSizeOptions: [10,20,50,100]`，并显示总数。
      - 行为和“EKS 部署”页面一致。

2. 站点监控顶部新增 Host 模糊筛选 ✅ 已完成

    - 前端：`eks-dashboard-frontend/src/pages/SiteMonitorPage.tsx`
      - 在“添加站点/刷新/租户筛选/告警设置”同一行，新增 `Input`（占位符：按 Host筛选），支持清空。
      - 客户端本地筛选：忽略大小写，对 `host` 包含关系过滤；与租户筛选联动。
    - 备注：如后续数据量大可升级为服务端筛选（API 支持 `?host=xxx`），当前无需后端改动。

---

1. 我在翻找aws nodegroup 运行状况健康设置时，发现可以对状态码进行设置：
也就是说只要配置了成功代码的站点满足指定的成功代码，即可认为是”可用状态的“ ✅ 已完成（需执行一次 SQL 迁移）

```txt
成功代码
检查来自目标的成功响应时要使用的 HTTP 代码。您可指定多个值 (例如，“200,202”) 或一系列值 (例如，“200-299”)。
```

临时方案： 期望可以在添加站点时，可以添加一个字段： ”成功代码“，在输入框内输入指定的多个值或一系列值。同时在”详情“按钮打开的对话框中也可以对”成功代码“字段进行编辑。

实现说明：

- 配置优先级：站点级（`site_monitors.acceptable_status_codes`）> 环境级（`environment_alerts.acceptable_status_codes` 或 `environments.json` 的 `alerts.acceptable_status_codes`）> 默认 `200-399`。
- 语法：逗号分隔数字（如 `200,302,404`）与范围（如 `200-299`）。非法输入整体回退到默认。
- 后端：DTO 已新增字段；AlertsService 新增 `isAcceptableStatus`；Scheduler 与检查逻辑按“成功代码”决定是否告警和失败计数。
- 前端：添加/详情表单支持“成功代码”；告警设置弹窗支持环境级“成功代码”。
- DB：新增列 SQL：`eks-dashboard-backend/scripts/sql/2025-11-04_add-acceptable-status-codes.sql`，请执行一次。
回归建议：验证 200/302/403/404/500 行为；403/404 可通过环境级成功代码抑制告警。

---

1. 当站点返回状态为403（可能有白名单限制），404（直接访问域名并没有内容返回）这些可能认为是域名正常的状态，不应该进行lark告警。✅ 已完成

同时，lark群通知接收到的消息中： Host这里能不能域名和端口不要连着写，因为这样会在lark中形成一个可以点击的链接： <http://open.mgbx.com:443> ，点击链接有时候会跟直接访问 open.mgbx.com 的效果不一样，会导致造成困扰

实现说明：

- 抑制 403/404 告警：`eks-dashboard-backend/src/site-monitor/monitor.scheduler.ts:29` — 检查到 403/404 时跳过发送告警（仍记录状态）。
- 调整 Lark Host 展示：`eks-dashboard-backend/src/site-monitor/alerts.service.ts:24,55` — 更改为 `Host: host (HTTPS/HTTP, port 443)`，避免生成可点击链接。

可选优化（未实施）：

- 将 403/404 计入“可接受”以避免累计 `failure_count`；或引入“成功代码”统一配置后自然覆盖该场景。

---

1. 批量导入站点（多环境/多域名） ✅ 已提供脚本方案

    - 可行性：高。为避免前端上传复杂性，提供后端 Node 脚本，读取 CSV 并批量入库。
    - 使用方式：
      1) 准备 CSV 文件（UTF-8，无 BOM），示例：
         environment_id,tenant_id,name,hosts,port,is_https,notes
         hashex,1,官网,"a.hashex.vip,b.hashex.vip",443,1,主域
         hashex,2,活动站,campaign.hashex.vip,443,1,
         prod, ,门户,portal.example.com,80,0,
      2) 执行脚本（在 eks-dashboard-backend 目录）：
         `node scripts/import-sites.js ./sites.csv`
      3) 脚本会将 hosts 拆分为多行分别写入，并按 `environment_id/tenant_id` 关联。
    - 实现位置：`eks-dashboard-backend/scripts/import-sites.js`
    - 说明：
      - CSV 头字段：environment_id, tenant_id, name, hosts, port, is_https, notes
      - hosts 支持逗号或空白分隔多个域名。
      - is_https 支持 1/0/true/false。
    - 其他方案：
      - Excel：可先另存为 CSV 再导入；或后续改脚本支持 .xlsx（需要引入 xlsx 包）。
      - 纯 SQL：自己构造 INSERT 语句；但处理多域名拆分与校验较繁琐，建议用脚本。

---

1. 多域名添加与告警 ✅ 已完成

    - 方案：在“添加站点”里支持用英文逗号/空白分隔多个域名；后端拆分为多行写入（同租户/名称/端口/协议/备注），各自独立监控与告警。
    - 实现：
      - 前端：
        - `SiteMonitorPage.tsx`：域名输入框 placeholder 提示“支持多个域名，用英文逗号分隔”。
      - 后端：
        - `site-monitor.service.ts#createSite`：解析 `dto.host` 为多个 host，单个用单条插入，多域名批量插入；返回值对前端无依赖。
      - 告警：
        - 已按单行（单域名）进行检查与告警，消息中仅包含不可用的具体域名。
    - 最佳实践：
      - 若不同域名需要不同健康路径/预期码，建议未来支持“站点模板 + 多域名明细”模型；当前按多行存储最简单可靠。

---

1. 详情保存后不自动关闭 ✅ 已完成

    - 修复：保存成功后关闭弹窗并重置表单/状态。
    - 文件：`eks-dashboard-frontend/src/pages/SiteMonitorPage.tsx`
      - 在详情 Modal 的 onOk 中：保存成功后调用 `setDetailOpen(false)`, `editForm.resetFields()`, `setDetailRecord(null)`。

2. 取消后再次打开仍保留未保存改动 ✅ 已完成

    - 修复：`onCancel` 时重置表单并清空当前记录；同时对话框采用 `destroyOnClose` 确保下次打开时重新挂载、使用最新初始值。
    - 文件：`eks-dashboard-frontend/src/pages/SiteMonitorPage.tsx`
      - Modal 增加 `destroyOnClose`；`onCancel` 中调用 `editForm.resetFields()` 并清空 `detailRecord`。

---

- DB-mysql相关操作已经执行，除非有更新sql，否则不必重复讨论。

---

1) 告警“静默（分钟）”默认值改为 10 分钟 ✅ 已完成

- 后端默认值已改为 10（`alerts.service.ts`）。
- 前端 placeholder 已调整为 10（`SiteMonitorPage.tsx`）。
- 仅影响未在 DB 保存过的环境；DB 已保存的不受影响。

2) 静默设置为 2 分钟但仍 5 分钟收到告警 ✅ 已完成

- 调度器已从每 5 分钟改为每分钟运行（`monitor.scheduler.ts`）。
- 冷却期比较使用 UTC 字符串解析，避免误判。
- 可进一步扩展 `poll_interval_seconds`（未实现，暂不需要）。

3) 恢复告警（从不可用→可用后发送一次“恢复”通知） ✅ 已完成（不依赖 DB 迁移）

- scheduler 比较“上次状态”(listSites 读取) 与“本次检查后的状态”，从 不可用→可用 时发送“恢复通知”。
- 新增 `sendRecoveryAlert`（`alerts.service.ts`）。
- 目前未引入 `last_recover_at` 列，避免 DB 迁移；逻辑基于上次状态判断，下一次轮询读到已可用则不再重复发送。

## Medium Priority

## Low Priority

1. 环境管理中增加“商户/租户管理”页面（独立菜单区块）
   说明：当前 tenants 已有表结构，但前端尚未提供可视化管理入口；待环境管理稳定后推进。
