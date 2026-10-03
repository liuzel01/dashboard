export const MONITORING_RESOURCE_TYPES = ['ServiceMonitor', 'PodMonitor', 'PrometheusRule', 'WorkloadBundle'] as const;
export const MONITORING_CREATABLE_RESOURCE_TYPES = ['ServiceMonitor', 'PrometheusRule', 'WorkloadBundle'] as const;
export const PROMETHEUS_RULE_SEVERITIES = ['warning', 'critical'] as const;

export type MonitoringCreatableResourceType = (typeof MONITORING_CREATABLE_RESOURCE_TYPES)[number];
export type MonitoringResourceType = (typeof MONITORING_RESOURCE_TYPES)[number];
export type PrometheusRuleSeverity = (typeof PROMETHEUS_RULE_SEVERITIES)[number];

export type PrometheusRuleFields = {
  alertName: string;
  expr: string;
  forDuration: string;
  severity: PrometheusRuleSeverity;
  summary: string;
  description: string;
  owner: string;
  runbookUrl: string;
};

const ALERT_NAME = /^[A-Z][A-Za-z0-9_:]{2,127}$/;
const OWNER = /^[A-Za-z0-9][A-Za-z0-9._@/-]{1,63}$/;
const DURATION = /^([1-9][0-9]*)(s|m|h|d|w)$/;
const URL = /^https?:\/\/[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]{1,500}$/;
const PRINTABLE = /^[\t\n\r -~]+$/;
const REQUIRED_COMPARATOR = /(?:[<>]=?|==|!=)/;
const ALLOWED_METRIC = /\b(?:up|kube_[A-Za-z0-9_:]*|container_[A-Za-z0-9_:]*|http_[A-Za-z0-9_:]*|jvm_[A-Za-z0-9_:]*|process_[A-Za-z0-9_:]*|spring_[A-Za-z0-9_:]*|nodejs_[A-Za-z0-9_:]*|go_[A-Za-z0-9_:]*|nginx_[A-Za-z0-9_:]*)\b/;
const FORBIDDEN_SNIPPETS = [/{{|}}/, /[`;]/, /\boffset\b/i, /(^|[^A-Za-z0-9_])@([^A-Za-z0-9_]|$)/, /\b(?:group_left|group_right|ignoring|without)\b/];

export function defaultServiceMonitorName(appId: string) {
  return `${appId}-metrics`;
}

export function defaultPrometheusRuleResourceName(appId: string) {
  return `${appId}-platform-rules`;
}

export function defaultPrometheusRuleGroupName(appId: string) {
  return `platform.${appId}.alerts`;
}

export function normalizePrometheusRuleFields(
  input: Partial<PrometheusRuleFields> | undefined | null,
): PrometheusRuleFields {
  return {
    alertName: String(input?.alertName || '').trim(),
    expr: String(input?.expr || '').trim(),
    forDuration: String(input?.forDuration || '').trim(),
    severity: String(input?.severity || '').trim().toLowerCase() as PrometheusRuleSeverity,
    summary: String(input?.summary || '').trim(),
    description: String(input?.description || '').trim(),
    owner: String(input?.owner || '').trim(),
    runbookUrl: String(input?.runbookUrl || '').trim(),
  };
}

export function validatePrometheusRuleFields(
  appId: string,
  fields: PrometheusRuleFields,
) {
  if (!ALERT_NAME.test(fields.alertName)) {
    throw new Error('PrometheusRule 告警名必须以大写字母开头，仅允许字母、数字、下划线、冒号，长度 3-128');
  }
  if (!fields.summary) throw new Error('PrometheusRule summary 不能为空');
  if (!fields.description) throw new Error('PrometheusRule description 不能为空');
  if (!fields.owner || !OWNER.test(fields.owner)) {
    throw new Error('PrometheusRule owner 不能为空，且仅允许字母、数字、点、下划线、@、斜杠、连字符');
  }
  if (!fields.runbookUrl || !URL.test(fields.runbookUrl)) {
    throw new Error('PrometheusRule runbookUrl 必须是有效的 http(s) URL');
  }
  if (!PROMETHEUS_RULE_SEVERITIES.includes(fields.severity)) {
    throw new Error('PrometheusRule severity 仅允许 warning 或 critical');
  }
  if (fields.expr.length < 8 || fields.expr.length > 600) {
    throw new Error('PrometheusRule expr 长度必须为 8-600 个字符');
  }
  if (!PRINTABLE.test(fields.expr)) {
    throw new Error('PrometheusRule expr 仅允许可打印 ASCII 字符');
  }
  if (!REQUIRED_COMPARATOR.test(fields.expr)) {
    throw new Error('PrometheusRule expr 必须包含明确的比较运算符');
  }
  if (!ALLOWED_METRIC.test(fields.expr)) {
    throw new Error('PrometheusRule expr 必须引用受控白名单内的常见指标前缀');
  }
  for (const pattern of FORBIDDEN_SNIPPETS) {
    if (pattern.test(fields.expr)) {
      throw new Error('PrometheusRule expr 包含当前一期不允许的高级 PromQL 语法');
    }
  }
  assertBalancedExpression(fields.expr);
  const seconds = durationToSeconds(fields.forDuration);
  if (seconds < 300) {
    throw new Error('PrometheusRule forDuration 至少为 5m');
  }
  if (!fields.alertName.toLowerCase().includes(appId.replace(/-/g, '').toLowerCase().slice(0, 4))) {
    throw new Error('PrometheusRule 告警名需与应用标识具备明显关联，避免跨应用重名');
  }
}

function durationToSeconds(value: string) {
  const match = value.match(DURATION);
  if (!match) throw new Error('PrometheusRule forDuration 必须使用整数加单位（s/m/h/d/w）');
  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === 's' ? 1 : unit === 'm' ? 60 : unit === 'h' ? 3600 : unit === 'd' ? 86400 : 604800;
  return amount * multiplier;
}

function assertBalancedExpression(expr: string) {
  const pairs: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  const stack: string[] = [];
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < expr.length; i += 1) {
    const char = expr[i];
    if ((char === '"' || char === "'") && expr[i - 1] !== '\\') {
      quote = quote === char ? null : (quote || (char as '"' | "'"));
      continue;
    }
    if (quote) continue;
    if (char === '(' || char === '[' || char === '{') stack.push(char);
    if (char === ')' || char === ']' || char === '}') {
      const expected = pairs[char];
      if (stack.pop() !== expected) throw new Error('PrometheusRule expr 括号或花括号不平衡');
    }
  }
  if (quote || stack.length) throw new Error('PrometheusRule expr 引号或括号不平衡');
}

export function renderPrometheusRuleYaml(row: {
  app_id: string;
  resource_name: string;
  prometheus_rule_alert_name: string;
  prometheus_rule_expr: string;
  prometheus_rule_for: string;
  prometheus_rule_severity: string;
  prometheus_rule_summary: string;
  prometheus_rule_description: string;
  prometheus_rule_owner: string;
  prometheus_rule_runbook_url: string;
}) {
  return `apiVersion: monitoring.coreos.com/v1\nkind: PrometheusRule\nmetadata:\n  name: ${row.resource_name}\n  namespace: platform-monitoring\n  labels:\n    release: kube-prometheus-stack\n    app.kubernetes.io/name: ${row.app_id}\n    app.kubernetes.io/part-of: dashboard\nspec:\n  groups:\n    - name: ${defaultPrometheusRuleGroupName(row.app_id)}\n      rules:\n        - alert: ${row.prometheus_rule_alert_name}\n          expr: ${row.prometheus_rule_expr}\n          for: ${row.prometheus_rule_for}\n          labels:\n            severity: ${row.prometheus_rule_severity}\n            service: ${row.app_id}\n            environment: hash\n            owner: ${row.prometheus_rule_owner}\n          annotations:\n            summary: ${quoteYaml(row.prometheus_rule_summary)}\n            description: ${quoteYaml(row.prometheus_rule_description)}\n            runbook_url: ${quoteYaml(row.prometheus_rule_runbook_url)}\n`;
}

function quoteYaml(value: string) {
  return JSON.stringify(value);
}
