/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-argument */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import axios from 'axios';
import { createHash, randomBytes, randomUUID } from 'crypto';
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { AccessControlService } from '../access-control/access-control.service';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { AuthService } from '../auth/auth.service';
import { MfaVerificationService } from '../auth/mfa-verification.service';
import { SiteConfService } from '../site-conf/site-conf.service';
import {
  CicdActionType,
  compileJobDiscoveryPattern,
  JenkinsParameter,
  matchesJobActionFilter,
} from './cicd-catalog.policy';
import {
  maskPersistedParameters,
  parseQueueId,
  redactJenkinsLog,
  TERMINAL_CICD_STATUSES,
  validateJenkinsParameters,
} from './cicd-run.policy';
import { CicdSpotPublishService } from './cicd-spot-publish.service';

const VIEW = 'menu:cicd-runs';
const EXECUTE_BUILD = 'cicd-runs:execute-build';
const EXECUTE_PUBLISH = 'cicd-runs:execute-publish';
const EXECUTE_IMAGE_PUBLISH = 'cicd-runs:execute-image-publish';
const CANCEL = 'cicd-runs:cancel';
const SHARE_LOG = 'cicd-runs:share-log';
const TERMINAL = new Set<string>(TERMINAL_CICD_STATUSES);

type Actor = { userId: number; username: string; permissions: string[] };
type RunRow = Record<string, any>;

