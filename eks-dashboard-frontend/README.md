# EKS Dashboard 前端

基于 React、TypeScript、Vite 和 Ant Design 的运维控制台前端。

前端通过同源 `/api` 调用 Dashboard 后端；环境选择、权限菜单、运行期日志 Socket 地址等由后端和 `siteconf` 提供，不在前端写入环境凭证。

## 功能范围

- EKS Deployment 查询、发布、回退与日志追踪
- 环境、账号权限、资产、线路、站点监控与查询中心
- Ingress / TLS / `tenant_domain` 等受控运维流程
- SSL 证书、KMS、审计、告警与值班能力
- SSO 登录与基于权限码的菜单控制

## 本地开发

推荐在仓库根目录启动完整开发环境：

```bash
./scripts/dev.sh start
```

该命令会构建后端，并通过独立的 PM2 开发命名空间启动：

- 后端：`http://localhost:3000`
- 前端：Vite 开发服务器（默认 `http://localhost:5173`）

查看或重启：

```bash
./scripts/dev.sh status
./scripts/dev.sh restart
./scripts/dev.sh stop
```

仅启动前端时：

```bash
npm ci
npm run dev
```

## 配置

复制 `.env.example` 为 `.env`，通常只需保留：

```dotenv
VITE_API_BASE_URL=/api
# 可选：探测详情页地址
VITE_PROBE_DASHBOARD_URL=https://probe.example.internal
```

不要在前端 `.env`、构建参数或仓库中放入 AWS AK/SK、数据库密码、MFA Secret、Agent Token 或 SSO Client Secret。

运行期配置（例如日志 Socket 地址）由后端接口提供；修改 `siteconf` 后刷新页面即可生效，通常不需要重新构建前端。

## 常用命令

```bash
npm run build    # TypeScript 检查并构建 dist/
npm run lint     # ESLint
npm run preview  # 本地预览构建产物
```

生产环境使用 `npm run preview -- --host 0.0.0.0 --port 5173` 提供已构建的 `dist/`；实际由仓库根目录的 `ecosystem.prod.config.js` 和发布脚本管理。

## 开发约束

- 新功能以真实路由、权限码和环境上下文为准，不以原型文件替代。
- 高风险操作须保留后端授权、MFA / 确认、dry-run 和审计链路；前端禁用状态不能作为唯一保护。
- 租户、环境和 Ingress 等选择必须使用当前环境返回的数据，不允许任意输入绕过后端校验。

部署流程见仓库根目录的 [GitHub Actions 部署说明](../docs/github-actions-deployment.md)。
