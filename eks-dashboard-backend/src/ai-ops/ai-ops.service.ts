import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';
import { promises as fs } from 'fs';
import type * as mysql from 'mysql2/promise';
import * as path from 'path';
import { DatabaseService } from '../database/database.service';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AuthService } from '../auth/auth.service';
import { AccessControlService } from '../access-control/access-control.service';
import { EnvironmentsService } from '../environments/environments.service';
import { SqlPreviewDto } from './dto/sql-preview.dto';
import { SqlExecuteDto } from './dto/sql-execute.dto';
import { CloudWatchEventDto } from './dto/cloudwatch-event.dto';
import { SlowQueryEventDto } from './dto/slow-query-event.dto';

type ActorContext = {
  userId: number | null;
  username: string;
  permissions: string[];
  roles: string[];
};

type SqlPolicy = {
  whitelistTables: string[];
  whitelistDatabases: string[];
  defaultLimit: number;
  maxLimit: number;
  timeoutMs: number;
};

type PreparedSql = {
  rawSql: string;
  normalizedSql: string;
  executedSql: string;
  appliedLimit: number | null;
  generatedFromQuestion: boolean;
};

type OpenClawConfig = {
  provider: 'openclaw';
  baseUrl: string;
  token: string;
  model: string;
};

type SchemaColumnRow = {
  tableSchema: string;
  tableName: string;
  columnName: string;
  ordinalPosition: number;
};

type SchemaTableSummary = {
  database: string;
  table: string;
  columns: string[];
};

type SqlType = 'read' | 'write' | 'ddl' | 'unknown';
type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

type FewshotCaseRow = {
  caseId: string;
  priority: string;
  intentType: string;
  userQuestion: string;
  expectedSql: string;
  mustConditions: string;
  forbiddenPatterns: string;
  allowedDatabases: string[];
  allowedTables: string[];
  reviewStatus: string;
};

@Injectable()
export class AiOpsService {
  private readonly logger = new Logger(AiOpsService.name);
  private readonly schemaCache = new Map<
    string,
    { expiresAt: number; tables: SchemaTableSummary[] }
  >();
  private readonly schemaCacheTtlMs = 5 * 60 * 1000;
  private readonly schemaPromptMaxTables = 24;
  private readonly schemaPromptMaxColumns = 20;
  private readonly sqlRewriteMaxAttempts = 3;
  private readonly fewshotCacheTtlMs = 2 * 60 * 1000;
  private readonly fewshotPromptMaxCases = 6;
  private readonly fewshotPromptMaxChars = 5000;
  private fewshotCache: { expiresAt: number; sourcePath: string; rows: FewshotCaseRow[] } | null =
    null;

  constructor(
    private readonly config: ConfigService,
    private readonly database: DatabaseService,
    private readonly platformDb: PlatformDatabaseService,
    private readonly authService: AuthService,
    private readonly accessControl: AccessControlService,
    private readonly environments: EnvironmentsService,
  ) {}

  async resolveActorFromAuthorization(authorization?: string): Promise<ActorContext> {
    const auth = String(authorization || '');
    if (!auth.toLowerCase().startsWith('bearer ')) {
      throw new UnauthorizedException('Missing token');
    }
    const token = auth.slice(7).trim();
    const payload = await this.authService.verifyToken(token);

    let userId: number;
    if (payload.source === 'keycloak' || typeof payload.sub !== 'number') {
      const user = await this.accessControl.ensureUserByUsername(payload.username, {
        displayName: payload.displayName,
      });
      userId = user.id;
    } else {
      userId = Number(payload.sub);
    }

    const me = await this.accessControl.getMe({ userId });
    return {
      userId: me.id || null,
      username: me.username || payload.username,
      permissions: Array.isArray(me.permissions) ? me.permissions : [],
      roles: Array.isArray(me.roles)
        ? me.roles
            .map((role: any) => String(role?.name || '').trim())
            .filter(Boolean)
        : [],
    };
  }

  ensurePermissions(actor: ActorContext, required: string[]) {
    const missing = required.filter((key) => !actor.permissions.includes(key));
    if (missing.length > 0) {
      throw new ForbiddenException(`Missing permissions: ${missing.join(', ')}`);
    }
  }

  async previewSql(environmentId: string, actor: ActorContext, body: SqlPreviewDto) {
    this.ensurePermissions(actor, ['menu:ai-ops', 'aiops:sql:generate']);
    const actionStartedAt = Date.now();
    const policy = this.getSqlPolicy(environmentId, body.maxRows);
    const llmSessionKey = this.buildLlmSessionKey(environmentId, actor, body.sessionId);

    let actionId: number | null = null;
    let prepared: PreparedSql | null = null;
    try {
      prepared = await this.prepareSql(environmentId, body, policy, llmSessionKey);
      const sqlMeta = this.classifySql(prepared.normalizedSql);

      actionId = await this.safeInsertAction({
        environmentId,
        actor,
        sessionId: body.sessionId,
        actionType: 'sql.preview',
        status: 'ok',
        requestPayload: { question: body.question, sql: body.sql, maxRows: body.maxRows },
        responsePayload: {
          normalizedSql: prepared.normalizedSql,
          executedSql: prepared.executedSql,
          appliedLimit: prepared.appliedLimit,
        },
        durationMs: Date.now() - actionStartedAt,
      });

      await this.safeInsertSqlAudit({
        actionId,
        environmentId,
        actor,
        question: body.question,
        generatedSql: prepared.generatedFromQuestion ? prepared.rawSql : null,
        executedSql: prepared.executedSql,
        limitApplied: prepared.appliedLimit,
        maxExecutionTimeMs: policy.timeoutMs,
        rowCount: null,
        sqlType: sqlMeta.sqlType,
        riskLevel: sqlMeta.riskLevel,
        status: 'previewed',
      });

      return {
        ok: true,
        source: prepared.generatedFromQuestion ? 'question' : 'sql',
        normalizedSql: prepared.normalizedSql,
        executedSql: prepared.executedSql,
        appliedLimit: prepared.appliedLimit,
        timeoutMs: policy.timeoutMs,
        sqlType: sqlMeta.sqlType,
        riskLevel: sqlMeta.riskLevel,
      };
    } catch (error) {
      const fallbackSql = prepared?.normalizedSql || String(body.sql || '').trim();
      const sqlMeta = this.classifySql(fallbackSql);
      await this.safeInsertAction({
        environmentId,
        actor,
        sessionId: body.sessionId,
        actionType: 'sql.preview',
        status: 'error',
        requestPayload: { question: body.question, sql: body.sql, maxRows: body.maxRows },
        responsePayload: prepared
          ? {
              normalizedSql: prepared.normalizedSql,
              executedSql: prepared.executedSql,
              appliedLimit: prepared.appliedLimit,
            }
          : null,
        errorMessage: this.errorMessage(error),
        durationMs: Date.now() - actionStartedAt,
      });
      await this.safeInsertSqlAudit({
        actionId,
        environmentId,
        actor,
        question: body.question,
        generatedSql: prepared?.generatedFromQuestion ? prepared.rawSql : null,
        executedSql: prepared?.executedSql || null,
        limitApplied: prepared?.appliedLimit ?? null,
        maxExecutionTimeMs: policy.timeoutMs,
        rowCount: null,
        sqlType: sqlMeta.sqlType,
        riskLevel: sqlMeta.riskLevel,
        status: 'error',
        errorMessage: this.errorMessage(error),
      });
      throw error;
    }
  }

  async executeSql(environmentId: string, actor: ActorContext, body: SqlExecuteDto) {
    void environmentId;
    void actor;
    void body;
    throw new BadRequestException(
      'SQL execute is disabled in dashboard. Please run SQL in external system (for example: abd.com).',
    );
  }

