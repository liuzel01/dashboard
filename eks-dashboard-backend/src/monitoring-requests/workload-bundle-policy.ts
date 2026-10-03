import { loadAll } from 'js-yaml';

const DNS_LABEL = /^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/;
const FILE_PATH = /^k8s-yaml\/deployments\/(?:kylin|kylin-node)\/[a-z0-9][a-z0-9-]*\.ya?ml$/;
const ALLOWED_PLACEHOLDERS = new Set([
  'APP_NAME', 'DEPLOYMENT_NAME', 'REPLICAS', 'IMAGE_PULL_SECRET', 'IMAGE_REGISTRY',
  'IMAGE_NAME', 'CONTAINER_NAME', 'CONFIG_MAP', 'LOG_PATH', 'HOST_LOG_PATH',
  'DOCKER_TAG', 'COMMIT_ID', 'COVERAGE_SESSION_ID',
]);

export type WorkloadBundle = {
  yaml: string;
  filePath: string;
  deploymentName: string;
  serviceName: string;
  namespace: 'default';
};

function fail(message: string): never { throw new Error(message); }
function name(value: unknown, field: string) {
  const normalized = String(value || '').trim();
  if (!DNS_LABEL.test(normalized) || normalized.length > 63) fail(`${field} 必须是合法的 DNS-1123 名称`);
  return normalized;
}
function object(value: unknown, field: string): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${field} 必须是对象`);
  return value as Record<string, any>;
}
function sameLabels(left: Record<string, any>, right: Record<string, any>) {
  const a = Object.entries(left).sort(); const b = Object.entries(right).sort();
  return JSON.stringify(a) === JSON.stringify(b);
}

export function validateWorkloadBundle(rawYaml: string, rawFilePath: string): WorkloadBundle {
  const yaml = String(rawYaml || '').trim();
  const filePath = String(rawFilePath || '').trim();
  if (!yaml || yaml.length > 100_000) fail('工作负载 YAML 长度必须为 1-100000 个字符');
  if (!FILE_PATH.test(filePath) || filePath.includes('..')) fail('目标文件必须位于 k8s-yaml/deployments/kylin 或 kylin-node，且文件名只能使用小写字母、数字和连字符');

  const placeholders = [...yaml.matchAll(/\$\{([A-Z][A-Z0-9_]*)\}/g)].map((match) => match[1]);
  const unknown = [...new Set(placeholders.filter((item) => !ALLOWED_PLACEHOLDERS.has(item)))];
  if (unknown.length) fail(`YAML 包含不允许的变量：${unknown.join(', ')}`);
  for (const required of ['IMAGE_REGISTRY', 'IMAGE_NAME', 'DOCKER_TAG', 'IMAGE_PULL_SECRET']) {
    if (!placeholders.includes(required)) fail(`YAML 必须保留变量 \${${required}}`);
  }

  const documents: any[] = [];
  try { loadAll(yaml, (document) => { if (document) documents.push(document); }); }
  catch (error: any) { fail(`YAML 解析失败：${String(error?.message || error)}`); }
  if (documents.length !== 2) fail('第一版资源包必须且只能包含一个 Service 和一个 Deployment');
  const service = documents.find((item) => item?.apiVersion === 'v1' && item?.kind === 'Service');
  const deployment = documents.find((item) => item?.apiVersion === 'apps/v1' && item?.kind === 'Deployment');
  if (!service || !deployment) fail('资源包必须包含 v1/Service 和 apps/v1/Deployment');
  for (const resource of [service, deployment]) {
    const namespace = resource?.metadata?.namespace;
    if (namespace && namespace !== 'default') fail('第一版仅允许 default namespace');
    if (resource?.metadata?.ownerReferences || resource?.metadata?.finalizers) fail('不允许设置 ownerReferences 或 finalizers');
  }

  const serviceName = name(service?.metadata?.name, 'Service 名称');
  const deploymentName = name(deployment?.metadata?.name, 'Deployment 名称');
  const serviceSpec = object(service.spec, 'Service spec');
  const deploymentSpec = object(deployment.spec, 'Deployment spec');
  if (serviceSpec.type && serviceSpec.type !== 'ClusterIP') fail('Service 第一版仅允许 ClusterIP');
  for (const forbidden of ['externalName', 'externalIPs', 'loadBalancerIP', 'loadBalancerSourceRanges']) {
    if (serviceSpec[forbidden] !== undefined) fail(`Service 不允许设置 ${forbidden}`);
  }
  if (!Array.isArray(serviceSpec.ports) || serviceSpec.ports.length < 1 || serviceSpec.ports.some((port: any) => port.nodePort)) fail('Service 必须声明端口且不能设置 nodePort');

  const selector = object(deploymentSpec.selector?.matchLabels, 'Deployment selector.matchLabels');
  const podLabels = object(deploymentSpec.template?.metadata?.labels, 'Deployment Pod labels');
  const serviceSelector = object(serviceSpec.selector, 'Service selector');
  if (!Object.keys(selector).length || !sameLabels(selector, podLabels) || !sameLabels(selector, serviceSelector)) fail('Deployment selector、Pod labels 与 Service selector 必须完全一致');
  const replicas = Number(deploymentSpec.replicas ?? 1);
  if (!Number.isInteger(replicas) || replicas < 1 || replicas > 10) fail('Deployment replicas 仅允许 1-10');

  const podSpec = object(deploymentSpec.template?.spec, 'Deployment Pod spec');
  if (podSpec.hostNetwork || podSpec.hostPID || podSpec.hostIPC) fail('禁止 hostNetwork、hostPID 或 hostIPC');
  if (podSpec.initContainers?.length || podSpec.ephemeralContainers?.length) fail('第一版不允许 initContainers 或 ephemeralContainers');
  if (!name(podSpec.serviceAccountName, 'serviceAccountName')) fail('serviceAccountName 不能为空');
  if (!Array.isArray(podSpec.imagePullSecrets) || !podSpec.imagePullSecrets.some((item: any) => item?.name === '${IMAGE_PULL_SECRET}')) fail('imagePullSecrets 必须引用 ${IMAGE_PULL_SECRET}');
  if ((podSpec.volumes || []).some((volume: any) => volume?.hostPath)) fail('禁止 hostPath volume');

  const containers = podSpec.containers;
  if (!Array.isArray(containers) || containers.length !== 1) fail('第一版 Deployment 必须且只能包含一个容器');
  const container = containers[0];
  name(container?.name, '容器名称');
  if (container.image !== '${IMAGE_REGISTRY}/${IMAGE_NAME}:${DOCKER_TAG}') fail('容器镜像必须保持为 ${IMAGE_REGISTRY}/${IMAGE_NAME}:${DOCKER_TAG}');
  if (container?.securityContext?.privileged || container?.securityContext?.allowPrivilegeEscalation === true) fail('禁止 privileged 或 allowPrivilegeEscalation');
  if (!container.readinessProbe || !container.livenessProbe) fail('必须配置 readinessProbe 和 livenessProbe');
  if (!container.resources?.requests?.cpu || !container.resources?.requests?.memory || !container.resources?.limits?.cpu || !container.resources?.limits?.memory) fail('必须同时配置 CPU/内存 requests 与 limits');
  const containerPorts = new Set((container.ports || []).map((port: any) => Number(port.containerPort)));
  if (!containerPorts.size || serviceSpec.ports.some((port: any) => !containerPorts.has(Number(port.targetPort)))) fail('Service targetPort 必须匹配容器端口');

  return { yaml: `${yaml}\n`, filePath, deploymentName, serviceName, namespace: 'default' };
}
