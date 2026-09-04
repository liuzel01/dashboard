import { defaultPrometheusRuleGroupName, defaultPrometheusRuleResourceName, normalizePrometheusRuleFields, renderPrometheusRuleYaml, validatePrometheusRuleFields } from './monitoring-request-policy';

describe('monitoring-request-policy', () => {
  const appId = 'dashboard-chain-test';
  const valid = normalizePrometheusRuleFields({
    alertName: 'DashboardChainTestDown',
    expr: 'kube_deployment_status_replicas_available{namespace="default",deployment="dashboard-chain-test"} < 1',
    forDuration: '5m',
    severity: 'warning',
    summary: 'dashboard-chain-test has no ready replicas',
    description: 'The default/dashboard-chain-test deployment has no ready replicas for 5 minutes.',
    owner: 'platform-oncall',
    runbookUrl: 'https://runbooks.example.com/dashboard-chain-test',
  });

  it('accepts a conservative phase-1 PrometheusRule payload', () => {
    expect(() => validatePrometheusRuleFields(appId, valid)).not.toThrow();
    expect(defaultPrometheusRuleResourceName(appId)).toBe('dashboard-chain-test-platform-rules');
    expect(defaultPrometheusRuleGroupName(appId)).toBe('platform.dashboard-chain-test.alerts');
  });

  it('rejects too-short durations', () => {
    expect(() => validatePrometheusRuleFields(appId, { ...valid, forDuration: '4m' })).toThrow('至少为 5m');
  });

  it('rejects forbidden promql syntax', () => {
    expect(() => validatePrometheusRuleFields(appId, { ...valid, expr: 'sum without(instance) (up{job="dashboard-chain-test"} == 0)' })).toThrow('不允许');
  });

  it('renders the fixed PrometheusRule YAML shape', () => {
    const yaml = renderPrometheusRuleYaml({
      app_id: appId,
      resource_name: defaultPrometheusRuleResourceName(appId),
      prometheus_rule_alert_name: valid.alertName,
      prometheus_rule_expr: valid.expr,
      prometheus_rule_for: valid.forDuration,
      prometheus_rule_severity: valid.severity,
      prometheus_rule_summary: valid.summary,
      prometheus_rule_description: valid.description,
      prometheus_rule_owner: valid.owner,
      prometheus_rule_runbook_url: valid.runbookUrl,
    });
    expect(yaml).toContain('kind: PrometheusRule');
    expect(yaml).toContain('name: dashboard-chain-test-platform-rules');
    expect(yaml).toContain('name: platform.dashboard-chain-test.alerts');
    expect(yaml).toContain('owner: platform-oncall');
    expect(yaml).toContain('runbook_url: "https://runbooks.example.com/dashboard-chain-test"');
  });
});