  async listSqlAudit(environmentId: string, actor: ActorContext, page = 1, size = 20) {
    this.ensurePermissions(actor, ['menu:ai-ops']);
    const safePage = Math.max(1, Math.floor(page));
    const safeSize = Math.min(100, Math.max(1, Math.floor(size)));
    const offset = (safePage - 1) * safeSize;
    const scope = this.buildSqlAuditScope(environmentId, actor);
    const rows = await this.platformDb.query<any[]>(
      `SELECT a.id, a.action_id, a.environment_id, a.actor_user_id, a.actor_username,
              COALESCE(NULLIF(u.display_name, ''), u.username, a.actor_username) AS actor_display_name,
              a.question, a.generated_sql, a.executed_sql, a.limit_applied,
              a.max_execution_time_ms, a.row_count, a.sql_type, a.risk_level, a.status, a.error_message, a.created_at
       FROM aiops_sql_audit a
       LEFT JOIN users u ON u.id = a.actor_user_id
       WHERE ${scope.whereSql}
       ORDER BY a.id DESC
       LIMIT ? OFFSET ?`,
      [...scope.params, safeSize, offset],
    );

    const totalRows = await this.platformDb.query<{ total: number }[]>(
      `SELECT COUNT(1) AS total FROM aiops_sql_audit WHERE ${scope.whereSql}`,
      scope.params,
    );

    return {
      page: safePage,
      size: safeSize,
      total: Number(totalRows?.[0]?.total || 0),
      items: rows,
    };
  }

  private isAdminActor(actor: ActorContext): boolean {
    const roleNames = (actor.roles || [])
      .map((role: any) => String(role?.name || role || '').trim().toLowerCase())
      .filter(Boolean);
    return roleNames.includes('admin') || roleNames.includes('管理员');
  }

  private buildSqlAuditScope(
    environmentId: string,
    actor: ActorContext,
  ): { whereSql: string; params: Array<string | number> } {
    if (this.isAdminActor(actor)) {
      return {
        whereSql: 'environment_id = ?',
        params: [environmentId],
      };
    }
    if (actor.userId) {
      return {
        whereSql: 'environment_id = ? AND actor_user_id = ?',
        params: [environmentId, actor.userId],
      };
    }
    return {
      whereSql: 'environment_id = ? AND actor_username = ?',
      params: [environmentId, actor.username],
    };
  }

