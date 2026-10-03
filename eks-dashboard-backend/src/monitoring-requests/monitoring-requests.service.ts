import { BadRequestException, ForbiddenException, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import axios from 'axios';
import { SiteConfService } from '../site-conf/site-conf.service';
import { timingSafeEqual } from 'crypto';
import { randomUUID } from 'crypto';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AccessControlService } from '../access-control/access-control.service';
import { AuthService } from '../auth/auth.service';
import { KubernetesService } from '../kubernetes/kubernetes.service';
import { defaultPrometheusRuleGroupName, defaultPrometheusRuleResourceName, normalizePrometheusRuleFields, renderPrometheusRuleYaml, type MonitoringCreatableResourceType, type MonitoringResourceType, type PrometheusRuleFields, validatePrometheusRuleFields } from './monitoring-request-policy';
import { getMonitoringEnvironmentPolicy, getMonitoringEnvironmentPolicyByExecutorKey, MONITORING_ENVIRONMENT_POLICIES, requireMonitoringEnvironmentPolicy } from './monitoring-environment-policy';
import { validateWorkloadBundle } from './workload-bundle-policy';

type Actor = { userId: number; username: string; permissions: string[] };
type RequestInput = {
  environmentId: string;
  targetBranch: string;
  appId: string;
  resourceType: MonitoringCreatableResourceType;
  resourceName?: string;
  reason: string;
  prometheusRule?: Partial<PrometheusRuleFields>;
  workload?: { filePath: string; yaml: string; serviceJobName: string };
};
type StoredPrometheusRuleFields = {
  prometheus_rule_alert_name: string;
  prometheus_rule_expr: string;
  prometheus_rule_for: string;
  prometheus_rule_severity: string;
  prometheus_rule_summary: string;
  prometheus_rule_description: string;
  prometheus_rule_owner: string;
  prometheus_rule_runbook_url: string;
};
const MENU = 'menu:monitoring-requests';
const APPROVE = 'monitoring-requests:approve';
const MANAGE = 'monitoring-requests:manage';
const REAL_APPLY_MINUTES = 5;
const REAL_APPLY_MAX_MINUTES = 30;
const JENKINS_TIMEOUT_MIN_MS = 1_000;
const JENKINS_TIMEOUT_MAX_MS = 60_000;
const GITLAB_TIMEOUT_MIN_MS = 1_000;
const GITLAB_TIMEOUT_MAX_MS = 60_000;

