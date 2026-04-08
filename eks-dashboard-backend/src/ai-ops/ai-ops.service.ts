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
import type * as mysql from 'mysql2/promise';
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

@Injectable()
export class AiOpsService {
  private readonly logger = new Logger(AiOpsService.name);

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

    let actionId: number | null = null;
    let prepared: PreparedSql | null = null;
    try {
      prepared = await this.prepareSql(body, policy);

      actionId = await this.insertAction({
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

      await this.insertSqlAudit({
        actionId,
        environmentId,
        actor,
        question: body.question,
        generatedSql: prepared.generatedFromQuestion ? prepared.rawSql : null,
        executedSql: prepared.executedSql,
        limitApplied: prepared.appliedLimit,
        maxExecutionTimeMs: policy.timeoutMs,
        rowCount: null,
        status: 'previewed',
      });

      return {
        ok: true,
        source: prepared.generatedFromQuestion ? 'question' : 'sql',
        normalizedSql: prepared.normalizedSql,
        executedSql: prepared.executedSql,
        appliedLimit: prepared.appliedLimit,
        timeoutMs: policy.timeoutMs,
      };
    } catch (error) {
      await this.insertAction({
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
      throw error;
    }
  }

  async executeSql(environmentId: string, actor: ActorContext, body: SqlExecuteDto) {
    this.ensurePermissions(actor, ['menu:ai-ops', 'aiops:sql:execute']);
    const actionStartedAt = Date.now();
    const policy = this.getSqlPolicy(environmentId, body.maxRows);

    let actionId: number | null = null;
    let prepared: PreparedSql | null = null;
    let rowCount = 0;
    try {
      prepared = await this.prepareSql(body, policy);

      const [rows] = await this.database.runQuery(environmentId, prepared.executedSql);
      if (!Array.isArray(rows)) {
        throw new BadRequestException('Only read-only queries are allowed.');
      }

      rowCount = rows.length;

      actionId = await this.insertAction({
        environmentId,
        actor,
        sessionId: body.sessionId,
        actionType: 'sql.execute',
        status: 'ok',
        requestPayload: { question: body.question, sql: body.sql, maxRows: body.maxRows },
        responsePayload: {
          normalizedSql: prepared.normalizedSql,
          executedSql: prepared.executedSql,
          rowCount,
        },
        durationMs: Date.now() - actionStartedAt,
      });

      await this.insertSqlAudit({
        actionId,
        environmentId,
        actor,
        question: body.question,
        generatedSql: prepared.generatedFromQuestion ? prepared.rawSql : null,
        executedSql: prepared.executedSql,
        limitApplied: prepared.appliedLimit,
        maxExecutionTimeMs: policy.timeoutMs,
        rowCount,
        status: 'executed',
      });

      return {
        ok: true,
        source: prepared.generatedFromQuestion ? 'question' : 'sql',
        executedSql: prepared.executedSql,
        appliedLimit: prepared.appliedLimit,
        rowCount,
        rows,
      };
    } catch (error) {
      actionId = await this.insertAction({
        environmentId,
        actor,
        sessionId: body.sessionId,
        actionType: 'sql.execute',
        status: 'error',
        requestPayload: { question: body.question, sql: body.sql, maxRows: body.maxRows },
        responsePayload: prepared
          ? {
              normalizedSql: prepared.normalizedSql,
              executedSql: prepared.executedSql,
              rowCount,
            }
          : null,
        errorMessage: this.errorMessage(error),
        durationMs: Date.now() - actionStartedAt,
      });

      await this.insertSqlAudit({
        actionId,
        environmentId,
        actor,
        question: body.question,
        generatedSql: prepared?.generatedFromQuestion ? prepared.rawSql : null,
        executedSql: prepared?.executedSql,
        limitApplied: prepared?.appliedLimit ?? null,
        maxExecutionTimeMs: policy.timeoutMs,
        rowCount,
        status: 'error',
        errorMessage: this.errorMessage(error),
      });
      throw error;
    }
  }

  async listSqlAudit(environmentId: string, actor: ActorContext, page = 1, size = 20) {
    this.ensurePermissions(actor, ['menu:ai-ops']);
    const safePage = Math.max(1, Math.floor(page));
    const safeSize = Math.min(100, Math.max(1, Math.floor(size)));
    const offset = (safePage - 1) * safeSize;

    const rows = await this.platformDb.query<any[]>(
      `SELECT id, action_id, environment_id, actor_user_id, actor_username,
              question, generated_sql, executed_sql, limit_applied,
              max_execution_time_ms, row_count, status, error_message, created_at
       FROM aiops_sql_audit
       WHERE environment_id = ?
       ORDER BY id DESC
       LIMIT ? OFFSET ?`,
      [environmentId, safeSize, offset],
    );

    const totalRows = await this.platformDb.query<{ total: number }[]>(
      'SELECT COUNT(1) AS total FROM aiops_sql_audit WHERE environment_id = ?',
      [environmentId],
    );

    return {
      page: safePage,
      size: safeSize,
      total: Number(totalRows?.[0]?.total || 0),
      items: rows,
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
    body: { question?: string; sql?: string },
    policy: SqlPolicy,
  ): Promise<PreparedSql> {
    const question = String(body.question || '').trim();
    const sqlInput = String(body.sql || '').trim();

    if (!question && !sqlInput) {
      throw new BadRequestException('Either question or sql is required.');
    }

    const generatedFromQuestion = !sqlInput;
    const rawSql = generatedFromQuestion
      ? await this.generateSqlFromQuestion(question, policy)
      : sqlInput;

    const normalizedSql = this.normalizeSql(rawSql);
    this.validateReadOnlySql(normalizedSql, policy);

    const { sql: limitedSql, appliedLimit } = this.enforceLimit(normalizedSql, policy);
    const executedSql = this.attachExecutionHint(limitedSql, policy.timeoutMs);

    return {
      rawSql,
      normalizedSql,
      executedSql,
      appliedLimit,
      generatedFromQuestion,
    };
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

  private validateReadOnlySql(sql: string, policy: SqlPolicy) {
    if (!/^(select|show|explain|with)\b/i.test(sql)) {
      throw new BadRequestException('Only SELECT/SHOW/EXPLAIN/CTE queries are allowed.');
    }

    if (
      /\b(insert|update|delete|replace|truncate|drop|alter|create|grant|revoke|merge|call|execute|handler|load\s+data|outfile|infile|optimize|repair|rename|set\s+)\b/i.test(
        sql,
      )
    ) {
      throw new BadRequestException('Detected non-read-only SQL keywords.');
    }

    if (/\bfor\s+update\b|\block\s+in\s+share\s+mode\b/i.test(sql)) {
      throw new BadRequestException('Locking clauses are not allowed.');
    }

    const tableRefs = this.extractTableRefs(sql);
    if (policy.whitelistTables.length > 0) {
      const allowed = new Set(policy.whitelistTables.map((v) => v.toLowerCase()));
      for (const ref of tableRefs) {
        const normalized = ref.toLowerCase();
        const tableOnly = normalized.split('.').pop() || normalized;
        if (!allowed.has(normalized) && !allowed.has(tableOnly)) {
          throw new BadRequestException(`Table is not in whitelist: ${ref}`);
        }
      }
    }

    if (policy.whitelistDatabases.length > 0) {
      const allowedDb = new Set(policy.whitelistDatabases.map((v) => v.toLowerCase()));
      for (const ref of tableRefs) {
        const [dbName] = ref.toLowerCase().split('.');
        if (ref.includes('.') && !allowedDb.has(dbName)) {
          throw new BadRequestException(`Database is not in whitelist: ${dbName}`);
        }
      }
    }
  }

  private extractTableRefs(sql: string): string[] {
    const refs = new Set<string>();
    const regex = /\b(?:from|join)\s+([`"'\w$.-]+)/gi;
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

  private async generateSqlFromQuestion(question: string, policy: SqlPolicy) {
    if (!question) {
      throw new BadRequestException('question is empty.');
    }

    const llm = this.getOpenClawConfig();

    const tableHint = policy.whitelistTables.length > 0
      ? `Allowed tables: ${policy.whitelistTables.join(', ')}`
      : 'Allowed tables: use only business read-only tables configured for the environment.';

    const systemPrompt = [
      'You are a SQL assistant for operations engineers.',
      'Return exactly one SQL statement and nothing else.',
      'Only generate read-only MySQL SQL using SELECT, SHOW, EXPLAIN, or WITH + SELECT.',
      'Never generate INSERT/UPDATE/DELETE/DDL commands.',
      tableHint,
      `Always include LIMIT and keep it <= ${policy.maxLimit}.`,
      'Do not include markdown fences or comments.',
    ].join('\n');

    const endpoint = `${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const resp = await axios.post(
      endpoint,
      {
        model: llm.model,
        messages: [
          {
            role: 'system',
            content: systemPrompt,
          },
          {
            role: 'user',
            content: question,
          },
        ],
        temperature: 0,
        max_tokens: 400,
      },
      {
        headers: {
          Authorization: `Bearer ${llm.token}`,
          'Content-Type': 'application/json',
        },
        timeout: 20000,
      },
    );

    const outputText = this.extractOpenClawText(resp.data);
    if (!outputText) {
      throw new BadRequestException('Model returned empty SQL output.');
    }

    return this.stripCodeFence(outputText);
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
    status: string;
    errorMessage?: string;
  }) {
    await this.platformDb.query(
      `INSERT INTO aiops_sql_audit
        (action_id, environment_id, actor_user_id, actor_username,
         question, generated_sql, executed_sql, limit_applied,
         max_execution_time_ms, row_count, status, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())`,
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
        params.status,
        params.errorMessage || null,
      ],
    );
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