  async checkLlmHealth(environmentId: string, actor: ActorContext) {
    this.ensurePermissions(actor, ['menu:ai-ops']);
    const llm = this.getOpenClawConfig();
    const startedAt = Date.now();
    const endpoint = `${llm.baseUrl.replace(/\/+$/, '')}/models`;

    try {
      const resp = await axios.get(endpoint, {
        headers: {
          Authorization: `Bearer ${llm.token}`,
        },
        timeout: 10000,
      });

      const models = this.extractOpenClawModels(resp.data);
      return {
        ok: true,
        environmentId,
        provider: llm.provider,
        endpoint,
        configuredModel: llm.model,
        modelAvailable: models.includes(llm.model),
        modelCount: models.length,
        models,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      throw new BadGatewayException(
        `LLM health check failed: ${this.errorMessage(error)}`,
      );
    }
  }

  async ingestCloudWatchEvent(
    environmentIdHeader: string | undefined,
    tokenHeader: string | undefined,
    payload: CloudWatchEventDto,
  ) {
    this.ensureIngestToken(tokenHeader);

    const environmentId =
      (environmentIdHeader || '').trim() || this.inferEnvironmentIdFromCloudWatch(payload);
    if (!environmentId) {
      throw new BadRequestException(
        'Unable to infer environmentId. Provide X-Target-Environment header.',
      );
    }

    const alarmArn = String(payload.AlarmArn || '').trim();
    const stateChangeTime = String(payload.StateChangeTime || '').trim();
    const newStateValue = String(payload.NewStateValue || '').trim();
    const dedupeKey = alarmArn && stateChangeTime
      ? `${alarmArn}::${stateChangeTime}::${newStateValue}`
      : this.hashPayload(payload);

    const resourceId = this.extractCloudWatchResourceId(payload);
    const severity = newStateValue === 'ALARM' ? 'high' : newStateValue === 'OK' ? 'info' : 'medium';
    const occurredAt = this.parseDateTime(stateChangeTime);

    const inserted = await this.insertIngestEvent({
      environmentId,
      eventType: 'cloudwatch_alarm',
      source: 'cloudwatch',
      dedupeKey,
      severity,
      resourceId,
      alarmName: payload.AlarmName ? String(payload.AlarmName) : null,
      occurredAt,
      payload,
    });

    return {
      ok: true,
      inserted,
      environmentId,
      dedupeKey,
    };
  }

  async ingestSlowQueryEvent(
    environmentIdHeader: string | undefined,
    tokenHeader: string | undefined,
    payload: SlowQueryEventDto,
  ) {
    this.ensureIngestToken(tokenHeader);

    const environmentId =
      (environmentIdHeader || '').trim() ||
      String((payload as Record<string, unknown>).environmentId || '').trim();

    if (!environmentId) {
      throw new BadRequestException(
        'Missing environmentId. Provide X-Target-Environment header or payload.environmentId.',
      );
    }

    const normalized = this.normalizeSlowQueryPayload(payload);
    const fingerprint = normalized.fingerprint;
    const occurredAtRaw = normalized.occurredAtRaw;
    const dedupeKey = normalized.eventId ||
      (fingerprint && occurredAtRaw
        ? `${fingerprint}::${occurredAtRaw}`
        : this.hashPayload(payload));

    const resourceId = normalized.resourceId;
    const occurredAt = this.parseDateTime(occurredAtRaw);

    const inserted = await this.insertIngestEvent({
      environmentId,
      eventType: 'slow_query_alert',
      source: 'lambda',
      dedupeKey,
      severity: 'high',
      resourceId,
      alarmName: normalized.alarmName,
      occurredAt,
      payload: {
        ...payload,
        _normalized: normalized,
      },
    });

    return {
      ok: true,
      inserted,
      environmentId,
      dedupeKey,
    };
  }

  private normalizeSlowQueryPayload(payload: SlowQueryEventDto) {
    const raw = payload as Record<string, unknown>;
    const logEvents = Array.isArray(raw.logEvents)
      ? (raw.logEvents as Array<Record<string, unknown>>)
      : [];
    const first = logEvents[0] || {};
    const firstMessageRaw = typeof first.message === 'string' ? first.message : '';
    const firstMessage = this.tryParseJson(firstMessageRaw);
    const attr =
      firstMessage && typeof firstMessage.attr === 'object'
        ? (firstMessage.attr as Record<string, unknown>)
        : null;
    const command =
      attr && attr.command && typeof attr.command === 'object'
        ? (attr.command as Record<string, unknown>)
        : null;
    const commandName = command
      ? Object.keys(command).find((key) => !key.startsWith('$')) || ''
      : '';
    const ns = attr && typeof attr.ns === 'string' ? attr.ns : '';
    const rawFingerprint = String(payload.fingerprint || '').trim();
    const derivedFingerprint =
      rawFingerprint ||
      [ns, commandName].filter(Boolean).join(':') ||
      (firstMessage && typeof firstMessage.msg === 'string'
        ? String(firstMessage.msg).trim()
        : '') ||
      (firstMessageRaw ? this.hashPayload(firstMessageRaw).slice(0, 24) : '');

    const occurredAtRaw =
      String(payload.occurredAt || '').trim() ||
      this.extractLogDate(firstMessage) ||
      String(first.timestamp || '').trim() ||
      String(raw.timestamp || '').trim();

    const resourceId =
      String(payload.instanceId || '').trim() ||
      String((raw as any).resourceId || '').trim() ||
      (attr && typeof attr.remote === 'string' ? attr.remote : '') ||
      String(raw.logStream || '').trim() ||
      null;

    const alarmName =
      derivedFingerprint ||
      String(raw.logGroup || '').trim() ||
      'slow-query-alert';

    return {
      fingerprint: derivedFingerprint || 'slow-query',
      occurredAtRaw,
      resourceId,
      alarmName,
      commandName: commandName || null,
      ns: ns || null,
      durationMillis:
        attr && Number.isFinite(Number(attr.durationMillis))
          ? Number(attr.durationMillis)
          : attr && Number.isFinite(Number(attr.workingMillis))
            ? Number(attr.workingMillis)
            : null,
      eventId: String(first.id || '').trim() || null,
      logGroup: String(raw.logGroup || '').trim() || null,
      logStream: String(raw.logStream || '').trim() || null,
    };
  }

  private getSqlPolicy(environmentId: string, requestMaxRows?: number): SqlPolicy {
    const env = this.environments.getEnvironmentById(environmentId);
    const aiops =
      (env?.database?.aiops as Record<string, unknown>) ||
      (env?.database?.ai_ops as Record<string, unknown>) ||
      {};

    const envWhitelistTables = this.normalizeStringArray(
      aiops.whitelist_tables || aiops.whitelistTables,
    );
    const envWhitelistDatabases = this.normalizeStringArray(
      aiops.whitelist_databases || aiops.whitelistDatabases,
    );

    const fallbackTables = this.normalizeStringArray(
      this.config.get<string>('AIOPS_SQL_WHITELIST_TABLES') || '',
    );
    const fallbackDatabases = this.normalizeStringArray(
      this.config.get<string>('AIOPS_SQL_WHITELIST_DATABASES') || '',
    );

    const defaultLimitFromCfg = Number(
      aiops.default_limit || aiops.defaultLimit || this.config.get<string>('AIOPS_SQL_DEFAULT_LIMIT') || 200,
    );
    const maxLimitFromCfg = Number(
      aiops.max_limit || aiops.maxLimit || this.config.get<string>('AIOPS_SQL_MAX_LIMIT') || 1000,
    );
    const timeoutMs = Number(
      aiops.timeout_ms || aiops.timeoutMs || this.config.get<string>('AIOPS_SQL_TIMEOUT_MS') || 5000,
    );

    const maxLimit = this.boundNumber(maxLimitFromCfg, 1, 10000, 1000);
    const requestCap = requestMaxRows ? Math.max(1, Math.min(maxLimit, requestMaxRows)) : maxLimit;
    const defaultLimit = Math.min(
      requestCap,
      this.boundNumber(defaultLimitFromCfg, 1, 10000, 200),
    );

    return {
      whitelistTables: envWhitelistTables.length > 0 ? envWhitelistTables : fallbackTables,
      whitelistDatabases: envWhitelistDatabases.length > 0 ? envWhitelistDatabases : fallbackDatabases,
      defaultLimit,
      maxLimit: requestCap,
      timeoutMs: this.boundNumber(timeoutMs, 1000, 60000, 5000),
    };
  }

  private async prepareSql(
    environmentId: string,
    body: { question?: string; sql?: string },
    policy: SqlPolicy,
    llmSessionKey: string,
  ): Promise<PreparedSql> {
    const question = String(body.question || '').trim();
    const sqlInput = String(body.sql || '').trim();

    if (!question && !sqlInput) {
      throw new BadRequestException('Either question or sql is required.');
    }

    const generatedFromQuestion = !sqlInput;

    if (generatedFromQuestion) {
      return this.prepareGeneratedSqlFromQuestion(
        environmentId,
        question,
        policy,
        llmSessionKey,
      );
    }

    const rawSql = sqlInput;
    const normalizedSql = this.normalizeSql(rawSql);
    this.validatePreviewSql(normalizedSql, policy, {
      requireQualifiedTableRefs: false,
    });
    const { executedSql, appliedLimit } = this.applyPreviewPolicy(normalizedSql, policy);

    return {
      rawSql,
      normalizedSql,
      executedSql,
      appliedLimit,
      generatedFromQuestion,
    };
  }

  private async prepareGeneratedSqlFromQuestion(
    environmentId: string,
    question: string,
    policy: SqlPolicy,
    llmSessionKey: string,
  ): Promise<PreparedSql> {
    const schemaContext = await this.buildSchemaContext(environmentId, policy, question);
    const fewshotContext = await this.buildFewshotContext(question, policy);

    let lastValidationMessage = '';
    let lastGeneratedSql = '';
    for (let attempt = 1; attempt <= this.sqlRewriteMaxAttempts; attempt += 1) {
      const rawSql = await this.generateSqlFromQuestion(
        question,
        policy,
        llmSessionKey,
        schemaContext,
        fewshotContext,
        attempt > 1 ? lastValidationMessage : undefined,
        attempt > 1 ? lastGeneratedSql : undefined,
      );

      try {
        const normalizedSql = this.normalizeSql(rawSql);
        this.validatePreviewSql(normalizedSql, policy, {
          requireQualifiedTableRefs: true,
        });
        const { executedSql, appliedLimit } = this.applyPreviewPolicy(normalizedSql, policy);

        return {
          rawSql,
          normalizedSql,
          executedSql,
          appliedLimit,
          generatedFromQuestion: true,
        };
      } catch (error) {
        if (!(error instanceof BadRequestException) || attempt >= this.sqlRewriteMaxAttempts) {
          throw error;
        }
        lastValidationMessage = this.errorMessage(error);
        lastGeneratedSql = rawSql;
        this.logger.warn(
          `NL2SQL validation failed, retrying (${attempt}/${this.sqlRewriteMaxAttempts}): ${lastValidationMessage}`,
        );
      }
    }

    throw new BadRequestException('Failed to generate valid SQL.');
  }

  private normalizeSql(sql: string) {
    const stripped = this.stripCodeFence(sql).trim();
    let normalized = stripped.replace(/[\u0000-\u001F]+/g, ' ').trim();

    while (normalized.endsWith(';')) {
      normalized = normalized.slice(0, -1).trim();
    }

    if (!normalized) {
      throw new BadRequestException('Empty SQL is not allowed.');
    }

    if (normalized.includes(';')) {
      throw new BadRequestException('Only a single SQL statement is allowed.');
    }

    if (/--|\/\*/.test(normalized)) {
      throw new BadRequestException('SQL comments are not allowed.');
    }

    return normalized;
  }

  private stripCodeFence(input: string) {
    const trimmed = input.trim();
    const match = trimmed.match(/^```(?:sql)?\s*([\s\S]*?)\s*```$/i);
    return match ? match[1].trim() : trimmed;
  }

  private validatePreviewSql(
    sql: string,
    policy: SqlPolicy,
    options?: { requireQualifiedTableRefs?: boolean },
  ) {
    const sqlType = this.classifySql(sql).sqlType;

    if (!['read', 'write'].includes(sqlType)) {
      throw new BadRequestException('Only read/write SQL is allowed in preview. DDL is not allowed.');
    }

    if (
      /\b(truncate|drop|alter|create|grant|revoke|merge|call|execute|handler|load\s+data|outfile|infile|optimize|repair|rename)\b/i.test(
        sql,
      )
    ) {
      throw new BadRequestException('Detected dangerous SQL keywords.');
    }

    if (/\bfor\s+update\b|\block\s+in\s+share\s+mode\b/i.test(sql)) {
      throw new BadRequestException('Locking clauses are not allowed.');
    }

    const tableRefs = this.filterPhysicalTableRefs(this.extractTableRefs(sql), sql);
    if (options?.requireQualifiedTableRefs) {
      const unqualifiedRefs = tableRefs.filter((ref) => !this.parseTableRef(ref).database);
      if (unqualifiedRefs.length > 0) {
        throw new BadRequestException(
          `Generated SQL must use fully qualified table names (db.table). Missing database for: ${unqualifiedRefs.join(', ')}`,
        );
      }
    }

    if (policy.whitelistTables.length > 0) {
      const patterns = policy.whitelistTables
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
      for (const ref of tableRefs) {
        const target = this.parseTableRef(ref);
        const matched = patterns.some((pattern) =>
          this.matchTablePattern(pattern, target),
        );
        if (!matched) {
          throw new BadRequestException(`Table is not in whitelist: ${ref}`);
        }
      }
    }

    if (policy.whitelistDatabases.length > 0) {
      const dbPatterns = policy.whitelistDatabases
        .map((v) => v.trim().toLowerCase())
        .filter(Boolean);
      for (const ref of tableRefs) {
        const target = this.parseTableRef(ref);
        if (!target.database) continue;
        const matched = dbPatterns.some((pattern) =>
          this.matchDatabasePattern(pattern, target.database!),
        );
        if (!matched) {
          throw new BadRequestException(
            `Database is not in whitelist: ${target.database}`,
          );
        }
      }
    }
  }

  private filterPhysicalTableRefs(tableRefs: string[], sql: string): string[] {
    const cteNames = this.extractCteNames(sql);
    return tableRefs.filter((ref) => {
      const target = this.parseTableRef(ref);
      if (target.database) return true;
      if (target.table === 'dual') return false;
      return !cteNames.has(target.table);
    });
  }

  private extractCteNames(sql: string): Set<string> {
    const names = new Set<string>();
    if (!/^\s*with\b/i.test(sql)) {
      return names;
    }

    const regex = /(?:\bwith\b|,)\s*([`"]?[\w$]+[`"]?)\s+as\s*\(/gi;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(sql)) !== null) {
      const cleaned = String(match[1] || '')
        .replace(/[`"]/g, '')
        .trim()
        .toLowerCase();
      if (cleaned) names.add(cleaned);
    }
    return names;
  }

  private extractTableRefs(sql: string): string[] {
    const refs = new Set<string>();
    const regex = /\b(?:from|join|update|into)\s+([`"'\w$.-]+)/gi;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(sql)) !== null) {
      const raw = String(match[1] || '').trim();
      if (!raw || raw.startsWith('(')) continue;
      if (/^select\b/i.test(raw)) continue;

      const normalized = raw.replace(/[`"']/g, '').trim();
      if (!normalized) continue;
      refs.add(normalized);
    }

    return Array.from(refs);
  }

  private parseTableRef(ref: string): { database: string | null; table: string; raw: string } {
    const cleaned = String(ref || '').trim().replace(/[`"']/g, '');
    const parts = cleaned.split('.').map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      return {
        database: parts[0].toLowerCase(),
        table: parts[parts.length - 1].toLowerCase(),
        raw: cleaned.toLowerCase(),
      };
    }
    return {
      database: null,
      table: cleaned.toLowerCase(),
      raw: cleaned.toLowerCase(),
    };
  }

  private matchTablePattern(
    pattern: string,
    target: { database: string | null; table: string; raw: string },
  ): boolean {
    const p = String(pattern || '').trim().toLowerCase();
    if (!p) return false;
    if (p === '*') return true;
    if (p === target.table || p === target.raw) return true;

    // spot.* / tiger.*
    if (p.endsWith('.*')) {
      const db = p.slice(0, -2);
      return !!target.database && target.database === db;
    }

    // *.table
    if (p.startsWith('*.')) {
      const table = p.slice(2);
      return target.table === table;
    }

    // db.table
    if (p.includes('.')) {
      const parts = p.split('.').map((v) => v.trim()).filter(Boolean);
      if (parts.length >= 2) {
        const db = parts[0];
        const table = parts[parts.length - 1];
        return !!target.database && target.database === db && target.table === table;
      }
    }
    return false;
  }

  private matchDatabasePattern(pattern: string, database: string): boolean {
    const p = String(pattern || '').trim().toLowerCase();
    if (!p) return false;
    if (p === '*') return true;
    if (p.endsWith('.*')) {
      return database === p.slice(0, -2);
    }
    return database === p;
  }

  private enforceLimit(sql: string, policy: SqlPolicy): { sql: string; appliedLimit: number | null } {
    const limitRegex = /\blimit\s+(\d+)(\s*,\s*(\d+))?/i;
    const match = sql.match(limitRegex);

    if (!match) {
      return {
        sql: `${sql} LIMIT ${policy.defaultLimit}`,
        appliedLimit: policy.defaultLimit,
      };
    }

    const first = Number(match[1]);
    const second = match[3] ? Number(match[3]) : null;

    if (second !== null) {
      if (second <= policy.maxLimit) {
        return { sql, appliedLimit: second };
      }
      return {
        sql: sql.replace(limitRegex, `LIMIT ${first}, ${policy.maxLimit}`),
        appliedLimit: policy.maxLimit,
      };
    }

    if (first <= policy.maxLimit) {
      return { sql, appliedLimit: first };
    }

    return {
      sql: sql.replace(limitRegex, `LIMIT ${policy.maxLimit}`),
      appliedLimit: policy.maxLimit,
    };
  }

  private attachExecutionHint(sql: string, timeoutMs: number) {
    if (/^select\b/i.test(sql)) {
      return sql.replace(/^select\b/i, `SELECT /*+ MAX_EXECUTION_TIME(${timeoutMs}) */`);
    }
    return sql;
  }

  private applyPreviewPolicy(
    normalizedSql: string,
    policy: SqlPolicy,
  ): { executedSql: string; appliedLimit: number | null } {
    const type = this.classifySql(normalizedSql).sqlType;
    if (type === 'read') {
      const { sql: limitedSql, appliedLimit } = this.enforceLimit(normalizedSql, policy);
      return {
        executedSql: this.attachExecutionHint(limitedSql, policy.timeoutMs),
        appliedLimit,
      };
    }
    return {
      executedSql: normalizedSql,
      appliedLimit: null,
    };
  }

  private async generateSqlFromQuestion(
    question: string,
    policy: SqlPolicy,
    llmSessionKey: string,
    schemaContext?: string,
    fewshotContext?: string,
    retryReason?: string,
    previousSql?: string,
  ) {
    if (!question) {
      throw new BadRequestException('question is empty.');
    }

    const llm = this.getOpenClawConfig();

    const tableHint = policy.whitelistTables.length > 0
      ? `Allowed tables: ${policy.whitelistTables.join(', ')}`
      : 'Allowed tables: use only business tables configured for the environment.';
    const databaseHint = policy.whitelistDatabases.length > 0
      ? `Allowed databases: ${policy.whitelistDatabases.join(', ')}`
      : 'Allowed databases: use only databases configured for the selected environment.';

    const systemPrompt = [
      'You are a SQL assistant for operations engineers.',
      'Return exactly one SQL statement and nothing else.',
      'You can generate read or write MySQL SQL.',
      'Allowed statement types: SELECT, SHOW, EXPLAIN, WITH+SELECT, INSERT, UPDATE, DELETE, REPLACE.',
      'Never generate DDL commands (CREATE/ALTER/DROP/TRUNCATE/RENAME/GRANT/REVOKE).',
      'Do not rewrite write intents into SELECT if user explicitly asks for update/delete/insert.',
      `For read SQL, include LIMIT and keep it <= ${policy.maxLimit}.`,
      'Always use fully qualified table names in the form db.table (example: spot.users).',
      'Never generate SQL with unqualified table names like FROM users.',
      databaseHint,
      tableHint,
      'Do not include markdown fences or comments.',
      'If previous SQL was rejected, strictly fix according to the validator reason.',
    ].join('\n');

    const endpoint = `${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    let resp: { data: any };
    try {
      const messages: Array<{ role: 'system' | 'user'; content: string }> = [
        {
          role: 'system',
          content: systemPrompt,
        },
      ];
      if (schemaContext) {
        messages.push({
          role: 'system',
          content: `Schema context (use only these references):\n${schemaContext}`,
        });
      }
      if (fewshotContext) {
        messages.push({
          role: 'system',
          content: fewshotContext,
        });
      }
      messages.push({
        role: 'user',
        content: question,
      });
      if (retryReason) {
        const retryParts = [
          `Validator rejection reason: ${retryReason}`,
          previousSql ? `Rejected SQL: ${previousSql}` : '',
          'Rewrite and return one corrected SQL only.',
        ]
          .filter(Boolean)
          .join('\n');
        messages.push({
          role: 'user',
          content: retryParts,
        });
      }

      resp = await axios.post(
        endpoint,
        {
          model: llm.model,
          user: llmSessionKey,
          messages,
          temperature: 0,
          max_tokens: 400,
        },
        {
          headers: {
            Authorization: `Bearer ${llm.token}`,
            'Content-Type': 'application/json',
            'x-openclaw-session-key': llmSessionKey,
          },
          timeout: 20000,
        },
      );
    } catch (error) {
      throw new BadGatewayException(
        `OpenClaw request failed: ${this.errorMessage(error)}`,
      );
    }

    const outputText = this.extractOpenClawText(resp.data);
    if (!outputText) {
      throw new BadRequestException('Model returned empty SQL output.');
    }

    return this.stripCodeFence(outputText);
  }

  private async buildSchemaContext(
    environmentId: string,
    policy: SqlPolicy,
    question: string,
  ): Promise<string> {
    const allTables = await this.getSchemaTablesFromCache(environmentId, policy);
    if (allTables.length === 0) {
      return '';
    }

    const ranked = this.rankTablesForQuestion(allTables, question);
    const withScore = ranked.filter((item) => item.score > 0);
    const picked = (withScore.length > 0 ? withScore : ranked)
      .slice(0, this.schemaPromptMaxTables)
      .map((item) => item.table);

    const lines = picked.map((item) => {
      const cols = item.columns.slice(0, this.schemaPromptMaxColumns);
      const remaining = Math.max(0, item.columns.length - cols.length);
      const suffix = remaining > 0 ? `, ...(+${remaining})` : '';
      return `- ${item.database}.${item.table}: ${cols.join(', ')}${suffix}`;
    });

    if (lines.length === 0) {
      return '';
    }

    const omitted = Math.max(0, allTables.length - picked.length);
    const note =
      omitted > 0
        ? `\n- ...(omitted ${omitted} additional allowed tables for brevity)`
        : '';
    return `Known schema references:\n${lines.join('\n')}${note}`;
  }

  private async getSchemaTablesFromCache(
    environmentId: string,
    policy: SqlPolicy,
  ): Promise<SchemaTableSummary[]> {
    const cacheKey = this.buildSchemaCacheKey(environmentId, policy);
    const now = Date.now();
    const cached = this.schemaCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.tables;
    }

    const tables = await this.loadSchemaTables(environmentId, policy);
    this.schemaCache.set(cacheKey, {
      tables,
      expiresAt: now + this.schemaCacheTtlMs,
    });
    return tables;
  }

  private buildSchemaCacheKey(environmentId: string, policy: SqlPolicy): string {
    const dbPart = [...policy.whitelistDatabases].map((v) => v.trim().toLowerCase()).sort().join(',');
    const tablePart = [...policy.whitelistTables].map((v) => v.trim().toLowerCase()).sort().join(',');
    return `${environmentId}::db=${dbPart}::tbl=${tablePart}`;
  }

  private async loadSchemaTables(
    environmentId: string,
    policy: SqlPolicy,
  ): Promise<SchemaTableSummary[]> {
    const sql = `
      SELECT
        TABLE_SCHEMA AS tableSchema,
        TABLE_NAME AS tableName,
        COLUMN_NAME AS columnName,
        ORDINAL_POSITION AS ordinalPosition
      FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
      ORDER BY TABLE_SCHEMA ASC, TABLE_NAME ASC, ORDINAL_POSITION ASC
      LIMIT 12000
    `;

    try {
      const [rows] = await this.database.runQuery(environmentId, sql);
      if (!Array.isArray(rows)) return [];

      const byTable = new Map<string, SchemaTableSummary>();
      for (const row of rows as SchemaColumnRow[]) {
        const database = String(row.tableSchema || '').trim().toLowerCase();
        const table = String(row.tableName || '').trim().toLowerCase();
        const column = String(row.columnName || '').trim().toLowerCase();
        if (!database || !table || !column) continue;
        if (!this.isTableAllowedByPolicy(database, table, policy)) continue;

        const key = `${database}.${table}`;
        const existing = byTable.get(key);
        if (!existing) {
          byTable.set(key, {
            database,
            table,
            columns: [column],
          });
          continue;
        }
        if (!existing.columns.includes(column)) {
          existing.columns.push(column);
        }
      }

      return Array.from(byTable.values()).sort((a, b) =>
        `${a.database}.${a.table}`.localeCompare(`${b.database}.${b.table}`),
      );
    } catch (error) {
      this.logger.warn(`Failed to load schema metadata: ${this.errorMessage(error)}`);
      return [];
    }
  }

  private isTableAllowedByPolicy(database: string, table: string, policy: SqlPolicy): boolean {
    const target = {
      database,
      table,
      raw: `${database}.${table}`,
    };

    if (policy.whitelistTables.length > 0) {
      const matched = policy.whitelistTables.some((pattern) =>
        this.matchTablePattern(pattern, target),
      );
      if (!matched) return false;
    }

    if (policy.whitelistDatabases.length > 0) {
      const matchedDb = policy.whitelistDatabases.some((pattern) =>
        this.matchDatabasePattern(pattern, database),
      );
      if (!matchedDb) return false;
    }

    return true;
  }

  private rankTablesForQuestion(
    tables: SchemaTableSummary[],
    question: string,
  ): Array<{ table: SchemaTableSummary; score: number }> {
    const tokens = this.extractQuestionTokens(question);
    const explicitRefs = this.extractExplicitQuestionRefs(question);

    return tables
      .map((table) => ({
        table,
        score: this.scoreTableForQuestion(table, tokens, explicitRefs),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return `${a.table.database}.${a.table.table}`.localeCompare(
          `${b.table.database}.${b.table.table}`,
        );
      });
  }

  private scoreTableForQuestion(
    table: SchemaTableSummary,
    tokens: string[],
    explicitRefs: Set<string>,
  ): number {
    const fullName = `${table.database}.${table.table}`;
    let score = explicitRefs.has(fullName) ? 100 : 0;

    for (const token of tokens) {
      if (token === table.table) score += 24;
      else if (table.table.includes(token)) score += 8;

      if (token === table.database) score += 12;
      else if (table.database.includes(token)) score += 4;

      for (const col of table.columns) {
        if (token === col) {
          score += 5;
          break;
        }
        if (col.includes(token)) {
          score += 2;
          break;
        }
      }
    }

    return score;
  }

  private extractQuestionTokens(question: string): string[] {
    const text = String(question || '').toLowerCase();
    const matches = text.match(/[a-z_][a-z0-9_]{1,63}/g) || [];
    const stopWords = new Set([
      'select',
      'from',
      'where',
      'join',
      'limit',
      'count',
      'and',
      'or',
      'with',
      'show',
      'explain',
    ]);
    return Array.from(new Set(matches.filter((token) => !stopWords.has(token))));
  }

  private extractExplicitQuestionRefs(question: string): Set<string> {
    const refs = new Set<string>();
    const text = String(question || '').toLowerCase();
    const regex = /\b([a-z_][a-z0-9_]*)\.([a-z_][a-z0-9_]*)\b/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(text)) !== null) {
      refs.add(`${match[1]}.${match[2]}`);
    }
    return refs;
  }

  private async buildFewshotContext(
    question: string,
    policy: SqlPolicy,
  ): Promise<string> {
    const rows = await this.getFewshotRows();
    if (rows.length === 0) {
      return '';
    }

    const normalizedQuestion = String(question || '').trim().toLowerCase();
    const questionTokens = this.extractQuestionTokens(question);
    const questionNumbers = this.extractNumericTokens(question);

    const strictRows = rows.filter((row) =>
      this.isFewshotCaseCompatible(row, policy, {
        allowUnqualifiedRefs: false,
      }),
    );
    const candidateRows =
      strictRows.length > 0
        ? strictRows
        : rows.filter((row) =>
            this.isFewshotCaseCompatible(row, policy, {
              allowUnqualifiedRefs: true,
            }),
          );

    const scored = candidateRows
      .map((row) => ({
        row,
        score: this.scoreFewshotCase(row, normalizedQuestion, questionTokens, questionNumbers),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return this.scorePriority(b.row.priority) - this.scorePriority(a.row.priority);
      });

    if (scored.length === 0) {
      return '';
    }

    const withScore = scored.filter((item) => item.score > 0);
    const maxCases = this.getFewshotMaxCases();
    const picked = (withScore.length > 0 ? withScore : scored)
      .slice(0, maxCases)
      .map((item) => item.row);
    if (picked.length === 0) {
      return '';
    }

    const lines: string[] = [
      'Few-shot SQL examples (for style/reference only, do not copy literals blindly):',
      'Hard rule: output SQL must satisfy whitelist + use db.table. LIMIT is mandatory for read SQL.',
    ];
    for (const row of picked) {
      lines.push(`[${row.caseId}] Q: ${row.userQuestion}`);
      lines.push(`SQL: ${row.expectedSql}`);
      if (row.mustConditions) {
        lines.push(`Must: ${row.mustConditions}`);
      }
      if (row.forbiddenPatterns) {
        lines.push(`Avoid: ${row.forbiddenPatterns}`);
      }
    }

    const text = lines.join('\n');
    if (text.length <= this.fewshotPromptMaxChars) {
      return text;
    }
    return `${text.slice(0, this.fewshotPromptMaxChars)}\n...(few-shot context truncated)`;
  }

  private getFewshotMaxCases(): number {
    const configured = Number(
      String(this.config.get<string>('AIOPS_NL2SQL_FEWSHOT_MAX_CASES') || '').trim(),
    );
    if (Number.isFinite(configured) && configured > 0) {
      return Math.min(12, Math.floor(configured));
    }
    return this.fewshotPromptMaxCases;
  }

  private async getFewshotRows(): Promise<FewshotCaseRow[]> {
    const sourcePath = await this.resolveFewshotCasesPath();
    if (!sourcePath) {
      return [];
    }

    const now = Date.now();
    if (
      this.fewshotCache &&
      this.fewshotCache.sourcePath === sourcePath &&
      this.fewshotCache.expiresAt > now
    ) {
      return this.fewshotCache.rows;
    }

    let content = '';
    try {
      content = await fs.readFile(sourcePath, 'utf8');
    } catch (error) {
      this.logger.warn(`Failed to read few-shot CSV: ${this.errorMessage(error)}`);
      return [];
    }

    const rows = this.parseFewshotRows(content);
    this.fewshotCache = {
      sourcePath,
      rows,
      expiresAt: now + this.fewshotCacheTtlMs,
    };
    return rows;
  }

  private async resolveFewshotCasesPath(): Promise<string | null> {
    const configured = String(
      this.config.get<string>('AIOPS_NL2SQL_FEWSHOT_CASES_PATH') || '',
    ).trim();
    const candidates = [
      configured ? path.resolve(configured) : '',
      path.resolve(process.cwd(), 'docs/ai-ops-fewshot-data/nl2sql_fewshot_cases.csv'),
      path.resolve(process.cwd(), '../docs/ai-ops-fewshot-data/nl2sql_fewshot_cases.csv'),
      path.resolve(__dirname, '../../../docs/ai-ops-fewshot-data/nl2sql_fewshot_cases.csv'),
    ].filter(Boolean);

    for (const candidate of candidates) {
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        continue;
      }
    }
    return null;
  }

  private parseFewshotRows(csvText: string): FewshotCaseRow[] {
    const rows = this.parseCsvRows(csvText);
    if (rows.length === 0) {
      return [];
    }

    const header = rows[0].map((name) => this.normalizeFewshotHeader(name));
    const headerLen = header.length;
    if (headerLen === 0) {
      return [];
    }

    const indexByName = new Map<string, number>();
    header.forEach((name, idx) => {
      indexByName.set(name, idx);
    });
    const expectedSqlIdx = indexByName.get('expected_sql') ?? -1;

    const result: FewshotCaseRow[] = [];
    for (let i = 1; i < rows.length; i += 1) {
      const rawRow = rows[i];
      if (!rawRow || rawRow.length === 0) continue;

      let row = rawRow.map((v) => String(v || '').trim());
      if (row.every((v) => !v)) continue;

      if (row.length > headerLen && expectedSqlIdx >= 0) {
        const overflow = row.length - headerLen;
        row = [
          ...row.slice(0, expectedSqlIdx),
          row.slice(expectedSqlIdx, expectedSqlIdx + overflow + 1).join(','),
          ...row.slice(expectedSqlIdx + overflow + 1),
        ];
      }
      if (row.length < headerLen) {
        row = [...row, ...Array(headerLen - row.length).fill('')];
      }

      const get = (name: string): string => {
        const idx = indexByName.get(name);
        if (typeof idx !== 'number' || idx < 0) return '';
        return String(row[idx] || '').trim();
      };

      const userQuestion = get('user_question');
      const expectedSql = get('expected_sql');
      if (!userQuestion || !expectedSql) continue;

      result.push({
        caseId: get('case_id') || `ROW_${i}`,
        priority: get('priority'),
        intentType: get('intent_type'),
        userQuestion,
        expectedSql,
        mustConditions: get('must_conditions'),
        forbiddenPatterns: get('forbidden_patterns'),
        allowedDatabases: this.parseDelimitedValues(get('allowed_databases')),
        allowedTables: this.parseDelimitedValues(get('allowed_tables')),
        reviewStatus: get('review_status').toLowerCase(),
      });
    }
    return result;
  }

  private normalizeFewshotHeader(header: string): string {
    return String(header || '')
      .replace(/^\uFEFF/, '')
      .replace(/（[^）]*）/g, '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+/g, '')
      .trim()
      .toLowerCase();
  }

  private parseCsvRows(csvText: string): string[][] {
    const text = String(csvText || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cell += '"';
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cell += ch;
        }
        continue;
      }

      if (ch === '"') {
        inQuotes = true;
        continue;
      }
      if (ch === ',') {
        row.push(cell);
        cell = '';
        continue;
      }
      if (ch === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
        continue;
      }
      cell += ch;
    }

    if (cell.length > 0 || row.length > 0) {
      row.push(cell);
      rows.push(row);
    }
    return rows;
  }

  private parseDelimitedValues(raw: string): string[] {
    return String(raw || '')
      .split(/[;,]/)
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);
  }

  private isFewshotCaseCompatible(
    row: FewshotCaseRow,
    policy: SqlPolicy,
    options?: { allowUnqualifiedRefs?: boolean },
  ): boolean {
    const status = row.reviewStatus;
    if (status && !['approved', 'reviewed'].includes(status)) {
      return false;
    }

    const sqlType = this.classifySql(row.expectedSql).sqlType;
    if (!['read', 'write'].includes(sqlType)) {
      return false;
    }

    if (!options?.allowUnqualifiedRefs) {
      const refs = this.filterPhysicalTableRefs(
        this.extractTableRefs(row.expectedSql),
        row.expectedSql,
      );
      const hasUnqualified = refs.some((ref) => !this.parseTableRef(ref).database);
      if (hasUnqualified) {
        return false;
      }
    }

    if (policy.whitelistDatabases.length > 0 && row.allowedDatabases.length > 0) {
      const dbMatched = row.allowedDatabases.some((db) =>
        policy.whitelistDatabases.some((pattern) => this.matchDatabasePattern(pattern, db)),
      );
      if (!dbMatched) return false;
    }

    if (policy.whitelistTables.length > 0 && row.allowedTables.length > 0) {
      const tableMatched = row.allowedTables.some((tablePattern) =>
        this.isFewshotTablePatternAllowed(tablePattern, policy.whitelistTables),
      );
      if (!tableMatched) return false;
    }

    return true;
  }

  private isFewshotTablePatternAllowed(tablePattern: string, policyPatterns: string[]): boolean {
    const normalized = String(tablePattern || '').trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === '*') {
      return policyPatterns.some((pattern) => String(pattern || '').trim().toLowerCase() === '*');
    }
    if (normalized.endsWith('.*')) {
      const db = normalized.slice(0, -2);
      return policyPatterns.some((pattern) => {
        const p = String(pattern || '').trim().toLowerCase();
        return p === '*' || p === `${db}.*` || p.startsWith(`${db}.`);
      });
    }
    if (normalized.includes('.')) {
      const target = this.parseTableRef(normalized);
      return policyPatterns.some((pattern) => this.matchTablePattern(pattern, target));
    }
    return policyPatterns.some((pattern) => {
      const p = String(pattern || '').trim().toLowerCase();
      return p === '*' || p === normalized || p === `*.${normalized}`;
    });
  }

  private scoreFewshotCase(
    row: FewshotCaseRow,
    normalizedQuestion: string,
    questionTokens: string[],
    questionNumbers: string[],
  ): number {
    const rowQuestion = row.userQuestion.toLowerCase();
    const rowSql = row.expectedSql.toLowerCase();
    const compactQuestion = normalizedQuestion.replace(/\s+/g, '');
    const compactRowQuestion = rowQuestion.replace(/\s+/g, '');
    let score = this.scorePriority(row.priority);

    if (row.reviewStatus === 'approved') score += 4;
    else if (row.reviewStatus === 'reviewed') score += 2;

    if (compactQuestion && compactRowQuestion) {
      if (compactRowQuestion.includes(compactQuestion)) score += 40;
      else if (compactQuestion.includes(compactRowQuestion)) score += 30;
    }

    const rowTokens = new Set([
      ...this.extractQuestionTokens(row.userQuestion),
      ...this.extractQuestionTokens(row.expectedSql),
    ]);
    for (const token of questionTokens) {
      if (rowTokens.has(token)) score += 6;
      else if (rowQuestion.includes(token) || rowSql.includes(token)) score += 2;
    }

    const rowNumbers = new Set(this.extractNumericTokens(`${row.userQuestion} ${row.expectedSql}`));
    for (const num of questionNumbers) {
      if (rowNumbers.has(num)) score += 8;
    }

    if (row.intentType && normalizedQuestion.includes(row.intentType.toLowerCase())) {
      score += 4;
    }
    return score;
  }

  private extractNumericTokens(text: string): string[] {
    const matches = String(text || '').match(/\b\d{3,}\b/g) || [];
    return Array.from(new Set(matches));
  }

  private scorePriority(priority: string): number {
    const p = String(priority || '').trim().toLowerCase();
    if (p === 'p0') return 5;
    if (p === 'p1') return 3;
    if (p === 'p2') return 1;
    return 0;
  }

  private buildLlmSessionKey(
    environmentId: string,
    actor: ActorContext,
    externalSessionId?: string,
  ): string {
    const ext = String(externalSessionId || '').trim();
    if (ext) {
      return `dashboard:aiops:${this.normalizeSessionPart(environmentId)}:${this.normalizeSessionPart(ext)}`;
    }
    const actorPart = actor.userId
      ? `uid-${actor.userId}`
      : this.normalizeSessionPart(actor.username || 'anonymous');
    return `dashboard:aiops:${this.normalizeSessionPart(environmentId)}:${actorPart}`;
  }

  private normalizeSessionPart(value: string): string {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9:_-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return normalized || 'default';
  }

  private getOpenClawConfig(): OpenClawConfig {
    const provider = (this.config.get<string>('AIOPS_LLM_PROVIDER') || 'openclaw')
      .trim()
      .toLowerCase();
    if (provider !== 'openclaw') {
      throw new BadRequestException(
        `Unsupported AIOPS_LLM_PROVIDER "${provider}". Only "openclaw" is supported.`,
      );
    }

    const baseUrl = String(this.config.get<string>('AIOPS_OPENCLAW_BASE_URL') || '').trim();
    if (!baseUrl) {
      throw new BadRequestException('AIOPS_OPENCLAW_BASE_URL is not configured.');
    }
    const token = String(this.config.get<string>('AIOPS_OPENCLAW_TOKEN') || '').trim();
    if (!token) {
      throw new BadRequestException('AIOPS_OPENCLAW_TOKEN is not configured.');
    }
    const model =
      String(this.config.get<string>('AIOPS_OPENCLAW_MODEL') || '').trim() ||
      'openclaw/default';

    return {
      provider: 'openclaw',
      baseUrl,
      token,
      model,
    };
  }

  private extractOpenClawText(responseData: any): string {
    const choices = Array.isArray(responseData?.choices) ? responseData.choices : [];
    const first = choices[0];
    const content = first?.message?.content;
    if (typeof content === 'string' && content.trim()) {
      return content.trim();
    }
    if (Array.isArray(content)) {
      const text = content
        .map((item) => (typeof item?.text === 'string' ? item.text : ''))
        .join('\n')
        .trim();
      if (text) return text;
    }
    return '';
  }

  private extractOpenClawModels(responseData: any): string[] {
    const data = Array.isArray(responseData?.data) ? responseData.data : [];
    return data
      .map((item) => String(item?.id || '').trim())
      .filter(Boolean);
  }

  private ensureIngestToken(tokenHeader?: string) {
    const expected = (this.config.get<string>('AIOPS_EVENT_INGEST_TOKEN') || '').trim();
    if (!expected) {
      return;
    }
    if (String(tokenHeader || '').trim() !== expected) {
      throw new UnauthorizedException('Invalid ingest token.');
    }
  }

  private inferEnvironmentIdFromCloudWatch(payload: CloudWatchEventDto): string {
    const alarmName = String(payload.AlarmName || '').trim();
    if (!alarmName) return '';

    const byEks = alarmName.match(/^([a-zA-Z0-9_-]+)-eks-/);
    if (byEks?.[1]) return byEks[1];

    const byDash = alarmName.split('-')[0];
    return byDash || '';
  }

  private extractCloudWatchResourceId(payload: CloudWatchEventDto): string | null {
    const dimensions = payload?.Trigger?.Dimensions;
    if (Array.isArray(dimensions)) {
      for (const d of dimensions) {
        if (!d || typeof d !== 'object') continue;
        const name = String((d as any).name || (d as any).Name || '').toLowerCase();
        if (!name) continue;
        if (name.includes('instance') || name.includes('resource')) {
          const value = String((d as any).value || (d as any).Value || '').trim();
          if (value) return value;
        }
      }
    }
    return null;
  }

  private parseDateTime(value: string): string | null {
    if (!value) return null;
    const numeric = Number(value);
    const d = Number.isFinite(numeric) && /^\d+$/.test(value.trim())
      ? new Date(numeric > 1_000_000_000_000 ? numeric : numeric * 1000)
      : new Date(value);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 19).replace('T', ' ');
  }

  private extractLogDate(input: Record<string, unknown> | null): string {
    if (!input || typeof input !== 'object') return '';
    const t = input.t as Record<string, unknown> | undefined;
    if (!t || typeof t !== 'object') return '';
    const iso = t.$date;
    if (typeof iso !== 'string') return '';
    return iso.trim();
  }

  private tryParseJson(input: string): Record<string, unknown> | null {
    const text = String(input || '').trim();
    if (!text) return null;
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }

  private hashPayload(payload: unknown) {
    const text = JSON.stringify(payload) || '';
    return crypto.createHash('sha1').update(text).digest('hex');
  }

  private normalizeStringArray(input: unknown): string[] {
    if (Array.isArray(input)) {
      return input
        .map((v) => String(v || '').trim())
        .filter(Boolean);
    }
    const text = String(input || '').trim();
    if (!text) return [];
    return text
      .split(/[\n,]/)
      .map((v) => v.trim())
      .filter(Boolean);
  }

  private boundNumber(value: number, min: number, max: number, fallback: number) {
    if (!Number.isFinite(value)) return fallback;
    return Math.max(min, Math.min(max, Math.floor(value)));
  }

  private async ensureSession(environmentId: string, actor: ActorContext, externalSessionId?: string) {
    const result = await this.platformDb.query<mysql.ResultSetHeader>(
      `INSERT INTO aiops_sessions
        (external_session_id, environment_id, actor_user_id, actor_username, title, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
      [
        externalSessionId || null,
        environmentId,
        actor.userId,
        actor.username,
        'ai-ops session',
      ],
    );
    return Number((result as any).insertId || 0);
  }

  private async insertAction(params: {
    environmentId: string;
    actor: ActorContext;
    sessionId?: string;
    actionType: string;
    status: 'ok' | 'error';
    requestPayload?: unknown;
    responsePayload?: unknown;
    errorMessage?: string;
    durationMs?: number;
  }) {
    const sessionPk = await this.ensureSession(
      params.environmentId,
      params.actor,
      params.sessionId,
    );

    const result = await this.platformDb.query<mysql.ResultSetHeader>(
      `INSERT INTO aiops_actions
        (session_id, environment_id, actor_user_id, actor_username, action_type, status,
         request_json, response_json, error_message, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        sessionPk || null,
        params.environmentId,
        params.actor.userId,
        params.actor.username,
        params.actionType,
        params.status,
        params.requestPayload ? JSON.stringify(params.requestPayload) : null,
        params.responsePayload ? JSON.stringify(params.responsePayload) : null,
        params.errorMessage || null,
        params.durationMs || null,
      ],
    );

    return Number((result as any).insertId || 0);
  }

  private async safeInsertAction(params: {
    environmentId: string;
    actor: ActorContext;
    sessionId?: string;
    actionType: string;
    status: 'ok' | 'error';
    requestPayload?: unknown;
    responsePayload?: unknown;
    errorMessage?: string;
    durationMs?: number;
  }) {
    try {
      return await this.insertAction(params);
    } catch (error) {
      this.logger.warn(
        `Audit action insert failed (${params.actionType}): ${this.errorMessage(error)}`,
      );
      return null;
    }
  }

  private async insertSqlAudit(params: {
    actionId: number | null;
    environmentId: string;
    actor: ActorContext;
    question?: string;
    generatedSql?: string | null;
    executedSql?: string | null;
    limitApplied?: number | null;
    maxExecutionTimeMs: number;
    rowCount?: number | null;
    sqlType?: SqlType;
    riskLevel?: RiskLevel;
    status: string;
    errorMessage?: string;
  }) {
    await this.platformDb.query(
      `INSERT INTO aiops_sql_audit
        (action_id, environment_id, actor_user_id, actor_username,
         question, generated_sql, executed_sql, limit_applied,
         max_execution_time_ms, row_count, sql_type, risk_level, status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
      [
        params.actionId,
        params.environmentId,
        params.actor.userId,
        params.actor.username,
        params.question || null,
        params.generatedSql || null,
        params.executedSql || null,
        params.limitApplied ?? null,
        params.maxExecutionTimeMs,
        params.rowCount ?? null,
        params.sqlType || null,
        params.riskLevel || null,
        params.status,
        params.errorMessage || null,
      ],
    );
  }

  private async safeInsertSqlAudit(params: {
    actionId: number | null;
    environmentId: string;
    actor: ActorContext;
    question?: string;
    generatedSql?: string | null;
    executedSql?: string | null;
    limitApplied?: number | null;
    maxExecutionTimeMs: number;
    rowCount?: number | null;
    sqlType?: SqlType;
    riskLevel?: RiskLevel;
    status: string;
    errorMessage?: string;
  }) {
    try {
      await this.insertSqlAudit(params);
    } catch (error) {
      this.logger.warn(
        `SQL audit insert failed (${params.status}): ${this.errorMessage(error)}`,
      );
    }
  }

  private classifySql(sql: string | null | undefined): { sqlType: SqlType; riskLevel: RiskLevel } {
    const text = String(sql || '').trim().toLowerCase();
    if (!text) {
      return { sqlType: 'unknown', riskLevel: 'medium' };
    }

    if (/^(create|alter|drop|truncate|rename|grant|revoke)\b/.test(text)) {
      return { sqlType: 'ddl', riskLevel: 'critical' };
    }
    if (/^(insert|update|delete|replace|merge)\b/.test(text)) {
      return { sqlType: 'write', riskLevel: 'high' };
    }
    if (/^(select|show|explain|with)\b/.test(text)) {
      return { sqlType: 'read', riskLevel: 'low' };
    }
    if (/\b(create|alter|drop|truncate|rename|grant|revoke)\b/.test(text)) {
      return { sqlType: 'ddl', riskLevel: 'critical' };
    }
    if (/\b(insert|update|delete|replace|merge)\b/.test(text)) {
      return { sqlType: 'write', riskLevel: 'high' };
    }
    return { sqlType: 'unknown', riskLevel: 'medium' };
  }

  private async insertIngestEvent(params: {
    environmentId: string;
    eventType: string;
    source: string;
    dedupeKey: string;
    severity: string;
    resourceId: string | null;
    alarmName: string | null;
    occurredAt: string | null;
    payload: unknown;
  }): Promise<boolean> {
    const result = await this.platformDb.query<mysql.ResultSetHeader>(
      `INSERT INTO aiops_ingest_events
        (environment_id, event_type, source, dedupe_key, severity, resource_id, alarm_name, occurred_at, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE dedupe_key = dedupe_key`,
      [
        params.environmentId,
        params.eventType,
        params.source,
        params.dedupeKey,
        params.severity,
        params.resourceId,
        params.alarmName,
        params.occurredAt,
        JSON.stringify(params.payload || {}),
      ],
    );

    const affectedRows = Number((result as any).affectedRows || 0);
    return affectedRows === 1;
  }

  private errorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }
}
