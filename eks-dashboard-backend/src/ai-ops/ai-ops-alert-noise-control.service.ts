import { HttpService } from '@nestjs/axios';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { firstValueFrom } from 'rxjs';
import type * as mysql from 'mysql2/promise';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { MfaVerificationService } from '../auth/mfa-verification.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import type { AlertmanagerPayload } from '../oncall/oncall.types';

type Actor = { userId: number | null; username: string; permissions: string[] };
type Scope = 'RESOURCE' | 'NAMESPACE' | 'ENVIRONMENT';
type Matcher = { name: string; value: string; isRegex: false; isEqual: true };
const DURATIONS = new Set([30, 60, 120, 240, 480, 1440]);

@Injectable()
export class AiOpsAlertNoiseControlService {
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly siteConf: SiteConfService,
    private readonly mfa: MfaVerificationService,
    private readonly http: HttpService,
  ) {}

  async suppresses(environmentId: string, labels: Record<string, unknown>) {
    const rows = await this.db.query<
      Array<{ id: number; matchers_json: unknown }>
    >(
      `SELECT id, matchers_json FROM aiops_alert_suppressions
       WHERE environment_id=? AND cancelled_at IS NULL AND starts_at<=UTC_TIMESTAMP() AND ends_at>UTC_TIMESTAMP()`,
      [environmentId],
    );
    const match = rows.find((row) => this.matches(row.matchers_json, labels));
    if (!match) return false;
    await this.db.query(
      'UPDATE aiops_alert_suppressions SET hit_count=hit_count+1, last_hit_at=UTC_TIMESTAMP(), updated_at=UTC_TIMESTAMP() WHERE id=?',
      [match.id],
    );
    return true;
  }

  async preview(
    environmentId: string,
    actor: Actor,
    investigationId: number,
    scope: Scope,
    durationMinutes: number,
    mode: 'LOCAL' | 'ALERTMANAGER' = 'LOCAL',
  ) {
    this.assertPermission(
      actor,
      mode === 'ALERTMANAGER' ? 'aiops:alert:silence' : 'aiops:alert:suppress',
    );
    const context = await this.context(environmentId, investigationId);
    const matchers = this.buildMatchers(
      context.labels,
      environmentId,
      scope,
      mode === 'ALERTMANAGER',
    );
    this.assertDuration(durationMinutes);
    return {
      environmentId,
      investigationId,
      scope,
      durationMinutes,
      matchers,
      localImpact:
        '仅暂停 Dashboard 为匹配告警创建新的 AI 调查；Alertmanager、Lark 和 Oncall 通知不受影响。',
      alertmanagerImpact:
        'Alertmanager 静默会阻止所有匹配告警发送到下游 Receiver，通常也包括 Lark、Oncall 和 AI 运维。',
      alertmanagerAvailable:
        context.sourceStatus === 'FIRING' &&
        context.sourceType === 'ALERTMANAGER_ALERT',
    };
  }

  async createLocal(
    environmentId: string,
    actor: Actor,
    investigationId: number,
    input: {
      scope: Scope;
      durationMinutes: number;
      reason: string;
      mfaCode: string;
    },
  ) {
    this.assertPermission(actor, 'aiops:alert:suppress');
    this.assertActor(actor);
    this.assertDuration(input.durationMinutes);
    await this.mfa.verifyForUser(actor.userId!, input.mfaCode);
    const context = await this.context(environmentId, investigationId);
    const matchers = this.buildMatchers(
      context.labels,
      environmentId,
      input.scope,
    );
    const result = await this.db.query<mysql.ResultSetHeader>(
      `INSERT INTO aiops_alert_suppressions
       (environment_id, investigation_id, scope, matchers_json, starts_at, ends_at, reason,
        created_by_user_id, created_by_username, hit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? MINUTE), ?, ?, ?, 0, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        environmentId,
        investigationId,
        input.scope,
        JSON.stringify(matchers),
        input.durationMinutes,
        input.reason.trim(),
        actor.userId,
        actor.username,
      ],
    );
    return {
      id: Number(result.insertId),
      type: 'LOCAL',
      matchers,
      durationMinutes: input.durationMinutes,
    };
  }

  async createAlertmanager(
    environmentId: string,
    actor: Actor,
    investigationId: number,
    input: {
      scope: Scope;
      durationMinutes: number;
      reason: string;
      mfaCode: string;
    },
  ) {
    this.assertPermission(actor, 'aiops:alert:silence');
    this.assertActor(actor);
    this.assertDuration(input.durationMinutes);
    await this.mfa.verifyForUser(actor.userId!, input.mfaCode);
    const context = await this.context(environmentId, investigationId);
    if (
      context.sourceType !== 'ALERTMANAGER_ALERT' ||
      context.sourceStatus !== 'FIRING'
    )
      throw new BadRequestException(
        '仅可静默真实且仍处于 FIRING 的 Alertmanager 告警',
      );
    const matchers = this.buildMatchers(
      context.labels,
      environmentId,
      input.scope,
      true,
    );
    const config = await this.alertmanagerConfig(environmentId);
    const startsAt = new Date();
    const endsAt = new Date(
      startsAt.getTime() + input.durationMinutes * 60_000,
    );
    let response: { silenceID?: string };
    try {
      response = (
        await firstValueFrom(
          this.http.post<{ silenceID?: string }>(
            `${config.baseUrl}/api/v2/silences`,
            {
              matchers,
              startsAt: startsAt.toISOString(),
              endsAt: endsAt.toISOString(),
              createdBy: actor.username,
              comment: `[Dashboard AI Ops] ${input.reason.trim()}`,
            },
            {
              headers: config.token
                ? { Authorization: `Bearer ${config.token}` }
                : undefined,
              timeout: 10_000,
            },
          ),
        )
      ).data;
    } catch (error) {
      const status = Number(
        (error as { response?: { status?: number } })?.response?.status || 0,
      );
      throw new ServiceUnavailableException(
        `Alertmanager 静默创建失败${status ? ` (HTTP ${status})` : ''}`,
      );
    }
    if (!response?.silenceID)
      throw new ServiceUnavailableException('Alertmanager 未返回 silenceID');
    const result = await this.db.query<mysql.ResultSetHeader>(
      `INSERT INTO aiops_alertmanager_silences
       (environment_id, investigation_id, alertmanager_silence_id, scope, matchers_json, starts_at, ends_at,
        reason, created_by_user_id, created_by_username, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        environmentId,
        investigationId,
        response.silenceID,
        input.scope,
        JSON.stringify(matchers),
        this.mysqlDate(startsAt),
        this.mysqlDate(endsAt),
        input.reason.trim(),
        actor.userId,
        actor.username,
      ],
    );
    return {
      id: Number(result.insertId),
      type: 'ALERTMANAGER',
      silenceId: response.silenceID,
      matchers,
      endsAt: endsAt.toISOString(),
    };
  }

  async list(environmentId: string, actor: Actor, investigationId?: number) {
    if (
      !actor.permissions.includes('aiops:alert:suppress') &&
      !actor.permissions.includes('aiops:alert:silence')
    )
      throw new ForbiddenException(
        'Missing permissions: aiops:alert:suppress or aiops:alert:silence',
      );
    const params: unknown[] = [environmentId];
    const clause = investigationId ? ' AND investigation_id=?' : '';
    if (investigationId) params.push(investigationId);
    const [local, upstream] = await Promise.all([
      actor.permissions.includes('aiops:alert:suppress')
        ? this.db.query<any[]>(
            `SELECT id, investigation_id, scope, matchers_json, starts_at, ends_at, reason, hit_count, last_hit_at, created_by_username, cancelled_at, cancel_reason, created_at FROM aiops_alert_suppressions WHERE environment_id=?${clause} ORDER BY id DESC LIMIT 100`,
            params as any[],
          )
        : Promise.resolve([]),
      actor.permissions.includes('aiops:alert:silence')
        ? this.db.query<any[]>(
            `SELECT id, investigation_id, alertmanager_silence_id, scope, matchers_json, starts_at, ends_at, reason, created_by_username, cancelled_at, cancel_reason, created_at FROM aiops_alertmanager_silences WHERE environment_id=?${clause} ORDER BY id DESC LIMIT 100`,
            params as any[],
          )
        : Promise.resolve([]),
    ]);
    return { local, alertmanager: upstream };
  }

  async cancelLocal(
    environmentId: string,
    actor: Actor,
    id: number,
    reason: string,
    mfaCode: string,
  ) {
    this.assertPermission(actor, 'aiops:alert:suppress');
    this.assertActor(actor);
    await this.mfa.verifyForUser(actor.userId!, mfaCode);
    const result = await this.db.query<mysql.ResultSetHeader>(
      `UPDATE aiops_alert_suppressions SET cancelled_at=UTC_TIMESTAMP(), cancel_reason=?, cancelled_by_user_id=?, cancelled_by_username=?, updated_at=UTC_TIMESTAMP()
       WHERE id=? AND environment_id=? AND cancelled_at IS NULL`,
      [reason.trim(), actor.userId, actor.username, id, environmentId],
    );
    if (!result.affectedRows)
      throw new NotFoundException('有效的本地暂停记录不存在');
    return { ok: true };
  }

  async cancelAlertmanager(
    environmentId: string,
    actor: Actor,
    id: number,
    reason: string,
    mfaCode: string,
  ) {
    this.assertPermission(actor, 'aiops:alert:silence');
    this.assertActor(actor);
    await this.mfa.verifyForUser(actor.userId!, mfaCode);
    const rows = await this.db.query<
      Array<{ alertmanager_silence_id: string }>
    >(
      'SELECT alertmanager_silence_id FROM aiops_alertmanager_silences WHERE id=? AND environment_id=? AND cancelled_at IS NULL LIMIT 1',
      [id, environmentId],
    );
    if (!rows[0])
      throw new NotFoundException('有效的 Alertmanager 静默记录不存在');
    const config = await this.alertmanagerConfig(environmentId);
    try {
      await firstValueFrom(
        this.http.delete(
          `${config.baseUrl}/api/v2/silence/${encodeURIComponent(rows[0].alertmanager_silence_id)}`,
          {
            headers: config.token
              ? { Authorization: `Bearer ${config.token}` }
              : undefined,
            timeout: 10_000,
          },
        ),
      );
    } catch (error) {
      const status = Number(
        (error as { response?: { status?: number } })?.response?.status || 0,
      );
      throw new ServiceUnavailableException(
        `Alertmanager 静默取消失败${status ? ` (HTTP ${status})` : ''}`,
      );
    }
    await this.db.query(
      `UPDATE aiops_alertmanager_silences SET cancelled_at=UTC_TIMESTAMP(), cancel_reason=?, cancelled_by_user_id=?, cancelled_by_username=?, updated_at=UTC_TIMESTAMP() WHERE id=?`,
      [reason.trim(), actor.userId, actor.username, id],
    );
    return { ok: true };
  }

  private async context(environmentId: string, investigationId: number) {
    const investigations = await this.db.query<
      Array<{ source_type: string; source_status: string }>
    >(
      'SELECT source_type, source_status FROM aiops_investigations WHERE id=? AND environment_id=? LIMIT 1',
      [investigationId, environmentId],
    );
    if (!investigations[0])
      throw new NotFoundException('AI investigation not found');
    const events = await this.db.query<Array<{ payload_json: unknown }>>(
      'SELECT payload_json FROM aiops_alert_event_queue WHERE investigation_id=? ORDER BY id DESC LIMIT 1',
      [investigationId],
    );
    if (!events[0])
      throw new BadRequestException(
        '调查缺少原始 Alertmanager 标签，无法安全生成匹配范围',
      );
    const payload = this.json(events[0].payload_json) as AlertmanagerPayload;
    const alert = payload.alerts?.[0];
    if (!alert) throw new BadRequestException('调查原始事件缺少 alert');
    return {
      ...investigations[0],
      sourceType: investigations[0].source_type,
      sourceStatus: investigations[0].source_status,
      labels: { ...(payload.commonLabels || {}), ...(alert.labels || {}) },
    };
  }

  private buildMatchers(
    labels: Record<string, unknown>,
    environmentId: string,
    scope: Scope,
    requireEnvironmentLabel = false,
  ): Matcher[] {
    const exact = (name: string, value: unknown) =>
      this.labelValue(value)
        ? ({
            name,
            value: this.labelValue(value),
            isRegex: false,
            isEqual: true,
          } as Matcher)
        : null;
    const alertName = exact('alertname', labels.alertname);
    if (!alertName)
      throw new BadRequestException('告警缺少 alertname，拒绝创建宽泛规则');
    const result: Matcher[] = [alertName];
    const envLabel = labels.environment
      ? 'environment'
      : labels.env
        ? 'env'
        : null;
    if (requireEnvironmentLabel && !envLabel)
      throw new BadRequestException(
        'Alertmanager 静默要求告警携带 environment 或 env 标签，以避免跨环境误静默',
      );
    if (envLabel) {
      if (this.labelValue(labels[envLabel]) !== environmentId)
        throw new BadRequestException('告警环境标签与当前环境不一致');
      result.push(exact(envLabel, labels[envLabel])!);
    }
    const namespace = exact('namespace', labels.namespace);
    if (scope !== 'ENVIRONMENT') {
      if (!namespace)
        throw new BadRequestException('该范围需要 namespace 标签');
      result.push(namespace);
    }
    if (scope === 'RESOURCE') {
      const resourceKeys = [
        'pod',
        'service',
        'deployment',
        'statefulset',
        'job',
        'instance',
      ];
      const pair = resourceKeys
        .map((key) => exact(key, labels[key]))
        .find(Boolean);
      if (!pair)
        throw new BadRequestException(
          '资源范围需要 pod/service/deployment/job/instance 标签',
        );
      result.push(pair);
    }
    return result;
  }

  private async alertmanagerConfig(environmentId: string) {
    const enabled = await this.siteConf.getBoolean(
      `aiops.alertmanager.environments.${environmentId}.silence_enabled`,
      false,
    );
    if (!enabled)
      throw new ServiceUnavailableException(
        `环境 ${environmentId} 未启用 Alertmanager 静默写入`,
      );
    const raw = (
      await this.siteConf.getString(
        `aiops.alertmanager.environments.${environmentId}.base_url`,
        '',
      )
    )
      .trim()
      .replace(/\/+$/, '');
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new ServiceUnavailableException(
        `环境 ${environmentId} 的 Alertmanager URL 未配置`,
      );
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new ServiceUnavailableException('Alertmanager URL 配置不安全');
    return {
      baseUrl: url.toString().replace(/\/$/, ''),
      token: (
        await this.siteConf.getString(
          `aiops.alertmanager.environments.${environmentId}.bearer_token`,
          '',
        )
      ).trim(),
    };
  }

  private matches(raw: unknown, labels: Record<string, unknown>) {
    const matchers = this.json(raw) as Matcher[];
    return (
      Array.isArray(matchers) &&
      matchers.every(
        (matcher) => this.labelValue(labels[matcher.name]) === matcher.value,
      )
    );
  }
  private json(value: unknown): unknown {
    if (typeof value !== 'string') return value;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }
  private labelValue(value: unknown) {
    return ['string', 'number', 'boolean'].includes(typeof value)
      ? String(value).trim()
      : '';
  }
  private assertDuration(value: number) {
    if (!DURATIONS.has(Number(value)))
      throw new BadRequestException('静默时长必须为 30 分钟至 24 小时的预设值');
  }
  private assertPermission(actor: Actor, permission: string) {
    if (!actor.permissions.includes(permission))
      throw new ForbiddenException(`Missing permissions: ${permission}`);
  }
  private assertActor(actor: Actor) {
    if (!actor.userId)
      throw new ForbiddenException('该操作需要已映射的 Dashboard 用户');
  }
  private mysqlDate(date: Date) {
    return date.toISOString().slice(0, 19).replace('T', ' ');
  }
}