@Injectable()
export class MonitoringRequestsService {
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
    private readonly siteConf: SiteConfService,
    private readonly kubernetes: KubernetesService,
  ) {}

  private async actor(authorization?: string): Promise<Actor> {
    const raw = String(authorization || '');
    if (!raw.toLowerCase().startsWith('bearer ')) throw new UnauthorizedException('Missing token');
    const payload = await this.auth.verifyToken(raw.slice(7).trim());
    const user = payload.source === 'keycloak' || typeof payload.sub !== 'number'
      ? await this.access.ensureUserByUsername(payload.username, { displayName: payload.displayName })
      : { id: Number(payload.sub) };
    const me = await this.access.getMe({ userId: Number(user.id) });
    const permissions = (me.permissions || []).map(String);
    if (!permissions.includes(MENU)) throw new ForbiddenException(`Missing permissions: ${MENU}`);
    return { userId: Number(me.id), username: String(me.username), permissions };
  }
  private can(actor: Actor, permission: string) { return actor.permissions.includes(permission); }
  private requestView(row: any) {
    const policy = getMonitoringEnvironmentPolicy(String(row.environment_id || ''));
    const executionEnabled = !!policy?.executionEnabled
      && row.target_branch === policy.targetBranch
      && row.repository_environment_path === policy.repositoryEnvironmentPath
      && row.executor_key === policy.executorKey;
    let workloadStatus = null;
    if (row.workload_last_check_json) {
      try { workloadStatus = JSON.parse(String(row.workload_last_check_json)); } catch { workloadStatus = null; }
    }
    return { ...row, workload_status: workloadStatus, environment_name: policy?.label || row.environment_id, execution_enabled: executionEnabled };
  }
  private async read(requestId: string) {
    const rows = await this.db.query<any[]>(`SELECT r.*, u.username AS requester_username, u.display_name AS requester_display_name,
      au.username AS approver_username, au.display_name AS approver_display_name
      FROM monitoring_requests r JOIN users u ON u.id=r.requester_user_id
      LEFT JOIN users au ON au.id=r.approver_user_id WHERE r.request_id=? LIMIT 1`, [requestId]);
    if (!rows[0]) throw new NotFoundException('申请不存在');
    const r = rows[0];
    r.events = await this.db.query<any[]>('SELECT event_type, actor_username, comment, from_status, to_status, created_at FROM monitoring_request_events WHERE request_id=? ORDER BY id ASC', [requestId]);
    return this.requestView(r);
  }
  private owns(actor: Actor, row: any) { return Number(row.requester_user_id) === actor.userId; }
  private assertRead(actor: Actor, row: any) { if (!this.owns(actor, row) && !this.can(actor, APPROVE) && !this.can(actor, MANAGE)) throw new ForbiddenException('仅可查看本人申请'); }
  private async event(requestId: string, actor: Actor, type: string, from: string | null, to: string | null, comment?: string) {
    await this.db.query('INSERT INTO monitoring_request_events (request_id,event_type,actor_user_id,actor_username,from_status,to_status,comment,created_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP())', [requestId, type, actor.userId, actor.username, from, to, comment?.trim() || null]);
  }
  private resourcePath(appId: string, repositoryEnvironmentPath: string) { return `k8s-yaml/platform/environments/${repositoryEnvironmentPath}/apps/${appId}/monitoring/`; }
  private managedBranch(requestId: string) { return `platform/${requestId.toLowerCase()}`; }
  private managedFilePath(row: { app_id: string; resource_type: MonitoringResourceType }) {
    if (row.resource_type === 'WorkloadBundle') return String((row as any).resource_path || '');
    const fileName = row.resource_type === 'PrometheusRule' ? 'prometheus-rule.yaml' : 'service-monitor.yaml';
    return `${String((row as any).resource_path || '')}${fileName}`;
  }
  private serviceMonitorYaml(row: any) {
    // First managed template: a conventional HTTP /metrics Service endpoint.
    // No user-provided YAML, paths, labels, or Git refs are accepted here.
    return `apiVersion: monitoring.coreos.com/v1\nkind: ServiceMonitor\nmetadata:\n  name: ${row.resource_name}\n  namespace: platform-monitoring\n  labels:\n    release: kube-prometheus-stack\n    app.kubernetes.io/name: ${row.app_id}\n    app.kubernetes.io/part-of: dashboard\nspec:\n  jobLabel: app.kubernetes.io/name\n  namespaceSelector:\n    matchNames:\n      - default\n  selector:\n    matchLabels:\n      app.kubernetes.io/name: ${row.app_id}\n  endpoints:\n    - port: http\n      path: /metrics\n      scheme: http\n      interval: 30s\n      scrapeTimeout: 10s\n`;
  }
  private prometheusRuleYaml(row: any) {
    return renderPrometheusRuleYaml(row);
  }
  private managedYaml(row: any) {
    if (row.resource_type === 'WorkloadBundle') return String(row.workload_yaml || '');
    return row.resource_type === 'PrometheusRule' ? this.prometheusRuleYaml(row) : this.serviceMonitorYaml(row);
  }
  private async validateServiceMonitorTarget(row: any) {
    // The managed YAML has a fixed namespace, selector and endpoint port. Check the
    // live target cluster before creating an MR and again immediately before merging.
    // This call is read-only; it never derives or mutates the Git-managed template.
    try { return await this.kubernetes.getServiceMonitorTarget(String(row.environment_id), 'default', `app.kubernetes.io/name=${String(row.app_id)}`, 'http'); }
    catch (err: any) {
      const detail = String(err?.message || 'unknown Kubernetes API error').slice(0, 500);
      if (detail.startsWith('expected exactly one matching Service') || detail.startsWith('matching Service')) throw new BadRequestException(`ServiceMonitor 目标 Service 不满足受控契约：${detail}`);
      throw new ServiceUnavailableException(`无法读取 ${row.environment_id} 集群中的 ServiceMonitor 目标 Service：${detail}`);
    }
  }
  private normalizePrometheusRuleInput(appId: string, fields: Partial<PrometheusRuleFields> | undefined | null): StoredPrometheusRuleFields {
    const normalized = normalizePrometheusRuleFields(fields);
    try {
      validatePrometheusRuleFields(appId, normalized);
    } catch (err: any) {
      throw new BadRequestException(String(err?.message || 'PrometheusRule 字段无效'));
    }
    return {
      prometheus_rule_alert_name: normalized.alertName,
      prometheus_rule_expr: normalized.expr,
      prometheus_rule_for: normalized.forDuration,
      prometheus_rule_severity: normalized.severity,
      prometheus_rule_summary: normalized.summary,
      prometheus_rule_description: normalized.description,
      prometheus_rule_owner: normalized.owner,
      prometheus_rule_runbook_url: normalized.runbookUrl,
    };
  }
  private normalizeCreateInput(input: RequestInput) {
    this.requireNonBlank(input.reason, '申请说明');
    if (input.resourceType === 'WorkloadBundle') {
      let workload;
      try { workload = validateWorkloadBundle(String(input.workload?.yaml || ''), String(input.workload?.filePath || '')); }
      catch (error: any) { throw new BadRequestException(String(error?.message || '工作负载资源包无效')); }
      return {
        appId: input.appId, resourceType: input.resourceType, resourceName: workload.deploymentName,
        reason: input.reason.trim(), resourcePath: workload.filePath, workload_yaml: workload.yaml,
        workload_namespace: workload.namespace, workload_deployment_name: workload.deploymentName,
        workload_service_name: workload.serviceName, workload_service_job_name: this.normalizeServiceJobName(input.workload?.serviceJobName),
        prometheus_rule_alert_name: null, prometheus_rule_expr: null, prometheus_rule_for: null,
        prometheus_rule_severity: null, prometheus_rule_summary: null, prometheus_rule_description: null,
        prometheus_rule_owner: null, prometheus_rule_runbook_url: null,
      };
    }
    if (input.resourceType === 'PrometheusRule') {
      return {
        appId: input.appId,
        resourceType: input.resourceType,
        resourceName: defaultPrometheusRuleResourceName(input.appId),
        reason: input.reason.trim(),
        ...this.normalizePrometheusRuleInput(input.appId, input.prometheusRule),
        resourcePath: null, workload_yaml: null, workload_namespace: null, workload_deployment_name: null, workload_service_name: null, workload_service_job_name: null,
      };
    }
    this.requireNonBlank(String(input.resourceName || ''), '资源名称');
    return {
      appId: input.appId,
      resourceType: input.resourceType,
      resourceName: String(input.resourceName).trim(),
      reason: input.reason.trim(),
      prometheus_rule_alert_name: null,
      prometheus_rule_expr: null,
      prometheus_rule_for: null,
      prometheus_rule_severity: null,
      prometheus_rule_summary: null,
      prometheus_rule_description: null,
      prometheus_rule_owner: null,
      prometheus_rule_runbook_url: null,
      resourcePath: null, workload_yaml: null, workload_namespace: null, workload_deployment_name: null, workload_service_name: null, workload_service_job_name: null,
    };
  }
  private normalizeUpdateInput(row: any, input: Partial<RequestInput>) {
    const appId = String(input.appId || row.app_id);
    const resourceType = String(input.resourceType || row.resource_type) as MonitoringCreatableResourceType;
    const reason = input.reason?.trim() || row.reason;
    this.requireNonBlank(reason, '申请说明');
    if (resourceType === 'WorkloadBundle') {
      let workload;
      try { workload = validateWorkloadBundle(String(input.workload?.yaml ?? row.workload_yaml ?? ''), String(input.workload?.filePath ?? row.resource_path ?? '')); }
      catch (error: any) { throw new BadRequestException(String(error?.message || '工作负载资源包无效')); }
      return {
        appId, resourceType, resourceName: workload.deploymentName, reason, resourcePath: workload.filePath,
        workload_yaml: workload.yaml, workload_namespace: workload.namespace,
        workload_deployment_name: workload.deploymentName, workload_service_name: workload.serviceName,
        workload_service_job_name: this.normalizeServiceJobName(input.workload?.serviceJobName ?? row.workload_service_job_name),
        prometheus_rule_alert_name: null, prometheus_rule_expr: null, prometheus_rule_for: null,
        prometheus_rule_severity: null, prometheus_rule_summary: null, prometheus_rule_description: null,
        prometheus_rule_owner: null, prometheus_rule_runbook_url: null,
      };
    }
    if (resourceType === 'PrometheusRule') {
      const current = {
        alertName: row.prometheus_rule_alert_name,
        expr: row.prometheus_rule_expr,
        forDuration: row.prometheus_rule_for,
        severity: row.prometheus_rule_severity,
        summary: row.prometheus_rule_summary,
        description: row.prometheus_rule_description,
        owner: row.prometheus_rule_owner,
        runbookUrl: row.prometheus_rule_runbook_url,
      };
      return {
        appId,
        resourceType,
        resourceName: defaultPrometheusRuleResourceName(appId),
        reason,
        ...this.normalizePrometheusRuleInput(appId, { ...current, ...(input.prometheusRule || {}) }),
        resourcePath: null, workload_yaml: null, workload_namespace: null, workload_deployment_name: null, workload_service_name: null, workload_service_job_name: null,
      };
    }
    const resourceName = String(input.resourceName || row.resource_name).trim();
    this.requireNonBlank(resourceName, '资源名称');
    return {
      appId,
      resourceType,
      resourceName,
      reason,
      prometheus_rule_alert_name: null,
      prometheus_rule_expr: null,
      prometheus_rule_for: null,
      prometheus_rule_severity: null,
      prometheus_rule_summary: null,
      prometheus_rule_description: null,
      prometheus_rule_owner: null,
      prometheus_rule_runbook_url: null,
      resourcePath: null, workload_yaml: null, workload_namespace: null, workload_deployment_name: null, workload_service_name: null, workload_service_job_name: null,
    };
  }
  private async validatePrometheusRuleTarget(row: any) {
    try {
      const conflicts = await this.kubernetes.getPrometheusRuleConflicts(
        String(row.environment_id),
        'platform-monitoring',
        String(row.resource_name),
        defaultPrometheusRuleGroupName(String(row.app_id)),
        String(row.prometheus_rule_alert_name),
      );
      if (conflicts.resourceName || conflicts.groupName || conflicts.alertName) {
        throw new BadRequestException(
          `PrometheusRule 命中现有冲突：${[
            conflicts.resourceName ? `资源名=${conflicts.resourceName}` : '',
            conflicts.groupName ? `group=${conflicts.groupName}` : '',
            conflicts.alertName ? `alert=${conflicts.alertName}` : '',
          ].filter(Boolean).join('，')}`,
        );
      }
    } catch (err: any) {
      if (err instanceof BadRequestException) throw err;
      const detail = String(err?.message || 'unknown Kubernetes API error').slice(0, 500);
      throw new ServiceUnavailableException(`无法读取 ${row.environment_id} 集群中的 PrometheusRule 状态：${detail}`);
    }
  }
  private async validateManagedResource(row: any) {
    if (row.resource_type === 'WorkloadBundle') {
      if (row.environment_id !== 'hashex') throw new BadRequestException('工作负载资源包第一版仅支持 hashex');
      this.normalizeServiceJobName(row.workload_service_job_name);
      try { return validateWorkloadBundle(String(row.workload_yaml || ''), String(row.resource_path || '')); }
      catch (error: any) { throw new BadRequestException(String(error?.message || '工作负载资源包无效')); }
    }
    if (row.resource_type === 'PrometheusRule') return this.validatePrometheusRuleTarget(row);
    if (row.resource_type === 'ServiceMonitor') return this.validateServiceMonitorTarget(row);
    throw new BadRequestException(`当前不支持受控发布资源类型 ${row.resource_type}`);
  }
  private async assertWorkloadCreateOnly(row: any) {
    let status;
    try {
      status = await this.kubernetes.getWorkloadBundleStatus(
        String(row.environment_id), String(row.workload_deployment_name), String(row.workload_service_name), String(row.workload_namespace || 'default'),
      );
    } catch (error: any) {
      throw new ServiceUnavailableException(`无法读取 ${row.environment_id} 集群中的工作负载状态：${String(error?.message || error).slice(0, 500)}`);
    }
    if (status.deploymentFound || status.serviceFound) {
      throw new BadRequestException(`第一版仅允许新增：集群中已存在${status.deploymentFound ? ` Deployment/${row.workload_deployment_name}` : ''}${status.deploymentFound && status.serviceFound ? ' 与' : ''}${status.serviceFound ? ` Service/${row.workload_service_name}` : ''}`);
    }
  }
  private executionPolicy(row: any) {
    let policy;
    try { policy = requireMonitoringEnvironmentPolicy(String(row.environment_id || ''), String(row.target_branch || '')); }
    catch (error: any) { throw new BadRequestException(error?.message || '监控环境配置无效'); }
    if (row.repository_environment_path !== policy.repositoryEnvironmentPath || row.executor_key !== policy.executorKey) {
      throw new BadRequestException('申请中的环境执行快照与受控配置不一致');
    }
    if (!policy.executionEnabled) {
      throw new BadRequestException(`环境 ${policy.label} 的 Jenkins 执行器尚未配置；当前只能保存草稿，不能提交审批或执行`);
    }
    return policy;
  }
  private workloadSubmissionPolicy(row: any) {
    let policy;
    try { policy = requireMonitoringEnvironmentPolicy(String(row.environment_id || ''), String(row.target_branch || '')); }
    catch (error: any) { throw new BadRequestException(error?.message || '工作负载环境配置无效'); }
    if (policy.environmentId !== 'hashex' || row.repository_environment_path !== policy.repositoryEnvironmentPath) {
      throw new BadRequestException('工作负载申请中的环境、目标分支或仓库路径与受控配置不一致');
    }
    return policy;
  }
  private requireNonBlank(value: string, field: string) {
    if (!value || !value.trim()) throw new BadRequestException(`${field}不能为空`);
  }
  private normalizeServiceJobName(value: unknown) {
    const name = String(value || '').trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,254}$/.test(name) || name.includes('..') || name.includes('//')) {
      throw new BadRequestException('服务发布 Jenkins Job 名称无效');
    }
    return name;
  }
  private async approvalTokenMatches(provided?: string) {
    // Managed through SiteConf; an absent/empty value must always fail closed.
    const expected = await this.siteConf.getString('monitoring.requests.jenkins_approval_token', '');
    if (!expected || !provided) return false;
    const a = Buffer.from(expected); const b = Buffer.from(provided);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async list(auth: string | undefined, query: any) {
    const actor = await this.actor(auth); const page = Math.max(1, Number(query.page || 1)); const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const where: string[] = []; const values: any[] = [];
    if (!this.can(actor, APPROVE) && !this.can(actor, MANAGE)) { where.push('r.requester_user_id=?'); values.push(actor.userId); }
    if (query.status) { where.push('r.status=?'); values.push(query.status); }
    if (query.resourceType) { where.push('r.resource_type=?'); values.push(query.resourceType); }
    const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await this.db.query<any[]>(`SELECT COUNT(*) total FROM monitoring_requests r ${sql}`, values);
    const items = await this.db.query<any[]>(`SELECT r.*,u.username requester_username,u.display_name requester_display_name,au.username approver_username FROM monitoring_requests r JOIN users u ON u.id=r.requester_user_id LEFT JOIN users au ON au.id=r.approver_user_id ${sql} ORDER BY r.updated_at DESC LIMIT ? OFFSET ?`, [...values, pageSize, (page - 1) * pageSize]);
    return { items: items.map((item) => this.requestView(item)), total: Number(total[0]?.total || 0), page, pageSize };
  }
  async environmentOptions(auth: string | undefined) {
    await this.actor(auth);
    return MONITORING_ENVIRONMENT_POLICIES.map((policy) => ({ ...policy }));
  }
  async get(auth: string | undefined, requestId: string) { const actor = await this.actor(auth); const row = await this.read(requestId); this.assertRead(actor,row); return row; }
  async create(auth: string | undefined, input: RequestInput) {
    const normalized = this.normalizeCreateInput(input);
    let environmentPolicy;
    try { environmentPolicy = requireMonitoringEnvironmentPolicy(input.environmentId, input.targetBranch); }
    catch (error: any) { throw new BadRequestException(error?.message || '监控环境配置无效'); }
    if (normalized.resourceType === 'WorkloadBundle' && environmentPolicy.environmentId !== 'hashex') throw new BadRequestException('工作负载资源包第一版仅支持 hashex');
    const actor = await this.actor(auth); const requestId = `${environmentPolicy.environmentId.toUpperCase()}-MON-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${randomUUID().replace(/-/g,'').slice(0,6).toUpperCase()}`;
    await this.db.query(`INSERT INTO monitoring_requests (
      request_id,status,requester_user_id,environment_id,target_branch,repository_environment_path,executor_key,
      app_id,resource_type,resource_name,resource_path,reason,
      workload_yaml,workload_namespace,workload_deployment_name,workload_service_name,workload_service_job_name,
      prometheus_rule_alert_name,prometheus_rule_expr,prometheus_rule_for,prometheus_rule_severity,
      prometheus_rule_summary,prometheus_rule_description,prometheus_rule_owner,prometheus_rule_runbook_url,
      created_at,updated_at
    ) VALUES (?, 'DRAFT', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`, [
      requestId, actor.userId, environmentPolicy.environmentId, environmentPolicy.targetBranch, environmentPolicy.repositoryEnvironmentPath, environmentPolicy.executorKey,
      normalized.appId, normalized.resourceType, normalized.resourceName, normalized.resourcePath || this.resourcePath(normalized.appId, environmentPolicy.repositoryEnvironmentPath), normalized.reason,
      normalized.workload_yaml, normalized.workload_namespace, normalized.workload_deployment_name, normalized.workload_service_name, normalized.workload_service_job_name,
      normalized.prometheus_rule_alert_name, normalized.prometheus_rule_expr, normalized.prometheus_rule_for, normalized.prometheus_rule_severity,
      normalized.prometheus_rule_summary, normalized.prometheus_rule_description, normalized.prometheus_rule_owner, normalized.prometheus_rule_runbook_url,
    ]);
    await this.event(requestId,actor,'CREATED',null,'DRAFT'); return this.read(requestId);
  }
  async updateDraft(auth: string | undefined, requestId: string, input: Partial<RequestInput>) {
    const actor = await this.actor(auth); const row = await this.read(requestId); if (!this.owns(actor,row) || row.status !== 'DRAFT') throw new ForbiddenException('仅申请人可编辑草稿');
    const normalized = this.normalizeUpdateInput(row, input);
    if (normalized.resourceType === 'WorkloadBundle' && row.environment_id !== 'hashex') throw new BadRequestException('工作负载资源包第一版仅支持 hashex');
    await this.db.query(`UPDATE monitoring_requests SET
      app_id=?,resource_type=?,resource_name=?,resource_path=?,reason=?,
      workload_yaml=?,workload_namespace=?,workload_deployment_name=?,workload_service_name=?,workload_service_job_name=?,workload_last_check_json=NULL,workload_last_checked_at=NULL,
      prometheus_rule_alert_name=?,prometheus_rule_expr=?,prometheus_rule_for=?,prometheus_rule_severity=?,
      prometheus_rule_summary=?,prometheus_rule_description=?,prometheus_rule_owner=?,prometheus_rule_runbook_url=?,
      updated_at=UTC_TIMESTAMP()
      WHERE request_id=?`, [
      normalized.appId, normalized.resourceType, normalized.resourceName, normalized.resourcePath || this.resourcePath(normalized.appId, String(row.repository_environment_path || 'hash')), normalized.reason,
      normalized.workload_yaml, normalized.workload_namespace, normalized.workload_deployment_name, normalized.workload_service_name, normalized.workload_service_job_name,
      normalized.prometheus_rule_alert_name, normalized.prometheus_rule_expr, normalized.prometheus_rule_for, normalized.prometheus_rule_severity,
      normalized.prometheus_rule_summary, normalized.prometheus_rule_description, normalized.prometheus_rule_owner, normalized.prometheus_rule_runbook_url,
      requestId,
    ]);
    await this.event(requestId,actor,'DRAFT_UPDATED','DRAFT','DRAFT'); return this.read(requestId);
  }
  async submit(auth: string | undefined, requestId: string, input: { mrIid:number; commitSha:string }) {
    if (!Number.isInteger(input.mrIid) || input.mrIid < 1 || !/^[a-f0-9]{40}$/i.test(input.commitSha)) throw new BadRequestException('MR IID 或 Commit SHA 无效');
    const actor = await this.actor(auth); const row = await this.read(requestId); if (!this.owns(actor,row) || row.status !== 'DRAFT' || row.mr_iid || row.commit_sha) throw new ForbiddenException('当前状态不可提交');
    this.executionPolicy(row);
    if (row.resource_type !== 'ServiceMonitor') throw new BadRequestException(`${row.resource_type} 一期仅允许 Dashboard 托管生成受控 MR，不支持手工绑定`);
    await this.db.query('UPDATE monitoring_requests SET status=\'SUBMITTED\',mr_iid=?,commit_sha=?,approver_user_id=NULL,approval_comment=NULL,approved_at=NULL,updated_at=UTC_TIMESTAMP() WHERE request_id=?', [input.mrIid,input.commitSha.toLowerCase(),requestId]);
    await this.event(requestId,actor,'SUBMITTED',row.status,'SUBMITTED'); return this.read(requestId);
  }
  async submitManaged(auth: string | undefined, requestId: string) {
    const actor = await this.actor(auth); const row = await this.read(requestId);
    if (!this.owns(actor, row) || row.status !== 'DRAFT') throw new ForbiddenException('当前状态不可提交');
    if (row.mr_iid || row.commit_sha) throw new BadRequestException('该申请已绑定 GitLab MR；请使用手工绑定流程继续处理');
    if (row.resource_type === 'WorkloadBundle') this.workloadSubmissionPolicy(row);
    else this.executionPolicy(row);
    if (!['ServiceMonitor', 'PrometheusRule', 'WorkloadBundle'].includes(String(row.resource_type))) throw new BadRequestException('Dashboard 托管 MR 创建当前仅支持 ServiceMonitor、PrometheusRule 与工作负载资源包');
    await this.validateManagedResource(row);
    if (row.resource_type === 'WorkloadBundle') await this.assertWorkloadCreateOnly(row);
    const config = await this.gitlabMergeConfig();
    if (!config.enabled) throw new ServiceUnavailableException('GitLab 托管 MR 创建未启用');
    if (config.targetBranch !== row.target_branch) throw new BadRequestException('申请目标分支与当前 GitLab 受控合并配置不一致');
    const project = encodeURIComponent(config.projectId); const branch = this.managedBranch(requestId); const filePath = this.managedFilePath(row); const yaml = this.managedYaml(row);
    if (row.resource_type === 'PrometheusRule' || row.resource_type === 'WorkloadBundle') {
      const existingFile = await this.gitlabRequest<any>(config, 'get', `/projects/${project}/repository/files/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(config.targetBranch)}`);
      if (existingFile.status === 200) throw new BadRequestException(`目标分支已存在 ${filePath}；第一版仅允许新增，不允许覆盖`);
      if (existingFile.status !== 404) throw new ServiceUnavailableException(`无法读取 GitLab 目标分支中的 ${row.resource_type} 文件状态`);
    }
    const base = await this.gitlabRequest<any>(config, 'get', `/projects/${project}/repository/branches/${encodeURIComponent(config.targetBranch)}`);
    const baseSha = String(base.data?.commit?.id || '').toLowerCase();
    if (base.status !== 200 || !/^[a-f0-9]{40}$/.test(baseSha)) throw new ServiceUnavailableException('无法读取 GitLab 目标分支基线');
    const branchResponse = await this.gitlabRequest<any>(config, 'post', `/projects/${project}/repository/branches`, { branch, ref: baseSha });
    let sourceSha = '';
    if (![200, 201].includes(branchResponse.status)) {
      // Resume an interrupted request only when its deterministic branch contains exactly
      // the one generated YAML commit directly on the immutable target baseline.
      const existing = await this.gitlabRequest<any>(config, 'get', `/projects/${project}/repository/branches/${encodeURIComponent(branch)}`);
      const existingSha = String(existing.data?.commit?.id || '').toLowerCase();
      if (existing.status !== 200 || !/^[a-f0-9]{40}$/.test(existingSha)) {
        const detail = String(branchResponse.data?.message || branchResponse.data?.error || `HTTP ${branchResponse.status}`).slice(0, 800);
        await this.event(requestId, actor, 'GITLAB_MR_CREATE_FAILED', row.status, row.status, `创建受控分支失败：${detail}`);
        throw new BadRequestException(`创建受控 GitLab 分支失败：${detail}`);
      }
      if (existingSha !== baseSha) {
        const [file, commit] = await Promise.all([
          this.gitlabRequest<any>(config, 'get', `/projects/${project}/repository/files/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`),
          this.gitlabRequest<any>(config, 'get', `/projects/${project}/repository/commits/${existingSha}`),
        ]);
        const content = file.status === 200 && file.data?.encoding === 'base64' ? Buffer.from(String(file.data.content || ''), 'base64').toString('utf8') : '';
        const parents = Array.isArray(commit.data?.parent_ids) ? commit.data.parent_ids.map((x: unknown) => String(x).toLowerCase()) : [];
        if (content !== yaml || commit.status !== 200 || !parents.includes(baseSha)) {
          await this.event(requestId, actor, 'GITLAB_MR_CREATE_FAILED', row.status, row.status, '受控 GitLab 分支已存在但不符合可恢复的基线/YAML 状态');
          throw new BadRequestException('受控 GitLab 分支已存在但不符合可恢复的基线/YAML 状态');
        }
        sourceSha = existingSha;
      }
    }
    if (!sourceSha) {
      const commitTitle = row.resource_type === 'WorkloadBundle' ? `feat(k8s): add ${row.resource_name}` : `feat(monitoring): add ${row.resource_name}`;
      const fileResponse = await this.gitlabRequest<any>(config, 'post', `/projects/${project}/repository/files/${encodeURIComponent(filePath)}`, { branch, content: yaml, commit_message: commitTitle });
      sourceSha = String(fileResponse.data?.commit_id || fileResponse.data?.commit?.id || '').toLowerCase();
      // GitLab-compatible servers can return 201 without a top-level commit_id. A success
      // response is never trusted on its own: bind only after reading the branch HEAD and
      // generated file back, so the first click is both safe and idempotent.
      if ([200, 201].includes(fileResponse.status) && !/^[a-f0-9]{40}$/.test(sourceSha)) {
        const [writtenBranch, writtenFile] = await Promise.all([
          this.gitlabRequest<any>(config, 'get', `/projects/${project}/repository/branches/${encodeURIComponent(branch)}`),
          this.gitlabRequest<any>(config, 'get', `/projects/${project}/repository/files/${encodeURIComponent(filePath)}?ref=${encodeURIComponent(branch)}`),
        ]);
        const branchSha = String(writtenBranch.data?.commit?.id || '').toLowerCase();
        const content = writtenFile.status === 200 && writtenFile.data?.encoding === 'base64' ? Buffer.from(String(writtenFile.data.content || ''), 'base64').toString('utf8') : '';
        if (writtenBranch.status === 200 && /^[a-f0-9]{40}$/.test(branchSha) && content === yaml) sourceSha = branchSha;
      }
      if (![200, 201].includes(fileResponse.status) || !/^[a-f0-9]{40}$/.test(sourceSha)) {
        const detail = String(fileResponse.data?.message || fileResponse.data?.error || `HTTP ${fileResponse.status}`).slice(0, 800);
        await this.event(requestId, actor, 'GITLAB_MR_CREATE_FAILED', row.status, row.status, `写入受控 YAML 失败：${detail}`);
        throw new BadRequestException(`写入受控 GitLab YAML 失败：${detail}`);
      }
    }
    const description = `Dashboard 托管的${row.resource_type === 'WorkloadBundle' ? '工作负载资源' : '监控资源'}申请。\n\nDashboard-Request-ID: ${requestId}`;
    const mrTitle = row.resource_type === 'WorkloadBundle' ? `feat(k8s): add ${row.resource_name}` : `feat(monitoring): add ${row.resource_name}`;
    const mrResponse = await this.gitlabRequest<any>(config, 'post', `/projects/${project}/merge_requests`, { source_branch: branch, target_branch: config.targetBranch, title: mrTitle, description });
    let mrIid = Number(mrResponse.data?.iid); let mrSha = String(mrResponse.data?.sha || '').toLowerCase();
    if (mrResponse.status !== 201 || !Number.isInteger(mrIid) || mrIid < 1 || mrSha !== sourceSha) {
      // If an earlier call created the MR but the response was lost, recover only the exact binding.
      const existingMrs = await this.gitlabRequest<any[]>(config, 'get', `/projects/${project}/merge_requests?state=opened&source_branch=${encodeURIComponent(branch)}&target_branch=${encodeURIComponent(config.targetBranch)}`);
      const existingMr = Array.isArray(existingMrs.data) && existingMrs.data.find(m => String(m?.sha || '').toLowerCase() === sourceSha && String(m?.description || '').includes(`Dashboard-Request-ID: ${requestId}`));
      mrIid = Number(existingMr?.iid); mrSha = String(existingMr?.sha || '').toLowerCase();
      if (existingMrs.status !== 200 || !Number.isInteger(mrIid) || mrIid < 1 || mrSha !== sourceSha) {
        const detail = String(mrResponse.data?.message || mrResponse.data?.error || `HTTP ${mrResponse.status}`).slice(0, 800);
        await this.event(requestId, actor, 'GITLAB_MR_CREATE_FAILED', row.status, row.status, `创建受控 MR 失败：${detail}`);
        throw new BadRequestException(`创建受控 GitLab MR 失败：${detail}`);
      }
    }
    const storedResourcePath = row.resource_type === 'WorkloadBundle'
      ? filePath
      : this.resourcePath(String(row.app_id), String(row.repository_environment_path));
    await this.db.query("UPDATE monitoring_requests SET status='SUBMITTED',resource_path=?,mr_iid=?,commit_sha=?,approver_user_id=NULL,approval_comment=NULL,approved_at=NULL,updated_at=UTC_TIMESTAMP() WHERE request_id=?", [storedResourcePath, mrIid, sourceSha, requestId]);
    await this.event(requestId, actor, 'GITLAB_MR_CREATED', row.status, 'SUBMITTED', `MR !${mrIid}；分支 ${branch}；${filePath}`);
    await this.event(requestId, actor, 'SUBMITTED', row.status, 'SUBMITTED', 'Dashboard 已创建并绑定受控 GitLab MR');
    return this.read(requestId);
  }

  async decide(auth: string | undefined, requestId: string, status: 'APPROVED'|'REJECTED', comment?: string) {
    const actor = await this.actor(auth); if (!this.can(actor, APPROVE)) throw new ForbiddenException(`Missing permissions: ${APPROVE}`); let row=await this.read(requestId);
    if (row.status !== 'SUBMITTED') throw new BadRequestException('仅已提交申请可审批'); if (this.owns(actor,row)) throw new ForbiddenException('申请人不能审批自己的申请');
    // Approval is intentionally non-mutating for GitLab. The approver authorizes the change;
    // a later explicit Preview action performs the controlled merge and immediately validates
    // the resulting immutable merge commit before any Jenkins execution is queued.
    await this.db.query('UPDATE monitoring_requests SET status=?,approver_user_id=?,approval_comment=?,approved_at=IF(?=\'APPROVED\',UTC_TIMESTAMP(),NULL),updated_at=UTC_TIMESTAMP() WHERE request_id=?', [status, actor.userId, comment?.trim() || null, status, requestId]);
    await this.event(requestId,actor,status === 'APPROVED' ? 'APPROVED' : 'REJECTED','SUBMITTED',status,comment); return this.read(requestId);
  }
  /** A separate approval creates one short-lived real-apply grant. */
  async grantRealApply(auth: string | undefined, requestId: string, validMinutes: number, comment?: string) {
    const actor = await this.actor(auth);
    if (!this.can(actor, APPROVE)) throw new ForbiddenException(`Missing permissions: ${APPROVE}`);
    if (!Number.isInteger(validMinutes) || validMinutes < REAL_APPLY_MINUTES || validMinutes > REAL_APPLY_MAX_MINUTES) {
      throw new BadRequestException(`真实 Apply 授权有效期必须为 ${REAL_APPLY_MINUTES}-${REAL_APPLY_MAX_MINUTES} 分钟`);
    }
    const row = await this.read(requestId);
    if (row.resource_type === 'WorkloadBundle') throw new BadRequestException('工作负载资源包不使用平台 Bootstrap Jenkins 授权');
    this.executionPolicy(row);
    if (row.status !== 'APPROVED') throw new BadRequestException('仅已批准申请可授予真实 Apply 权限');
    if (this.owns(actor, row)) throw new ForbiddenException('申请人不能授予自己的真实 Apply 权限');
    await this.db.withTransaction(async conn => {
      await conn.execute('UPDATE monitoring_real_apply_authorizations SET revoked_at=UTC_TIMESTAMP() WHERE request_id=? AND consumed_at IS NULL AND revoked_at IS NULL', [requestId]);
      await conn.execute('INSERT INTO monitoring_real_apply_authorizations (request_id,mr_iid,commit_sha,granted_by_user_id,comment,expires_at,created_at) VALUES (?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE),UTC_TIMESTAMP())', [requestId, Number(row.mr_iid), String(row.commit_sha).toLowerCase(), actor.userId, comment?.trim() || null, validMinutes]);
      const auditComment = '有效期 ' + validMinutes + ' 分钟' + (comment?.trim() ? '：' + comment.trim() : '');
      await conn.execute('INSERT INTO monitoring_request_events (request_id,event_type,actor_user_id,actor_username,from_status,to_status,comment,created_at) VALUES (?,?,?,?,?,?,?,UTC_TIMESTAMP())', [requestId, 'REAL_APPLY_GRANTED', actor.userId, actor.username, 'APPROVED', 'APPROVED', auditComment]);
    });
    return { authorized: true, requestId, validMinutes };
  }
  /** Read-only preflight proves a matching one-time grant still exists. */
  async authorizeRealApplyPreflight(requestId: string, input: { mrIid: number; commitSha: string }, token?: string) {
    if (!(await this.approvalTokenMatches(token))) throw new UnauthorizedException('Invalid Jenkins approval token');
    const request = await this.read(requestId);
    if (request.resource_type === 'WorkloadBundle') throw new ForbiddenException('WorkloadBundle does not use the platform Bootstrap Jenkins executor');
    this.executionPolicy(request);
    const rows = await this.db.query<any[]>(`SELECT r.status,a.mr_iid,a.commit_sha FROM monitoring_requests r JOIN monitoring_real_apply_authorizations a ON a.request_id=r.request_id WHERE r.request_id=? AND a.consumed_at IS NULL AND a.revoked_at IS NULL AND a.expires_at > UTC_TIMESTAMP() ORDER BY a.id DESC LIMIT 1`, [requestId]);
    const row = rows[0];
    if (!row || row.status !== 'APPROVED') throw new ForbiddenException('No active real Apply authorization for this approved request');
    if (Number(row.mr_iid) !== input.mrIid || String(row.commit_sha).toLowerCase() !== input.commitSha.toLowerCase()) throw new ForbiddenException('Real Apply authorization MR IID/Commit SHA binding does not match this build');
    return { authorized: true, requestId, mrIid: Number(row.mr_iid), commitSha: String(row.commit_sha), dryRun: false };
  }
  /** Jenkins calls this immediately before the only mutating kubectl command. */
  async consumeRealApplyAuthorization(requestId: string, input: { mrIid: number; commitSha: string }, token?: string) {
    if (!(await this.approvalTokenMatches(token))) throw new UnauthorizedException('Invalid Jenkins approval token');
    const request = await this.read(requestId);
    if (request.resource_type === 'WorkloadBundle') throw new ForbiddenException('WorkloadBundle does not use the platform Bootstrap Jenkins executor');
    this.executionPolicy(request);
    return this.db.withTransaction(async conn => {
      const [rows] = await conn.execute<any[]>('SELECT r.status,a.id,a.mr_iid,a.commit_sha FROM monitoring_requests r JOIN monitoring_real_apply_authorizations a ON a.request_id=r.request_id WHERE r.request_id=? AND a.consumed_at IS NULL AND a.revoked_at IS NULL ORDER BY a.id DESC LIMIT 1 FOR UPDATE', [requestId]);
      const row = rows[0];
      if (!row || row.status !== 'APPROVED') throw new ForbiddenException('No active real Apply authorization for this approved request');
      if (Number(row.mr_iid) !== input.mrIid || String(row.commit_sha).toLowerCase() !== input.commitSha.toLowerCase()) throw new ForbiddenException('Real Apply authorization MR IID/Commit SHA binding does not match this build');
      const [result] = await conn.execute<any>('UPDATE monitoring_real_apply_authorizations SET consumed_at=UTC_TIMESTAMP() WHERE id=? AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP()', [row.id]);
      if (Number(result.affectedRows) !== 1) throw new ForbiddenException('Real Apply authorization is expired, revoked, or already consumed');
      await conn.execute('INSERT INTO monitoring_real_apply_executions (request_id,authorization_id,mr_iid,commit_sha,executed_by,created_at) VALUES (?,?,?,?,?,UTC_TIMESTAMP())', [requestId, row.id, Number(row.mr_iid), String(row.commit_sha).toLowerCase(), 'jenkins']);
      return { authorized: true, requestId, mrIid: Number(row.mr_iid), commitSha: String(row.commit_sha), dryRun: false };
    });
  }
  /**
   * Called only by Jenkins before it runs a pipeline. This is deliberately
   * read-only and preview-only: a missing secret, changed MR/SHA, withdrawn
   * request, or DRY_RUN=false is rejected before any cluster command can run.
   */
  async authorizeDryRun(requestId: string, input: { mrIid: number; commitSha: string; dryRun: boolean }, token?: string) {
    if (!(await this.approvalTokenMatches(token))) throw new UnauthorizedException('Invalid Jenkins approval token');
    if (input.dryRun !== true) throw new ForbiddenException('Dashboard authorization is preview-only; DRY_RUN must be true');
    const row = await this.read(requestId);
    if (row.resource_type === 'WorkloadBundle') throw new ForbiddenException('WorkloadBundle does not use the platform Bootstrap Jenkins executor');
    this.executionPolicy(row);
    if (row.status !== 'APPROVED') throw new ForbiddenException(`Request status must be APPROVED, received ${row.status}`);
    if (Number(row.mr_iid) !== input.mrIid || String(row.commit_sha).toLowerCase() !== input.commitSha.toLowerCase()) {
      throw new ForbiddenException('Approved MR IID/Commit SHA binding does not match this build');
    }
    return { authorized: true, requestId: row.request_id, mrIid: Number(row.mr_iid), commitSha: String(row.commit_sha), dryRun: true, approvedAt: row.approved_at };
  }
  private async gitlabMergeConfig() {
    const enabled = await this.siteConf.getBoolean('monitoring.requests.gitlab.merge.enabled', false);
    const baseUrl = (await this.siteConf.getString('monitoring.requests.gitlab.base_url', '')).trim().replace(/\/+$/, '');
    const projectId = (await this.siteConf.getString('monitoring.requests.gitlab.project_id', '')).trim();
    const botToken = (await this.siteConf.getString('monitoring.requests.gitlab.bot_token', '')).trim();
    const targetBranch = (await this.siteConf.getString('monitoring.requests.gitlab.target_branch', 'hash-jenkins')).trim();
    const timeoutMs = Math.min(GITLAB_TIMEOUT_MAX_MS, Math.max(GITLAB_TIMEOUT_MIN_MS, await this.siteConf.getNumber('monitoring.requests.gitlab.timeout_ms', 15_000)));
    if (!enabled) return { enabled: false as const };
    if (!/^https?:\/\/[A-Za-z0-9._:-]+(?:\/api\/v4)?$/.test(baseUrl) || !/^\d+$/.test(projectId) || !botToken || targetBranch !== 'hash-jenkins') {
      throw new ServiceUnavailableException('GitLab 受控自动合并器未完成配置');
    }
    return { enabled: true as const, baseUrl, projectId, botToken, targetBranch, timeoutMs };
  }
  private async gitlabRequest<T>(config: Extract<Awaited<ReturnType<MonitoringRequestsService['gitlabMergeConfig']>>, { enabled: true }>, method: 'get'|'post'|'put', path: string, data?: unknown) {
    return axios.request<T>({ method, url: config.baseUrl + path, timeout: config.timeoutMs, headers: { 'PRIVATE-TOKEN': config.botToken }, data, validateStatus: () => true });
  }
  private async closeWithdrawnRequestMr(row: any, actor: Actor) {
    if (!row.mr_iid || !row.commit_sha) return;
    const config = await this.gitlabMergeConfig();
    if (!config.enabled) throw new ServiceUnavailableException('GitLab 受控自动合并器未完成配置');
    const project = encodeURIComponent(config.projectId);
    const mrPath = `/projects/${project}/merge_requests/${Number(row.mr_iid)}`;
    const current = await this.gitlabRequest<any>(config, 'get', mrPath);
    const mr = current.data;
    const bound = current.status === 200 && mr?.target_branch === config.targetBranch
      && String(mr?.sha || '').toLowerCase() === String(row.commit_sha).toLowerCase()
      && String(mr?.description || '').includes(`Dashboard-Request-ID: ${row.request_id}`);
    if (!bound || !['opened', 'closed'].includes(mr?.state)) {
      throw new BadRequestException('GitLab MR 不满足受控撤回条件（必须为 Open 或已关闭，且目标分支/SHA/申请标记完全匹配）');
    }
    if (mr.state === 'closed') return;
    const closed = await this.gitlabRequest<any>(config, 'put', mrPath, { state_event: 'close' });
    if (closed.status !== 200) {
      const detail = String(closed.data?.message || closed.data?.error || `HTTP ${closed.status}`).slice(0, 800);
      await this.event(row.request_id, actor, 'GITLAB_MR_CLOSE_FAILED', row.status, row.status, `GitLab 关闭 MR 失败：${detail}`);
      throw new BadRequestException(`GitLab 关闭 MR 失败：${detail}`);
    }
    const verified = await this.gitlabRequest<any>(config, 'get', mrPath);
    if (verified.status !== 200 || verified.data?.state !== 'closed' || verified.data?.target_branch !== config.targetBranch
      || String(verified.data?.sha || '').toLowerCase() !== String(row.commit_sha).toLowerCase()
      || !String(verified.data?.description || '').includes(`Dashboard-Request-ID: ${row.request_id}`)) {
      await this.event(row.request_id, actor, 'GITLAB_MR_CLOSE_FAILED', row.status, row.status, 'GitLab 关闭 MR 后回读校验失败');
      throw new BadRequestException('GitLab 关闭 MR 后回读校验失败；未撤回该申请');
    }
    await this.event(row.request_id, actor, 'GITLAB_MR_CLOSED', row.status, row.status, `GitLab MR !${row.mr_iid} 已受控关闭`);
  }

  private async mergeApprovedRequest(row: any, actor: Actor) {
    const config = await this.gitlabMergeConfig();
    if (!config.enabled) return row;
    const project = encodeURIComponent(config.projectId);
    const mrPath = `/projects/${project}/merge_requests/${Number(row.mr_iid)}`;
    const mrResponse = await this.gitlabRequest<any>(config, 'get', mrPath);
    const mr = mrResponse.data;
    const sourceSha = String(row.commit_sha).toLowerCase();
    const marker = `Dashboard-Request-ID: ${row.request_id}`;
    const bound = mrResponse.status === 200 && mr?.target_branch === config.targetBranch && String(mr?.sha || '').toLowerCase() === sourceSha && String(mr?.description || '').includes(marker);
    if (!bound || !['opened', 'merged'].includes(mr?.state)) {
      throw new BadRequestException('GitLab MR 不满足受控合并条件（目标分支/SHA/申请标记完全匹配，且状态必须为 Open 或已合并）');
    }
    if (mr.state === 'opened') {
      const merged = await this.gitlabRequest<any>(config, 'put', `${mrPath}/merge`, { sha: sourceSha, should_remove_source_branch: false });
      if (![200, 201].includes(merged.status)) {
        const detail = String(merged.data?.message || merged.data?.error || `HTTP ${merged.status}`).slice(0, 800);
        await this.event(row.request_id, actor, 'GITLAB_MERGE_FAILED', 'SUBMITTED', 'SUBMITTED', `GitLab 合并失败：${detail}`);
        throw new BadRequestException(`GitLab 合并失败：${detail}`);
      }
    }
    // GitLab's merge endpoint can return before a subsequent GET observes the merged state.
    // A retry is safe: a matching already-merged MR is reconciled rather than merged again.
    const verified = await this.gitlabRequest<any>(config, 'get', mrPath);
    const mergeSha = String(verified.data?.merge_commit_sha || verified.data?.squash_commit_sha || '').toLowerCase();
    if (verified.status !== 200 || verified.data?.state !== 'merged' || verified.data?.target_branch !== config.targetBranch || !/^[a-f0-9]{40}$/.test(mergeSha)) {
      await this.event(row.request_id, actor, 'GITLAB_MERGE_FAILED', 'SUBMITTED', 'SUBMITTED', 'GitLab 合并后回读未得到有效 merged 状态或 merge commit SHA');
      throw new BadRequestException('GitLab 合并后回读校验失败；未批准该申请');
    }
    const mergedAt = new Date(String(verified.data.merged_at || ''));
    if (Number.isNaN(mergedAt.getTime())) {
      await this.event(row.request_id, actor, 'GITLAB_MERGE_FAILED', 'APPROVED', 'APPROVED', 'GitLab 合并后回读未得到有效 merged_at 时间');
      throw new BadRequestException('GitLab 合并后回读校验失败；未得到有效合并时间');
    }
    return { ...row, commit_sha: mergeSha, gitlab_merged_at: mergedAt, gitlab_merge_commit_sha: mergeSha };
  }

  async mergeWorkload(auth: string | undefined, requestId: string) {
    const actor = await this.actor(auth);
    const row = await this.read(requestId);
    this.assertRead(actor, row);
    if (row.resource_type !== 'WorkloadBundle') throw new BadRequestException('仅工作负载资源包可使用该操作');
    if (row.status !== 'APPROVED' || !row.mr_iid || !row.commit_sha) throw new BadRequestException('申请必须已批准并绑定受控 MR/SHA');
    await this.validateManagedResource(row);
    await this.assertWorkloadCreateOnly(row);
    const config = await this.gitlabMergeConfig();
    if (!config.enabled) throw new ServiceUnavailableException('GitLab 受控自动合并器未启用');
    const merged = await this.mergeApprovedRequest(row, actor);
    const updated = await this.db.query<any>(`UPDATE monitoring_requests SET
      status='MERGED_PENDING_DEPLOY',commit_sha=?,gitlab_merged_at=?,gitlab_merge_commit_sha=?,gitlab_merge_error=NULL,
      workload_last_check_json=NULL,workload_last_checked_at=NULL,updated_at=UTC_TIMESTAMP()
      WHERE request_id=? AND status='APPROVED'`, [merged.commit_sha, merged.gitlab_merged_at, merged.gitlab_merge_commit_sha, requestId]);
    if (Number(updated.affectedRows) !== 1) throw new BadRequestException('申请状态已发生变化，请刷新后重试');
    await this.event(requestId, actor, 'GITLAB_MERGED', 'APPROVED', 'MERGED_PENDING_DEPLOY', `GitLab MR !${row.mr_iid} 已合并；下一步运行服务发布 Job ${row.workload_service_job_name}`);
    return this.read(requestId);
  }

  async refreshWorkloadStatus(auth: string | undefined, requestId: string) {
    const actor = await this.actor(auth);
    const row = await this.read(requestId);
    this.assertRead(actor, row);
    if (row.resource_type !== 'WorkloadBundle') throw new BadRequestException('仅工作负载资源包可检查首次发布状态');
    if (!['MERGED_PENDING_DEPLOY', 'COMPLETED'].includes(String(row.status))) throw new BadRequestException('请先批准并合并工作负载配置');
    let workloadStatus;
    try {
      workloadStatus = await this.kubernetes.getWorkloadBundleStatus(
        String(row.environment_id), String(row.workload_deployment_name), String(row.workload_service_name), String(row.workload_namespace || 'default'),
      );
    } catch (error: any) {
      throw new ServiceUnavailableException(`无法读取 ${row.environment_id} 集群中的工作负载状态：${String(error?.message || error).slice(0, 500)}`);
    }
    const nextStatus = workloadStatus.phase === 'completed' ? 'COMPLETED' : row.status;
    await this.db.query('UPDATE monitoring_requests SET status=?,workload_last_check_json=?,workload_last_checked_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE request_id=?', [nextStatus, JSON.stringify(workloadStatus), requestId]);
    if (row.status === 'MERGED_PENDING_DEPLOY' && nextStatus === 'COMPLETED') {
      await this.event(requestId, actor, 'WORKLOAD_READY', 'MERGED_PENDING_DEPLOY', 'COMPLETED', `Deployment/${row.workload_deployment_name} 已完成 rollout，Service/${row.workload_service_name} 已有 Ready endpoints`);
    }
    return this.read(requestId);
  }

  private async jenkinsConfig(executorKey: string) {
    const policy = getMonitoringEnvironmentPolicyByExecutorKey(executorKey);
    if (!policy?.executionEnabled) throw new ServiceUnavailableException(`Jenkins 执行器 ${executorKey} 尚未开放`);
    const prefix = `monitoring.requests.executors.${policy.executorKey}`;
    if (!(await this.siteConf.getBoolean(`${prefix}.enabled`, false))) throw new ServiceUnavailableException(`Jenkins 执行器 ${policy.executorKey} 未启用`);
    const baseUrl = (await this.siteConf.getString(`${prefix}.base_url`, '')).trim().replace(/\/+$/, '');
    const username = (await this.siteConf.getString(`${prefix}.username`, '')).trim();
    const apiToken = (await this.siteConf.getString(`${prefix}.api_token`, '')).trim();
    const jobName = (await this.siteConf.getString(`${prefix}.job_name`, policy.jenkinsJobName)).trim();
    const timeoutMs = Math.min(JENKINS_TIMEOUT_MAX_MS, Math.max(JENKINS_TIMEOUT_MIN_MS, await this.siteConf.getNumber(`${prefix}.timeout_ms`, 15_000)));
    if (!baseUrl || !username || !apiToken || jobName !== policy.jenkinsJobName) throw new ServiceUnavailableException(`Jenkins 执行器 ${policy.executorKey} 未完成配置`);
    if (!/^https?:\/\/[A-Za-z0-9._:-]+$/.test(baseUrl)) throw new ServiceUnavailableException('Jenkins 地址配置无效');
    return { executorKey: policy.executorKey, baseUrl, username, apiToken, jobName, timeoutMs };
  }
  private async jenkinsRequest<T>(c: { baseUrl: string; username: string; apiToken: string; timeoutMs: number }, method: 'get'|'post', path: string, config: any = {}) {
    return axios.request<T>({ method, url: c.baseUrl + path, auth: { username: c.username, password: c.apiToken }, timeout: c.timeoutMs, validateStatus: () => true, ...config });
  }
  private extractDiff(consoleText: string) {
    const completed = consoleText.indexOf('DRY_RUN=true:');
    if (completed < 0) return null;
    const start = consoleText.indexOf('diff -u -N ');
    if (start < 0 || start > completed) return '# No server-side changes detected.\n';
    const diff = consoleText.slice(start, completed).replace(/\/tmp\/[A-Za-z0-9._-]+/g, '<server-dry-run>');
    return diff.length <= 200_000 ? diff : null;
  }
  private async refreshExecutionRecord(ex: any, actor?: Actor) {
    const c = await this.jenkinsConfig(String(ex.executor_key || 'hash-jenkins'));
    if (String(ex.job_name || c.jobName) !== c.jobName) throw new ServiceUnavailableException('执行记录绑定的 Jenkins Job 与受控配置不一致');
    if (!ex.build_number) {
      const q = await this.jenkinsRequest<any>(c, 'get', `/queue/item/${ex.queue_id}/api/json`);
      const n = Number(q.data?.executable?.number);
      if (n) {
        await this.db.query('UPDATE monitoring_jenkins_executions SET build_number=?,status="RUNNING",updated_at=UTC_TIMESTAMP() WHERE id=?', [n, ex.id]);
        ex = { ...ex, build_number: n, status: 'RUNNING' };
      }
    }
    if (!ex.build_number) return ex;
    const mustReadConsole = ex.mode === 'preview' && ex.status === 'SUCCESS' && !ex.diff_text;
    if (!mustReadConsole && ['SUCCESS', 'FAILURE', 'ABORTED'].includes(ex.status)) return ex;
    const jobPath = `/job/${encodeURIComponent(c.jobName)}`;
    const b = await this.jenkinsRequest<any>(c, 'get', `${jobPath}/${ex.build_number}/api/json`);
    if (b.data?.building) return ex;
    const status = String(b.data?.result || 'FAILURE');
    const log = (await this.jenkinsRequest<string>(c, 'get', `${jobPath}/${ex.build_number}/consoleText`, { responseType: 'text' })).data || '';
    const diff = ex.mode === 'preview' && status === 'SUCCESS' ? this.extractDiff(log) : null;
    await this.db.query('UPDATE monitoring_jenkins_executions SET status=?,diff_text=?,finished_at=COALESCE(finished_at,UTC_TIMESTAMP()),updated_at=UTC_TIMESTAMP() WHERE id=?', [status, diff, ex.id]);
    if (actor && !['SUCCESS', 'FAILURE', 'ABORTED'].includes(ex.status) && ['SUCCESS', 'FAILURE', 'ABORTED'].includes(status)) {
      if (ex.mode === 'apply' && status === 'SUCCESS') {
        // COMPLETED is a terminal business state: only an actual successful mutating
        // Jenkins build may transition an approved request into it.
        const updated = await this.db.query<any>("UPDATE monitoring_requests SET status='COMPLETED',updated_at=UTC_TIMESTAMP() WHERE request_id=? AND status='APPROVED'", [ex.request_id]);
        if (Number(updated.affectedRows) === 1) {
          await this.event(ex.request_id, actor, 'REAL_APPLY_SUCCEEDED', 'APPROVED', 'COMPLETED', `Jenkins #${ex.build_number} SUCCESS`);
        }
      } else {
        await this.event(ex.request_id, actor, status === 'SUCCESS' ? 'PREVIEW_SUCCEEDED' : (ex.mode === 'preview' ? 'PREVIEW_FAILED' : 'REAL_APPLY_FAILED'), 'APPROVED', 'APPROVED', `Jenkins #${ex.build_number} ${status}`);
      }
    }
    return { ...ex, status, diff_text: diff, finished_at: ex.finished_at || new Date() };
  }
  private async refreshMatchingPreview(requestId: string, mrIid: number, commitSha: string) {
    const rows = await this.db.query<any[]>('SELECT * FROM monitoring_jenkins_executions WHERE request_id=? AND mode="preview" AND mr_iid=? AND commit_sha=? AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE) AND (status NOT IN ("SUCCESS","FAILURE","ABORTED") OR diff_text IS NULL) ORDER BY id DESC', [requestId, mrIid, commitSha]);
    for (const execution of rows) await this.refreshExecutionRecord(execution);
  }
  async startDashboardExecution(auth: string | undefined, requestId: string, mode: 'preview'|'apply', comment?: string, confirmation?: string) {
    const actor = await this.actor(auth); let row = await this.read(requestId); this.assertRead(actor, row);
    if (row.resource_type === 'WorkloadBundle') throw new BadRequestException('工作负载资源包不使用平台 Bootstrap Jenkins Job；请合并后由正常服务 Job 首次发布');
    this.executionPolicy(row);
    if (row.status !== 'APPROVED' || !row.mr_iid || !row.commit_sha) throw new BadRequestException('申请必须为已批准且已绑定 MR/SHA');
    const gitlab = await this.gitlabMergeConfig();
    if (mode === 'preview') await this.validateManagedResource(row);
    if (gitlab.enabled && mode === 'preview' && (!row.gitlab_merged_at || String(row.gitlab_merge_commit_sha || '').toLowerCase() !== String(row.commit_sha).toLowerCase())) {
      const merged = await this.mergeApprovedRequest(row, actor);
      await this.db.query('UPDATE monitoring_requests SET commit_sha=?,gitlab_merged_at=?,gitlab_merge_commit_sha=?,gitlab_merge_error=NULL,updated_at=UTC_TIMESTAMP() WHERE request_id=?', [merged.commit_sha, merged.gitlab_merged_at, merged.gitlab_merge_commit_sha, requestId]);
      await this.event(requestId, actor, 'GITLAB_MERGED', 'APPROVED', 'APPROVED', `GitLab MR !${row.mr_iid} 已受控合并；commit ${merged.gitlab_merge_commit_sha}`);
      row = await this.read(requestId);
    }
    if (gitlab.enabled && (!row.gitlab_merged_at || String(row.gitlab_merge_commit_sha || '').toLowerCase() !== String(row.commit_sha).toLowerCase())) {
      throw new BadRequestException('请先通过“生成最终 Diff”完成受控 GitLab 合并，再确认真实执行');
    }
    let applyGrantCreated = false;
    if (mode === 'apply') {
      if (!this.can(actor, APPROVE) || this.owns(actor, row)) throw new ForbiddenException('仅非申请人的审批人可确认真实执行');
      if (confirmation !== 'APPLY' || !comment?.trim()) throw new BadRequestException('真实执行需要输入 APPLY 并填写确认说明');
      // Refresh matching previews here as well as from the UI. A Jenkins build can
      // finish between UI polls; the Apply gate must never reject a completed valid preview
      // merely because the browser has not manually refreshed it yet.
      await this.refreshMatchingPreview(requestId, Number(row.mr_iid), String(row.commit_sha).toLowerCase());
      const preview = await this.db.query<any[]>('SELECT * FROM monitoring_jenkins_executions WHERE request_id=? AND mode="preview" AND status="SUCCESS" AND mr_iid=? AND commit_sha=? AND diff_text IS NOT NULL AND created_at > DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE) ORDER BY id DESC LIMIT 1', [requestId, row.mr_iid, String(row.commit_sha).toLowerCase()]);
      if (!preview[0]) throw new BadRequestException('当前 MR/SHA 尚无 30 分钟内成功的最终 Diff 预检');
    } else if (!this.owns(actor, row) && !this.can(actor, APPROVE) && !this.can(actor, MANAGE)) throw new ForbiddenException('无权发起预检');
    const c = await this.jenkinsConfig(String(row.executor_key));
    const crumb = await this.jenkinsRequest<any>(c, 'get', '/crumbIssuer/api/json');
    if (crumb.status !== 200 || !crumb.data?.crumbRequestField || !crumb.data?.crumb) throw new ServiceUnavailableException('Jenkins crumb 获取失败');
    if (mode === 'apply') { await this.grantRealApply(auth, requestId, 15, `Dashboard 确认真实执行；预检已通过；${comment!.trim()}`); applyGrantCreated = true; }
    const params = new URLSearchParams({ REQUEST_ID: requestId, MR_IID: String(row.mr_iid), COMMIT_SHA: String(row.commit_sha), APPLICATION_ID: String(row.app_id), TARGET_BRANCH: String(row.target_branch), DRY_RUN: mode === 'preview' ? 'true' : 'false' });
    let queued: any;
    try { queued = await this.jenkinsRequest<any>(c, 'post', `/job/${encodeURIComponent(c.jobName)}/buildWithParameters`, { data: params.toString(), headers: { [crumb.data.crumbRequestField]: crumb.data.crumb, 'content-type': 'application/x-www-form-urlencoded' }, maxRedirects: 0 }); }
    catch (err) { if (applyGrantCreated) await this.db.query('UPDATE monitoring_real_apply_authorizations SET revoked_at=UTC_TIMESTAMP() WHERE request_id=? AND consumed_at IS NULL AND revoked_at IS NULL', [requestId]); throw err; }
    const queueUrl = String(queued.headers?.location || '');
    const queueId = Number((queueUrl.match(/\/queue\/item\/(\d+)/) || [])[1]);
    if (![201, 302].includes(queued.status) || !Number.isInteger(queueId)) { if (applyGrantCreated) await this.db.query('UPDATE monitoring_real_apply_authorizations SET revoked_at=UTC_TIMESTAMP() WHERE request_id=? AND consumed_at IS NULL AND revoked_at IS NULL', [requestId]); throw new ServiceUnavailableException('Jenkins 未接受构建请求'); }
    const result = await this.db.query<any>('INSERT INTO monitoring_jenkins_executions (request_id,mode,mr_iid,commit_sha,application_id,executor_key,job_name,queue_id,status,requested_by_user_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,"QUEUED",?,UTC_TIMESTAMP(),UTC_TIMESTAMP())', [requestId, mode, row.mr_iid, String(row.commit_sha).toLowerCase(), row.app_id, c.executorKey, c.jobName, queueId, actor.userId]);
    await this.event(requestId, actor, mode === 'preview' ? 'PREVIEW_QUEUED' : 'REAL_APPLY_QUEUED', 'APPROVED', 'APPROVED', `Jenkins 队列 #${queueId}`);
    return { id: Number(result.insertId), mode, queueId, status: 'QUEUED' };
  }
  async refreshDashboardExecution(auth: string | undefined, requestId: string, id: number) {
    const actor = await this.actor(auth); const row = await this.read(requestId); this.assertRead(actor, row);
    const rows = await this.db.query<any[]>('SELECT * FROM monitoring_jenkins_executions WHERE id=? AND request_id=? LIMIT 1', [id, requestId]);
    if (!rows[0]) throw new NotFoundException('执行记录不存在');
    await this.refreshExecutionRecord(rows[0], actor);
    return (await this.db.query<any[]>('SELECT id,mode,mr_iid,commit_sha,application_id,executor_key,job_name,queue_id,build_number,status,diff_text,created_at,updated_at,finished_at FROM monitoring_jenkins_executions WHERE id=?', [id]))[0];
  }
  async listDashboardExecutions(auth: string | undefined, requestId: string) { const actor=await this.actor(auth); const row=await this.read(requestId); this.assertRead(actor,row); return this.db.query<any[]>('SELECT id,mode,mr_iid,commit_sha,application_id,executor_key,job_name,queue_id,build_number,status,diff_text,created_at,updated_at,finished_at FROM monitoring_jenkins_executions WHERE request_id=? ORDER BY id DESC',[requestId]); }
  async withdraw(auth: string | undefined, requestId: string, comment?: string) {
    const actor=await this.actor(auth); const row=await this.read(requestId); if (!this.owns(actor,row) || !['DRAFT','SUBMITTED','REJECTED'].includes(row.status)) throw new ForbiddenException('当前状态不可撤回');
    // For a bound request, close the exact Open MR first. Dashboard status changes only
    // after GitLab confirms closure; a manually closed matching MR is safely idempotent.
    await this.closeWithdrawnRequestMr(row, actor);
    await this.db.query('UPDATE monitoring_requests SET status=\'WITHDRAWN\',updated_at=UTC_TIMESTAMP() WHERE request_id=?',[requestId]); await this.event(requestId,actor,'WITHDRAWN',row.status,'WITHDRAWN',comment); return this.read(requestId);
  }
}
