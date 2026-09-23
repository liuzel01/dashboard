import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'crypto';
import type * as mysql from 'mysql2/promise';
import { AccessControlService } from '../access-control/access-control.service';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { OncallNotificationService } from './oncall-notification.service';
import type { AlertmanagerAlert, AlertmanagerPayload, OncallActor } from './oncall.types';

const MENU_PERMISSION = 'menu:oncall';
const MAX_ALERTS_PER_WEBHOOK = 200;
const MAX_LABEL_KEYS = 100;

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asText = (value: unknown, max = 512) => String(value ?? '').trim().slice(0, max);

const parseTime = (value: unknown): string | null => {
  const raw = asText(value, 80);
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 19).replace('T', ' ');
};

const json = (value: unknown) => JSON.stringify(value ?? {});

@Injectable()
export class OncallService {
  constructor(
    private readonly auth: AuthService,
    private readonly access: AccessControlService,
    private readonly db: PlatformDatabaseService,
    private readonly audit: AuditService,
    private readonly notifications: OncallNotificationService,
  ) {}

  async resolveActor(authorization?: string): Promise<OncallActor> {
    const bearer = String(authorization || '');
    if (!bearer.toLowerCase().startsWith('bearer ')) throw new UnauthorizedException('Missing token');
    const token = bearer.slice(7).trim();
    const payload = await this.auth.verifyToken(token);
    const userId = payload.source === 'keycloak' || typeof payload.sub !== 'number'
      ? (await this.access.ensureUserByUsername(payload.username, { displayName: payload.displayName })).id
      : Number(payload.sub);
    const me = await this.access.getMe({ userId });
    const permissions = Array.isArray(me.permissions) ? me.permissions.map(String) : [];
    if (!permissions.includes(MENU_PERMISSION)) {
      throw new ForbiddenException(`Missing permissions: ${MENU_PERMISSION}`);
    }
    return {
      userId: Number(me.id),
      username: String(me.username || payload.username),
      displayName: String(me.display_name || payload.displayName || me.username || payload.username),
      permissions,
    };
  }

  assertWebhookAuthorization(authorization?: string) {
    const expected = String(process.env.ONCALL_ALERTMANAGER_BEARER_TOKEN || '').trim();
    if (!expected) {
      if (process.env.ONCALL_ALLOW_INSECURE_WEBHOOK === 'true') return;
      throw new UnauthorizedException('Oncall webhook authentication is not configured');
    }
    const received = String(authorization || '');
    const prefix = 'Bearer ';
    if (!received.startsWith(prefix)) throw new UnauthorizedException('Invalid oncall webhook authorization');
    const supplied = Buffer.from(received.slice(prefix.length).trim());
    const target = Buffer.from(expected);
    if (supplied.length !== target.length || !timingSafeEqual(supplied, target)) {
      throw new UnauthorizedException('Invalid oncall webhook authorization');
    }
  }

  private labelsFor(alert: AlertmanagerAlert, payload: AlertmanagerPayload) {
    return { ...asObject(payload.commonLabels), ...asObject(alert.labels) };
  }

  private annotationsFor(alert: AlertmanagerAlert, payload: AlertmanagerPayload) {
    return { ...asObject(payload.commonAnnotations), ...asObject(alert.annotations) };
  }