@Injectable()
export class CicdRunsService {
  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly auth: AuthService,
    private readonly mfaVerification: MfaVerificationService,
    private readonly access: AccessControlService,
    private readonly siteConf: SiteConfService,
    private readonly spotPublish: CicdSpotPublishService,
  ) {}

  async actor(authorization?: string, permission = VIEW): Promise<Actor> {
    const raw = String(authorization || '');
    if (!raw.toLowerCase().startsWith('bearer '))
      throw new UnauthorizedException('Missing token');
    const payload = await this.auth.verifyToken(raw.slice(7).trim());
    const user =
      payload.source === 'keycloak' || typeof payload.sub !== 'number'
        ? await this.access.ensureUserByUsername(payload.username, {
            displayName: payload.displayName,
          })
        : { id: Number(payload.sub) };
    const me = await this.access.getMe({ userId: Number(user.id) });
    const permissions = (me.permissions || []).map(String);
    if (!permissions.includes(permission))
      throw new ForbiddenException(`Missing permissions: ${permission}`);
    return {
      userId: Number(me.id),
      username: String(me.username || payload.username || me.id),
      permissions,
    };
  }

  private async executionContext(
    environmentId: string,
    actionType: CicdActionType,
  ) {
    const rows = await this.db.query<any[]>(
      `SELECT b.environment_id,b.action_type,b.executor_key,b.job_name_pattern,b.job_action_filter_json,b.enabled AS binding_enabled,
              e.enabled AS executor_enabled,e.provider_type,e.base_url_conf_key,e.username_conf_key,e.token_conf_key,e.timeout_conf_key
       FROM cicd_environment_bindings b JOIN cicd_executors e ON e.executor_key=b.executor_key
       WHERE b.environment_id=? AND b.action_type=? LIMIT 1`,
      [environmentId, actionType],
    );
    const row = rows[0];
    if (!row || !row.binding_enabled || !row.executor_enabled)
      throw new ServiceUnavailableException('当前环境的 CI/CD 执行绑定不可用');
    const [baseUrlValue, username, apiToken, timeoutValue] = await Promise.all([
      this.siteConf.getString(row.base_url_conf_key, ''),
      this.siteConf.getString(row.username_conf_key, ''),
      this.siteConf.getString(row.token_conf_key, ''),
      this.siteConf.getNumber(row.timeout_conf_key, 15_000),
    ]);
    const baseUrl = baseUrlValue.trim().replace(/\/+$/, '');
    if (!baseUrl || !username || !apiToken)
      throw new ServiceUnavailableException('Jenkins 执行器凭据未完成配置');
    return {
      ...row,
      baseUrl,
      username,
      apiToken,
      timeoutMs: Math.min(
        60_000,
        Math.max(1_000, Number(timeoutValue) || 15_000),
      ),
    };
  }

  private jobPath(fullName: string) {
    const segments = String(fullName)
      .split('/')
      .map((v) => v.trim())
      .filter(Boolean);
    if (!segments.length || segments.some((v) => v === '.' || v === '..'))
      throw new BadRequestException('Jenkins Job 路径无效');
    return segments.map((v) => `/job/${encodeURIComponent(v)}`).join('');
  }

  private request(
    config: any,
    method: 'get' | 'post',
    path: string,
    options: any = {},
  ) {
    return axios.request({
      method,
      url: `${config.baseUrl}${path}`,
      auth: { username: config.username, password: config.apiToken },
      timeout: config.timeoutMs,
      maxRedirects: 0,
      validateStatus: () => true,
      ...options,
    });
  }

  private remoteParameters(properties: any[]): JenkinsParameter[] {
    return (properties || [])
      .flatMap((property: any) =>
        (property?.parameterDefinitions || []).map((parameter: any) => ({
          name: String(parameter?.name || ''),
          type: String(parameter?.type || parameter?._class || ''),
          default: parameter?.defaultParameterValue?.value ?? '',
          choices: Array.isArray(parameter?.choices)
            ? parameter.choices.map(String)
            : undefined,
        })),
      )
      .filter((item: JenkinsParameter) => item.name);
  }

  private async getRun(runId: string) {
    const rows = await this.db.query<RunRow[]>(
      `SELECT r.*,t.result_tag AS external_result_tag
       FROM cicd_runs r LEFT JOIN cicd_external_tasks t ON t.run_id=r.run_id
       WHERE r.run_id=? LIMIT 1`,
      [runId],
    );
    if (!rows[0]) throw new NotFoundException('CI/CD 执行记录不存在');
    return rows[0];
  }

  private view(row: RunRow): RunRow {
    return {
      ...row,
      parameters:
        typeof row.parameters_json === 'string'
          ? JSON.parse(row.parameters_json)
          : row.parameters_json,
      parameters_json: undefined,
    };
  }

  async trigger(
    authorization: string | undefined,
    input: {
      environmentId: string;
      actionType: CicdActionType;
      jobName: string;
      clientRequestId: string;
      parameters?: Record<string, unknown>;
      otpCode?: string;
    },
  ) {
    const required =
      input.actionType === 'IMAGE_BUILD_PUBLISH'
        ? EXECUTE_IMAGE_PUBLISH
        : input.actionType === 'PACKAGE_PUBLISH'
          ? EXECUTE_PUBLISH
          : EXECUTE_BUILD;
    const actor = await this.actor(authorization, required);
    if (['PACKAGE_PUBLISH', 'IMAGE_BUILD_PUBLISH'].includes(input.actionType)) {
      await this.mfaVerification.verifyForUser(actor.userId, input.otpCode);
    }
    const existing = await this.db.query<RunRow[]>(
      'SELECT * FROM cicd_runs WHERE client_request_id=? LIMIT 1',
      [input.clientRequestId],
    );
    if (existing[0]) return this.view(existing[0]);
    const context = await this.executionContext(
      input.environmentId,
      input.actionType,
    );
    const jobName = input.jobName.trim();
    if (context.provider_type === 'EXTERNAL_SPOT_PUBLISH')
      return this.triggerSpotPublish(actor, input, context, jobName);
    if (context.provider_type !== 'JENKINS')
      throw new ServiceUnavailableException(
        `当前 Provider ${String(context.provider_type)} 尚未实现执行适配器`,
      );
    if (
      (context.job_name_pattern &&
        !compileJobDiscoveryPattern(context.job_name_pattern).test(jobName)) ||
      !matchesJobActionFilter(context.job_action_filter_json, jobName)
    )
      throw new ForbiddenException('该 Job 不属于当前环境允许的执行范围');
    const jobPath = this.jobPath(jobName);
    const detail = await this.request(
      context,
      'get',
      `${jobPath}/api/json?tree=name,url,color,buildable,property[parameterDefinitions[name,type,_class,defaultParameterValue[value],choices]]`,
    );
    if (detail.status === 404)
      throw new NotFoundException('Jenkins Job 不存在');
    if (detail.status !== 200)
      throw new ServiceUnavailableException(
        `Jenkins Job 校验失败（HTTP ${detail.status}）`,
      );
    if (!detail.data?.buildable || detail.data?.color === 'disabled')
      throw new BadRequestException('Jenkins Job 当前不可构建');
    const definitions = this.remoteParameters(detail.data?.property || []);
    const parameters = validateJenkinsParameters(
      definitions,
      input.parameters || {},
    );
    const persistedParameters = maskPersistedParameters(
      definitions,
      parameters,
    );
    const running = await this.db.query<any[]>(
      `SELECT run_id FROM cicd_runs WHERE environment_id=? AND executor_key=? AND job_name=?
       AND status IN ('TRIGGERING','QUEUED','RUNNING') LIMIT 1`,
      [input.environmentId, context.executor_key, jobName],
    );
    if (running[0])
      throw new ConflictException('该环境的同一 Job 已有执行中的任务');
    const runId = randomUUID();
    await this.db.query(
      `INSERT INTO cicd_runs
       (run_id,client_request_id,action_type,environment_id,executor_key,job_name,parameters_json,status,requested_by_user_id,requested_by_username,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'TRIGGERING',?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
      [
        runId,
        input.clientRequestId,
        input.actionType,
        input.environmentId,
        context.executor_key,
        jobName,
        JSON.stringify(persistedParameters),
        actor.userId,
        actor.username,
      ],
    );
    try {
      const crumb = await this.request(context, 'get', '/crumbIssuer/api/json');
      if (
        crumb.status !== 200 ||
        !crumb.data?.crumbRequestField ||
        !crumb.data?.crumb
      )
        throw new ServiceUnavailableException('Jenkins crumb 获取失败');
      const body = new URLSearchParams(parameters).toString();
      const endpoint = Object.keys(parameters).length
        ? 'buildWithParameters'
        : 'build';
      const queued = await this.request(
        context,
        'post',
        `${jobPath}/${endpoint}`,
        {
          data: body,
          headers: {
            [crumb.data.crumbRequestField]: crumb.data.crumb,
            'content-type': 'application/x-www-form-urlencoded',
          },
        },
      );
      const queueId = parseQueueId(queued.headers?.location);
      if (![201, 302].includes(queued.status) || !queueId)
        throw new ServiceUnavailableException(
          `Jenkins 未接受构建请求（HTTP ${queued.status}）`,
        );
      await this.db.query(
        `UPDATE cicd_runs SET queue_id=?,queue_url=?,status='QUEUED',queued_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
        [queueId, String(queued.headers?.location || ''), runId],
      );
      await this.db.query(
        `INSERT INTO cicd_run_events (run_id,event_type,message,created_at) VALUES (?,'QUEUED',?,UTC_TIMESTAMP())`,
        [runId, `Jenkins queue #${queueId}`],
      );
      return this.view(await this.getRun(runId));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Jenkins 触发失败';
      await this.db.query(
        `UPDATE cicd_runs SET status='FAILURE',error_summary=?,finished_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
        [message.slice(0, 1000), runId],
      );
      throw error;
    }
  }

  private async triggerSpotPublish(
    actor: Actor,
    input: {
      environmentId: string;
      actionType: CicdActionType;
      jobName: string;
      clientRequestId: string;
      parameters?: Record<string, unknown>;
    },
    context: any,
    jobName: string,
  ) {
    const item = (await this.spotPublish.catalog()).find(
      (entry) => entry.name === jobName,
    );
    if (!item) throw new BadRequestException('服务不在 iCoin 现货推包目录中');
    const gitRefRaw = input.parameters?.GIT_REF ?? item.defaultRef;
    const registryRaw = input.parameters?.REGISTRY ?? item.registries[0] ?? '';
    if (typeof gitRefRaw !== 'string' || typeof registryRaw !== 'string')
      throw new BadRequestException('外部推包参数必须是字符串');
    const gitRef = gitRefRaw.trim();
    const registry = registryRaw.trim();
    if (!/^[A-Za-z0-9._/-]{1,128}$/.test(gitRef))
      throw new BadRequestException('GIT_REF 格式无效');
    if (!item.registries.includes(registry))
      throw new BadRequestException('REGISTRY 不在外部系统允许范围内');
    const running = await this.db.query<any[]>(
      `SELECT run_id FROM cicd_runs WHERE environment_id=? AND executor_key=? AND job_name=?
       AND status IN ('QUEUED','RUNNING','UNKNOWN') LIMIT 1`,
      [input.environmentId, context.executor_key, jobName],
    );
    if (running[0])
      throw new ConflictException('该服务已有执行中或结果未知的现货推包任务');
    const runId = randomUUID();
    await this.db.query(
      `INSERT INTO cicd_runs
       (run_id,client_request_id,action_type,environment_id,executor_key,job_name,parameters_json,status,requested_by_user_id,requested_by_username,created_at,updated_at)
       VALUES (?,?,?,?,?,?,?,'QUEUED',?,?,UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
      [
        runId,
        input.clientRequestId,
        input.actionType,
        input.environmentId,
        context.executor_key,
        jobName,
        JSON.stringify({ GIT_REF: gitRef, REGISTRY: registry }),
        actor.userId,
        actor.username,
      ],
    );
    await this.db.query(
      `INSERT INTO cicd_external_tasks
       (run_id,provider_type,service_key,git_ref,registry,status,created_at,updated_at)
       VALUES (?,'EXTERNAL_SPOT_PUBLISH',?,?,?,'QUEUED',UTC_TIMESTAMP(),UTC_TIMESTAMP())`,
      [runId, jobName, gitRef, registry],
    );
    return this.view(await this.getRun(runId));
  }

  async list(authorization: string | undefined, environmentId?: string) {
    await this.actor(authorization);
    const params: unknown[] = [];
    const where = environmentId ? 'WHERE environment_id=?' : '';
    if (environmentId) params.push(environmentId);
    const rows = await this.db.query<RunRow[]>(
      `SELECT r.*,t.result_tag AS external_result_tag
       FROM cicd_runs r LEFT JOIN cicd_external_tasks t ON t.run_id=r.run_id
       ${where ? 'WHERE r.environment_id=?' : ''} ORDER BY r.id DESC LIMIT 100`,
      params,
    );
    return rows.map((row) => this.view(row));
  }

  async refresh(authorization: string | undefined, runId: string) {
    await this.actor(authorization);
    return this.refreshInternal(runId);
  }

  async refreshInternal(runId: string) {
    let row = await this.getRun(runId);
    if (TERMINAL.has(String(row.status))) return this.view(row);
    const context = await this.executionContext(
      row.environment_id,
      row.action_type,
    );
    if (context.provider_type === 'EXTERNAL_SPOT_PUBLISH')
      return this.view(row);
    if (!row.build_number && row.queue_id) {
      const queue = await this.request(
        context,
        'get',
        `/queue/item/${row.queue_id}/api/json`,
      );
      if (queue.status === 200 && queue.data?.cancelled) {
        await this.db.query(
          `UPDATE cicd_runs SET status='CANCELLED',finished_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
          [runId],
        );
      } else if (queue.status === 200 && queue.data?.executable?.number) {
        const number = Number(queue.data.executable.number);
        await this.db.query(
          `UPDATE cicd_runs SET build_number=?,build_url=?,status='RUNNING',started_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
          [number, String(queue.data.executable.url || ''), runId],
        );
      }
      row = await this.getRun(runId);
    }
    if (row.build_number && !TERMINAL.has(String(row.status))) {
      const build = await this.request(
        context,
        'get',
        `${this.jobPath(row.job_name)}/${row.build_number}/api/json?tree=building,result,url,timestamp,duration`,
      );
      if (build.status === 200) {
        const status = build.data?.building
          ? 'RUNNING'
          : String(build.data?.result || 'UNKNOWN');
        await this.db.query(
          `UPDATE cicd_runs SET status=?,build_url=COALESCE(NULLIF(?,''),build_url),duration_ms=?,finished_at=IF(? IN ('SUCCESS','FAILURE','ABORTED','CANCELLED'),COALESCE(finished_at,UTC_TIMESTAMP()),finished_at),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
          [
            status,
            String(build.data?.url || ''),
            Number(build.data?.duration || 0),
            status,
            runId,
          ],
        );
      }
    }
    return this.view(await this.getRun(runId));
  }

  async activeRunIds() {
    const rows = await this.db.query<Array<{ run_id: string }>>(
      `SELECT run_id FROM cicd_runs
       WHERE status IN ('TRIGGERING','QUEUED','RUNNING')
       ORDER BY id ASC LIMIT 100`,
    );
    return rows.map((row) => String(row.run_id));
  }

  async recentlyUpdatedRuns() {
    const rows = await this.db.query<RunRow[]>(
      `SELECT r.*,t.result_tag AS external_result_tag
       FROM cicd_runs r LEFT JOIN cicd_external_tasks t ON t.run_id=r.run_id
       WHERE r.updated_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 15 SECOND)
       ORDER BY r.id DESC LIMIT 100`,
    );
    return rows.map((row) => this.view(row));
  }

  async log(authorization: string | undefined, runId: string, start = 0) {
    await this.actor(authorization);
    const row = await this.getRun(runId);
    const context = await this.executionContext(
      row.environment_id,
      row.action_type,
    );
    if (context.provider_type === 'EXTERNAL_SPOT_PUBLISH')
      return {
        text: '该外部推包系统不提供实时日志接口。请等待最终状态；UNKNOWN 状态需要人工确认。',
        nextStart: start,
        hasMore: false,
      };
    if (!row.build_number) return { text: '', nextStart: start, hasMore: true };
    const response = await this.request(
      context,
      'get',
      `${this.jobPath(row.job_name)}/${row.build_number}/logText/progressiveText?start=${Math.max(0, start)}`,
      { responseType: 'text' },
    );
    if (response.status !== 200)
      throw new ServiceUnavailableException(
        `Jenkins 日志读取失败（HTTP ${response.status}）`,
      );
    return {
      text: redactJenkinsLog(String(response.data || '').slice(0, 500_000)),
      nextStart: Number(response.headers['x-text-size'] || start),
      hasMore: String(response.headers['x-more-data'] || 'false') === 'true',
    };
  }

  private async logShareConfig() {
    const [bucket, prefix, region, maxBytes, defaultHours, maxHours] =
      await Promise.all([
        this.siteConf.getString('cicd.log_share.s3_bucket', ''),
        this.siteConf.getString('cicd.log_share.s3_prefix', ''),
        this.siteConf.getString('cicd.log_share.s3_region', 'ap-southeast-1'),
        this.siteConf.getNumber('cicd.log_share.max_bytes', 100 * 1024 * 1024),
        this.siteConf.getNumber('cicd.log_share.default_expiry_hours', 24),
        this.siteConf.getNumber('cicd.log_share.max_expiry_hours', 168),
      ]);
    if (!bucket.trim() || !prefix.trim())
      throw new ServiceUnavailableException('CI/CD 日志分享 S3 尚未配置');
    const normalizedMaxHours = Math.min(
      168,
      Math.max(1, Number(maxHours) || 168),
    );
    return {
      bucket: bucket.trim(),
      prefix: prefix.trim().replace(/^\/+|\/+$/g, ''),
      region: region.trim() || 'ap-southeast-1',
      maxBytes: Math.min(
        500 * 1024 * 1024,
        Math.max(1024 * 1024, Number(maxBytes)),
      ),
      defaultHours: Math.min(
        normalizedMaxHours,
        Math.max(1, Number(defaultHours) || 24),
      ),
      maxHours: normalizedMaxHours,
    };
  }

  async getLogSharePolicy(authorization: string | undefined) {
    await this.actor(authorization, SHARE_LOG);
    const config = await this.logShareConfig();
    return {
      defaultExpiryHours: config.defaultHours,
      maxExpiryHours: config.maxHours,
      maxBytes: config.maxBytes,
    };
  }

  private async captureRawLog(row: RunRow, maxBytes: number) {
    const context = await this.executionContext(
      row.environment_id,
      row.action_type,
    );
    if (context.provider_type !== 'JENKINS' || !row.build_number)
      throw new BadRequestException(
        '该执行记录没有可分享的 Jenkins Build 日志',
      );
    let start = 0;
    let captured = 0;
    let truncated = false;
    const chunks: Buffer[] = [];
    for (let page = 0; page < 10_000; page += 1) {
      const response = await this.request(
        context,
        'get',
        `${this.jobPath(row.job_name)}/${row.build_number}/logText/progressiveText?start=${start}`,
        { responseType: 'arraybuffer' },
      );
      if (response.status !== 200)
        throw new ServiceUnavailableException(
          `Jenkins 日志读取失败（HTTP ${response.status}）`,
        );
      const chunk = Buffer.from(response.data || []);
      const remaining = maxBytes - captured;
      if (chunk.length > remaining) {
        if (remaining > 0) chunks.push(chunk.subarray(0, remaining));
        captured += Math.max(0, remaining);
        truncated = true;
        break;
      }
      chunks.push(chunk);
      captured += chunk.length;
      const nextStart = Number(
        response.headers['x-text-size'] || start + chunk.length,
      );
      const hasMore =
        String(response.headers['x-more-data'] || 'false') === 'true';
      if (!hasMore) break;
      if (!Number.isFinite(nextStart) || nextStart <= start)
        throw new ServiceUnavailableException('Jenkins 日志游标未推进');
      start = nextStart;
      if (captured >= maxBytes) {
        truncated = true;
        break;
      }
    }
    return { body: Buffer.concat(chunks), captured, truncated };
  }

  async listLogShares(authorization: string | undefined, runId: string) {
    await this.actor(authorization, SHARE_LOG);
    await this.getRun(runId);
    const rows = await this.db.query<any[]>(
      `SELECT share_id,run_id,captured_size_bytes,truncated,expires_at,revoked_at,created_at
         FROM cicd_log_shares WHERE run_id=? ORDER BY id DESC LIMIT 20`,
      [runId],
    );
    return rows.map((row) => ({
      ...row,
      created_at: this.utcDateIso(row.created_at),
      expires_at: this.utcDateIso(row.expires_at),
      revoked_at: this.utcDateIso(row.revoked_at),
    }));
  }

  private utcDateIso(value: unknown): string | null {
    if (!value) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value !== 'string') return null;
    const normalized = value.trim().replace(' ', 'T');
    const date = new Date(
      /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)
        ? normalized
        : `${normalized}Z`,
    );
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }

  async createLogShare(
    authorization: string | undefined,
    runId: string,
    input: { expiresInHours?: number; otpCode: string },
  ) {
    const actor = await this.actor(authorization, SHARE_LOG);
    await this.mfaVerification.verifyForUser(actor.userId, input.otpCode);
    const row = await this.getRun(runId);
    if (!TERMINAL.has(String(row.status)))
      throw new BadRequestException('仅可分享已经结束的 Jenkins 构建日志');
    const config = await this.logShareConfig();
    const expiresInHours = Math.min(
      config.maxHours,
      Math.max(1, Number(input.expiresInHours) || config.defaultHours),
    );
    const captured = await this.captureRawLog(row, config.maxBytes);
    const shareId = randomUUID();
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const objectKey = `${config.prefix}/${row.environment_id}/${runId}/${shareId}.log`;
    const s3 = new S3Client({ region: config.region });
    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: captured.body,
        ContentType: 'text/plain; charset=utf-8',
        ContentDisposition: `inline; filename="jenkins-${row.build_number}.log"`,
        ServerSideEncryption: 'AES256',
        Metadata: { truncated: String(captured.truncated), run_id: runId },
      }),
    );
    await this.db.query(
      `INSERT INTO cicd_log_shares
       (share_id,run_id,token_hash,s3_bucket,s3_object_key,captured_size_bytes,truncated,expires_at,created_by)
       VALUES (?,?,?,?,?,?,?,DATE_ADD(UTC_TIMESTAMP(3),INTERVAL ? HOUR),?)`,
      [
        shareId,
        runId,
        tokenHash,
        config.bucket,
        objectKey,
        captured.captured,
        captured.truncated ? 1 : 0,
        expiresInHours,
        actor.userId,
      ],
    );
    return {
      shareId,
      path: `/api/cicd/runs/public-log-shares/${token}`,
      capturedSizeBytes: captured.captured,
      truncated: captured.truncated,
      expiresInHours,
    };
  }

  async revokeLogShare(
    authorization: string | undefined,
    runId: string,
    shareId: string,
  ) {
    await this.actor(authorization, SHARE_LOG);
    const result: any = await this.db.query(
      `UPDATE cicd_log_shares SET revoked_at=COALESCE(revoked_at,UTC_TIMESTAMP(3))
        WHERE share_id=? AND run_id=?`,
      [shareId, runId],
    );
    if (!Number(result.affectedRows || 0))
      throw new NotFoundException('日志分享记录不存在');
    return { ok: true };
  }

  async openLogShare(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new NotFoundException('日志分享链接不存在或已失效');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const rows = await this.db.query<any[]>(
      `SELECT s3_bucket,s3_object_key
         FROM cicd_log_shares
        WHERE token_hash=? AND revoked_at IS NULL AND expires_at>UTC_TIMESTAMP(3)
        LIMIT 1`,
      [tokenHash],
    );
    if (!rows[0]) throw new NotFoundException('日志分享链接不存在或已失效');
    const config = await this.logShareConfig();
    return getSignedUrl(
      new S3Client({ region: config.region }),
      new GetObjectCommand({
        Bucket: rows[0].s3_bucket,
        Key: rows[0].s3_object_key,
        ResponseContentType: 'text/plain; charset=utf-8',
        ResponseContentDisposition: 'inline',
      }),
      { expiresIn: 60 },
    );
  }

  async cancel(authorization: string | undefined, runId: string) {
    const actor = await this.actor(authorization, CANCEL);
    const row = await this.getRun(runId);
    if (TERMINAL.has(String(row.status))) return this.view(row);
    const context = await this.executionContext(
      row.environment_id,
      row.action_type,
    );
    if (context.provider_type === 'EXTERNAL_SPOT_PUBLISH')
      throw new BadRequestException('该外部推包系统不支持取消任务');
    const crumb = await this.request(context, 'get', '/crumbIssuer/api/json');
    if (crumb.status !== 200)
      throw new ServiceUnavailableException('Jenkins crumb 获取失败');
    const headers = { [crumb.data.crumbRequestField]: crumb.data.crumb };
    const path = row.build_number
      ? `${this.jobPath(row.job_name)}/${row.build_number}/stop`
      : `/queue/cancelItem?id=${row.queue_id}`;
    const response = await this.request(context, 'post', path, { headers });
    if (![200, 201, 302].includes(response.status))
      throw new ServiceUnavailableException(
        `Jenkins 取消失败（HTTP ${response.status}）`,
      );
    await this.db.query(
      `UPDATE cicd_runs SET status='CANCELLED',cancelled_by_user_id=?,finished_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP() WHERE run_id=?`,
      [actor.userId, runId],
    );
    return this.view(await this.getRun(runId));
  }
}
