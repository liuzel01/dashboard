# Dashboard Blackbox Exporter

第一版 Blackbox Exporter 独立运行在 Dashboard EC2
`i-0534e7ed9423fff65` 的 `/opt/blackbox-exporter`，容器固定为
`prom/blackbox-exporter:v0.29.0`，监听 TCP `9115`。

`mgbx-external-probes.yaml` 在 `monitoring` Namespace 中创建一个无 selector 的
Service 和 EndpointSlice，将 Prometheus Operator `Probe` 转发至 EC2 私网地址
`10.100.166.109:9115`。EC2 Security Group 只允许 mgbx EKS 集群 Security Group
访问该端口，不对公网开放。

当前 Probe 只使用无凭据、无副作用的 `http_2xx` 检查。同一清单中的
`PrometheusRule` 在目标连续失败 3 分钟或 Blackbox Exporter 连续不可采集 3 分钟后
产生 `warning` 告警，继续复用现有 Alertmanager 普通告警链路，不进入 `critical`
Oncall 路由。GitLab Token、Grafana
Service Account、Cliproxy API Key 和 Jenkins 专用用户等认证/授权检查不能写入
Blackbox 配置，后续由 Dashboard Provider Probe 承担。

验证命令：

```bash
curl -fsS http://127.0.0.1:9115/-/healthy
curl -fsS 'http://127.0.0.1:9115/probe?module=http_2xx&target=https://example.com'
```

变更目标列表后，执行 Kubernetes server-side dry-run，再应用：

```bash
kubectl --context <mgbx-operator-context> apply --server-side --dry-run=server \
  -f deploy/blackbox-exporter/mgbx-external-probes.yaml
kubectl --context <mgbx-operator-context> apply --server-side \
  -f deploy/blackbox-exporter/mgbx-external-probes.yaml
```