  private fingerprint(alert: AlertmanagerAlert, labels: Record<string, unknown>) {
    const upstream = asText(alert.fingerprint, 256);
    if (upstream) return upstream;
    const canonical = Object.entries(labels)
      .filter(([key]) => key.length <= 128)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, String(value ?? '')]);
    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
  }

  private environmentId(labels: Record<string, unknown>) {
    return asText(labels.environment || labels.env || process.env.ONCALL_DEFAULT_ENVIRONMENT || 'mgbx', 64);
  }

  private normalizePayload(payload: AlertmanagerPayload) {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException('Alertmanager payload must be an object');
    }
    if (!Array.isArray(payload.alerts) || payload.alerts.length === 0) {
      throw new BadRequestException('Alertmanager payload must include at least one alert');
    }
    if (payload.alerts.length > MAX_ALERTS_PER_WEBHOOK) {
      throw new BadRequestException(`Alertmanager payload exceeds ${MAX_ALERTS_PER_WEBHOOK} alerts`);
    }
    return payload.alerts;
  }

  async receiveAlertmanagerWebhook(payload: AlertmanagerPayload, meta: { ip?: string | null; userAgent?: string | null; traceId?: string | null }) {
    const alerts = this.normalizePayload(payload);
    const result = { received: alerts.length, created: 0, updated: 0, resolved: 0, duplicateEvents: 0, alertIds: [] as number[] };
    for (const alert of alerts) {
      const outcome = await this.upsertAlert(alert, payload, meta);
      result.alertIds.push(outcome.alertId);
      if (outcome.created) result.created += 1;
      if (outcome.updated) result.updated += 1;
      if (outcome.resolved) result.resolved += 1;
      if (outcome.duplicate) result.duplicateEvents += 1;
      if (outcome.shouldNotify) await this.notifications.enqueueFiringAlert(outcome.alertId, outcome.firedAt);
    }
    return result;
  }

  private async upsertAlert(alert: AlertmanagerAlert, payload: AlertmanagerPayload, meta: { ip?: string | null; userAgent?: string | null; traceId?: string | null }) {
    const labels = this.labelsFor(alert, payload);
    if (Object.keys(labels).length > MAX_LABEL_KEYS) throw new BadRequestException('Alert labels exceed allowed key count');
    const annotations = this.annotationsFor(alert, payload);
    const fingerprint = this.fingerprint(alert, labels);
    const status = asText(alert.status || payload.status, 32).toLowerCase() === 'resolved' ? 'RESOLVED' : 'FIRING';
    const environmentId = this.environmentId(labels);
    const alertName = asText(labels.alertname || 'UnknownAlert', 255) || 'UnknownAlert';
    const namespace = asText(labels.namespace, 255) || null;
    const severity = asText(labels.severity, 64) || null;
    const riskLevel = asText(labels.risk_level || labels.riskLevel, 64) || null;
    const firedAt = parseTime(alert.startsAt) || new Date().toISOString().slice(0, 19).replace('T', ' ');
    const resolvedAt = status === 'RESOLVED' ? (parseTime(alert.endsAt) || new Date().toISOString().slice(0, 19).replace('T', ' ')) : null;
    const rawPayload = { alert, envelope: { receiver: payload.receiver, groupKey: payload.groupKey, status: payload.status, externalURL: payload.externalURL } };

    return this.db.withTransaction(async (conn) => {
      const [existingRows] = await conn.execute<any[]>(
        'SELECT * FROM oncall_alerts WHERE fingerprint = ? LIMIT 1 FOR UPDATE',
        [fingerprint],
      );
      const existing = existingRows[0];
      let alertId: number;
      let created = false;
      let updated = false;
      let duplicate = false;
      if (!existing) {
        const [insert] = await conn.execute<mysql.ResultSetHeader>(
          `INSERT INTO oncall_alerts
           (fingerprint, upstream_fingerprint, environment_id, alert_name, namespace, severity, risk_level, status,
            first_fired_at, last_fired_at, resolved_at, labels_json, annotations_json, raw_payload_json, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
          [fingerprint, asText(alert.fingerprint, 256) || null, environmentId, alertName, namespace, severity, riskLevel, status, firedAt, firedAt, resolvedAt, json(labels), json(annotations), json(rawPayload)],
        );
        alertId = Number(insert.insertId);
        created = true;
      } else {
        alertId = Number(existing.id);
        const wasResolved = existing.status === 'RESOLVED';
        duplicate = status === 'FIRING' && (existing.status === 'FIRING' || existing.status === 'ACKED');
        const nextStatus = status === 'RESOLVED' ? 'RESOLVED' : existing.status === 'ACKED' ? 'ACKED' : 'FIRING';
        await conn.execute(
          `UPDATE oncall_alerts SET environment_id=?, alert_name=?, namespace=?, severity=?, risk_level=?, status=?,
            last_fired_at=IF(? = 'FIRING', ?, last_fired_at), resolved_at=?, labels_json=?, annotations_json=?, raw_payload_json=?,
            updated_at=UTC_TIMESTAMP() WHERE id=?`,
          [environmentId, alertName, namespace, severity, riskLevel, nextStatus, status, firedAt, resolvedAt, json(labels), json(annotations), json(rawPayload), alertId],
        );
        updated = !duplicate;
      }
      const eventType = status === 'RESOLVED' ? 'RESOLVED' : created ? 'FIRING' : duplicate ? 'DUPLICATE' : 'REFIRING';
      await conn.execute(
        `INSERT INTO oncall_alert_events
         (alert_id, event_type, source_status, payload_json, source_ip, user_agent, trace_id, occurred_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [alertId, eventType, asText(alert.status || payload.status, 32) || null, json(rawPayload), meta.ip || null, meta.userAgent || null, meta.traceId || null],
      );
      return { alertId, created, updated, resolved: status === 'RESOLVED', duplicate, shouldNotify: status === 'FIRING' && !duplicate, firedAt };
    });
  }

  async listAlerts(actor: OncallActor, query: { page?: number; pageSize?: number; status?: string; environmentId?: string; keyword?: string }) {
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const clauses: string[] = [];
    const values: unknown[] = [];
    if (query.status) { clauses.push('status = ?'); values.push(asText(query.status, 32).toUpperCase()); }
    if (query.environmentId) { clauses.push('environment_id = ?'); values.push(asText(query.environmentId, 64)); }
    if (query.keyword) {
      clauses.push('(alert_name LIKE ? OR namespace LIKE ? OR fingerprint LIKE ?)');
      const like = `%${asText(query.keyword, 128)}%`;
      values.push(like, like, like);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const totalRows = await this.db.query<Array<{ total: number }>>(`SELECT COUNT(*) AS total FROM oncall_alerts ${where}`, values as any[]);
    const items = await this.db.query<any[]>(
      `SELECT id, fingerprint, environment_id, alert_name, namespace, severity, risk_level, status,
              first_fired_at, last_fired_at, resolved_at, created_at, updated_at
       FROM oncall_alerts ${where} ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize] as any[],
    );
    await this.audit.record({ actorUserId: actor.userId, actorUsername: actor.username, actorDisplayName: actor.displayName, method: 'GET', path: '/oncall/alerts', menuKey: MENU_PERMISSION, action: 'oncall.alerts.list', actionName: '查看 Oncall 告警', targetType: 'oncall_alert', requestSummary: query, responseSummary: { total: Number(totalRows[0]?.total || 0) }, status: 'success', statusCode: 200 });
    return { items, total: Number(totalRows[0]?.total || 0), page, pageSize };
  }

  async getAlert(actor: OncallActor, id: number) {
    const rows = await this.db.query<any[]>('SELECT * FROM oncall_alerts WHERE id = ? LIMIT 1', [id]);
    const alert = rows[0];
    if (!alert) throw new NotFoundException('Oncall alert not found');
    const [events, acknowledgements, notifications, escalations] = await Promise.all([
      this.db.query<any[]>('SELECT id, event_type, source_status, source_ip, trace_id, occurred_at, created_at FROM oncall_alert_events WHERE alert_id=? ORDER BY id DESC', [id]),
      this.db.query<any[]>('SELECT id, actor_user_id, actor_username, source, result, comment, acknowledged_at, created_at FROM oncall_ack_records WHERE alert_id=? ORDER BY id DESC', [id]),
      this.db.query<any[]>('SELECT id, channel, status, idempotency_key, provider_message_id, error_message, sent_at, created_at FROM oncall_notification_records WHERE alert_id=? ORDER BY id DESC', [id]),
      this.db.query<any[]>('SELECT id, level, status, scheduled_at, executed_at, attempt_count, error_message, created_at, updated_at FROM oncall_escalation_records WHERE alert_id=? ORDER BY id ASC', [id]),
    ]);
    await this.audit.record({ actorUserId: actor.userId, actorUsername: actor.username, actorDisplayName: actor.displayName, method: 'GET', path: `/oncall/alerts/${id}`, menuKey: MENU_PERMISSION, action: 'oncall.alerts.get', actionName: '查看 Oncall 告警详情', targetType: 'oncall_alert', targetId: String(id), status: 'success', statusCode: 200 });
    return { ...alert, events, acknowledgements, notifications, escalations };
  }

  async acknowledgeAlert(actor: OncallActor, id: number, comment?: string) {
    const normalizedComment = asText(comment, 1000) || null;
    const result = await this.db.withTransaction(async (conn) => {
      const [rows] = await conn.execute<any[]>('SELECT id, status FROM oncall_alerts WHERE id=? LIMIT 1 FOR UPDATE', [id]);
      const alert = rows[0];
      if (!alert) throw new NotFoundException('Oncall alert not found');
      const status = String(alert.status);
      const acknowledged = status === 'FIRING';
      const recordResult = acknowledged ? 'ACKED' : status === 'ACKED' ? 'DUPLICATE' : 'IGNORED_RESOLVED';
      if (acknowledged) {
        await conn.execute('UPDATE oncall_alerts SET status=\'ACKED\', updated_at=UTC_TIMESTAMP() WHERE id=?', [id]);
      }
      await conn.execute(
        `INSERT INTO oncall_ack_records
         (alert_id, actor_user_id, actor_username, source, result, comment, acknowledged_at, created_at)
         VALUES (?, ?, ?, 'dashboard', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
        [id, actor.userId, actor.username, recordResult, normalizedComment],
      );
      return { acknowledged, status: acknowledged ? 'ACKED' : status, result: recordResult };
    });
    await this.audit.record({
      actorUserId: actor.userId,
      actorUsername: actor.username,
      actorDisplayName: actor.displayName,
      method: 'POST',
      path: `/oncall/alerts/${id}/ack`,
      menuKey: MENU_PERMISSION,
      action: 'oncall.alerts.ack',
      actionName: '确认 Oncall 告警',
      targetType: 'oncall_alert',
      targetId: String(id),
      requestSummary: { comment: normalizedComment },
      responseSummary: result,
      status: 'success',
      statusCode: 200,
    });
    return result;
  }

  async listRoster(actor: OncallActor, environmentId?: string) {
    const env = asText(environmentId, 64);
    const rows = await this.db.query<any[]>(
      `SELECT id, environment_id, level, email, display_name, active_from, active_until, enabled, created_at, updated_at
       FROM oncall_identity_bindings ${env ? 'WHERE environment_id=?' : ''}
       ORDER BY environment_id, FIELD(level, 'L1', 'L2', 'OWNER'), email`, env ? [env] : [],
    );
    await this.audit.record({ actorUserId: actor.userId, actorUsername: actor.username, actorDisplayName: actor.displayName, method: 'GET', path: '/oncall/roster', menuKey: MENU_PERMISSION, action: 'oncall.roster.list', actionName: '查看 Oncall 值班配置', targetType: 'oncall_roster', requestSummary: { environmentId: env || undefined }, responseSummary: { count: rows.length }, status: 'success', statusCode: 200 });
    return rows;
  }

  async upsertRoster(actor: OncallActor, input: { id?: number; environmentId: string; level: string; email: string; displayName?: string; activeFrom?: string; activeUntil?: string; enabled?: boolean }) {
    const environmentId = asText(input.environmentId, 64);
    const level = asText(input.level, 16).toUpperCase();
    const email = asText(input.email, 320).toLowerCase();
    if (!environmentId || !['L1', 'L2', 'OWNER'].includes(level) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('Invalid Oncall roster environment, level, or email');
    const displayName = asText(input.displayName, 255) || null;
    const activeFrom = parseTime(input.activeFrom) || null;
    const activeUntil = parseTime(input.activeUntil) || null;
    const enabled = input.enabled === false ? 0 : 1;
    if (input.id) {
      const result = await this.db.query<any>(
        `UPDATE oncall_identity_bindings SET environment_id=?, level=?, email=?, lark_open_id='', display_name=?, active_from=?, active_until=?, enabled=?, updated_at=UTC_TIMESTAMP() WHERE id=?`,
        [environmentId, level, email, displayName, activeFrom, activeUntil, enabled, input.id],
      );
      if (!Number(result.affectedRows || 0)) throw new NotFoundException('Oncall roster binding not found');
    } else {
      await this.db.query(
        `INSERT INTO oncall_identity_bindings (environment_id, level, email, lark_open_id, display_name, active_from, active_until, enabled, created_at, updated_at)
         VALUES (?, ?, ?, '', ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
         ON DUPLICATE KEY UPDATE lark_open_id='', display_name=VALUES(display_name), active_from=VALUES(active_from), active_until=VALUES(active_until), enabled=VALUES(enabled), updated_at=UTC_TIMESTAMP()`,
        [environmentId, level, email, displayName, activeFrom, activeUntil, enabled],
      );
    }
    await this.audit.record({ actorUserId: actor.userId, actorUsername: actor.username, actorDisplayName: actor.displayName, method: 'POST', path: '/oncall/roster', menuKey: MENU_PERMISSION, action: 'oncall.roster.upsert', actionName: '保存 Oncall 值班配置', targetType: 'oncall_roster', requestSummary: { environmentId, level, email, displayName, enabled }, status: 'success', statusCode: 200 });
    return { ok: true, id: input.id || undefined, environmentId, level, email };
  }

  async deleteRoster(actor: OncallActor, id: number) {
    const result = await this.db.query<any>('DELETE FROM oncall_identity_bindings WHERE id=?', [id]);
    await this.audit.record({ actorUserId: actor.userId, actorUsername: actor.username, actorDisplayName: actor.displayName, method: 'DELETE', path: `/oncall/roster/${id}`, menuKey: MENU_PERMISSION, action: 'oncall.roster.delete', actionName: '删除 Oncall 值班配置', targetType: 'oncall_roster', targetId: String(id), responseSummary: { deleted: Number(result.affectedRows || 0) }, status: 'success', statusCode: 200 });
    return { ok: true, deleted: Number(result.affectedRows || 0) };
  }
}
