import { Injectable, Logger } from '@nestjs/common';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { toJsonParam } from './audit.sanitizer';

export type AuditLogInput = {
  actorUserId?: number | null;
  actorUsername?: string | null;
  actorDisplayName?: string | null;
  environmentId?: string | null;
  method?: string | null;
  path?: string | null;
  menuKey?: string | null;
  action: string;
  actionName?: string | null;
  targetType?: string | null;
  targetId?: string | null;
  meta?: unknown;
  requestSummary?: unknown;
  responseSummary?: unknown;
  status?: 'success' | 'failed' | string | null;
  statusCode?: number | null;
  errorMessage?: string | null;
  durationMs?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  traceId?: string | null;
};

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly db: PlatformDatabaseService) {}

  async record(input: AuditLogInput) {
    try {
      await this.db.query(
        `INSERT INTO audit_logs (
          actor_user_id, actor_username, actor_display_name, environment_id,
          method, path, menu_key, action, action_name, target_type, target_id,
          meta, request_summary, response_summary, status, status_code,
          error_message, duration_ms, ip, user_agent, trace_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
        [
          input.actorUserId ?? null,
          input.actorUsername ?? null,
          input.actorDisplayName ?? null,
          input.environmentId ?? null,
          input.method ?? null,
          input.path ?? null,
          input.menuKey ?? null,
          input.action,
          input.actionName ?? null,
          input.targetType ?? null,
          input.targetId ?? null,
          toJsonParam(input.meta),
          toJsonParam(input.requestSummary),
          toJsonParam(input.responseSummary),
          input.status ?? null,
          input.statusCode ?? null,
          input.errorMessage ?? null,
          input.durationMs ?? null,
          input.ip ?? null,
          input.userAgent ?? null,
          input.traceId ?? null,
        ],
      );
    } catch (err: any) {
      this.logger.warn(`Failed to write audit log: ${err?.message || err}`);
    }
  }

  async list(params: {
    page?: number;
    pageSize?: number;
    startTime?: string;
    endTime?: string;
    username?: string;
    method?: string;
    status?: string;
    environmentId?: string;
    action?: string;
    keyword?: string;
  }) {
    const page = Math.max(1, Number(params.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize || 20)));
    const where: string[] = [];
    const values: any[] = [];

    if (params.startTime) { where.push('created_at >= ?'); values.push(params.startTime); }
    if (params.endTime) { where.push('created_at <= ?'); values.push(params.endTime); }
    if (params.username) { where.push('(actor_username LIKE ? OR actor_display_name LIKE ?)'); values.push(`%${params.username}%`, `%${params.username}%`); }
    if (params.method) { where.push('method = ?'); values.push(params.method.toUpperCase()); }
    if (params.status) { where.push('status = ?'); values.push(params.status); }
    if (params.environmentId) { where.push('environment_id = ?'); values.push(params.environmentId); }
    if (params.action) { where.push('action = ?'); values.push(params.action); }
    if (params.keyword) {
      where.push('(path LIKE ? OR action_name LIKE ? OR target_id LIKE ? OR error_message LIKE ?)');
      values.push(`%${params.keyword}%`, `%${params.keyword}%`, `%${params.keyword}%`, `%${params.keyword}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const totalRows = await this.db.query<Array<{ total: number }>>(
      `SELECT COUNT(1) AS total FROM audit_logs ${whereSql}`,
      values,
    );
    const items = await this.db.query(
      `SELECT id, created_at, actor_user_id, actor_username, actor_display_name,
              environment_id, method, path, menu_key, action, action_name,
              target_type, target_id, meta, request_summary, response_summary,
              status, status_code, error_message, duration_ms, ip, user_agent, trace_id
       FROM audit_logs
       ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ? OFFSET ?`,
      [...values, pageSize, (page - 1) * pageSize],
    );
    return { items, total: Number(totalRows?.[0]?.total || 0), page, pageSize };
  }

  async cleanupOlderThan(days = 90) {
    const safeDays = Math.max(1, Math.floor(Number(days) || 90));
    const result: any = await this.db.query(
      'DELETE FROM audit_logs WHERE created_at < (UTC_TIMESTAMP() - INTERVAL ? DAY)',
      [safeDays],
    );
    return { ok: true, deleted: Number(result?.affectedRows || 0), days: safeDays };
  }
}
