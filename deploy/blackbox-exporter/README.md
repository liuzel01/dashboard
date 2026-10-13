# Dashboard Blackbox Exporter

第一版 Blackbox Exporter 独立运行在 Dashboard EC2
`i-0534e7ed9423fff65` 的 `/opt/blackbox-exporter`，容器固定为
`prom/blackbox-exporter:v0.29.0`，监听 TCP `9115`。

`mgbx-external-probes.yaml` 在 `monitoring` Namespace 中只创建一个无 selector 的
Service 和 EndpointSlice，将集群内访问转发至 EC2 私网地址
`10.100.166.109:9115`。EC2 Security Group 只允许 mgbx EKS 集群 Security Group
访问该端口，不对公网开放。

`blackbox.yml` 提供两个受控模块：`http_2xx` 用于真正应返回成功响应的页面和
健康接口；`http_reachable` 用于认证入口或云厂商 API 根地址，允许预先核定的
400/401/403/404/405/431 响应，只判断 DNS/TCP/TLS/HTTP 服务是否可达。两类探测
都不携带凭据、不会验证业务权限。

目标目录、L1/L2/L3 调度、连续失败阈值、历史和恢复事件全部由 Dashboard 后端统一
管理。这里不再包含 Prometheus Operator `Probe` 和静态目标列表，避免数据库与
Kubernetes YAML 双份维护。凭据只由 Dashboard Provider Probe 在后端读取。

验证命令：

```bash
curl -fsS http://127.0.0.1:9115/-/healthy
curl -fsS 'http://127.0.0.1:9115/probe?module=http_2xx&target=https://example.com'
```

本地开发时使用仓库内的受控配置启动：

```bash
docker run -d --name dashboard-blackbox-exporter-dev --restart unless-stopped \
  -p 9115:9115 \
  -v "$PWD/deploy/blackbox-exporter/blackbox.yml:/config/blackbox.yml:ro" \
  prom/blackbox-exporter:v0.29.0 \
  --config.file=/config/blackbox.yml
```

仅当 Blackbox Exporter 的网络入口发生变化时，执行 Kubernetes server-side dry-run，再应用：

```bash
kubectl --context <mgbx-operator-context> apply --server-side --dry-run=server \
  -f deploy/blackbox-exporter/mgbx-external-probes.yaml
kubectl --context <mgbx-operator-context> apply --server-side \
  -f deploy/blackbox-exporter/mgbx-external-probes.yaml
```
