/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument */
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import axios from 'axios';
import * as cheerio from 'cheerio';
import { randomUUID } from 'crypto';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { SiteConfService } from '../site-conf/site-conf.service';

export type SpotPublishCatalogItem = {
  name: string;
  repo: string;
  defaultRef: string;
  registries: string[];
};

export const parseSpotPublishCatalog = (
  html: string,
): SpotPublishCatalogItem[] => {
  const $ = cheerio.load(html);
  const registries = $('input[name="registry"]')
    .map((_, node) => String($(node).attr('value') || '').trim())
    .get()
    .filter(Boolean);
  const items: SpotPublishCatalogItem[] = [];
  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    const name = cells.eq(0).text().trim();
    const repo = cells.eq(1).text().trim();
    const defaultRef =
      $(row).find('input[type="text"]').first().attr('value')?.trim() || '';
    if (!name || name === '_' || !repo || !defaultRef) return;
    items.push({ name, repo, defaultRef, registries });
  });
  return items;
};

@Injectable()
export class CicdSpotPublishService {
  private readonly logger = new Logger(CicdSpotPublishService.name);
  private readonly workerId = randomUUID();
  private cache: { expiresAt: number; items: SpotPublishCatalogItem[] } | null =
    null;

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly siteConf: SiteConfService,
  ) {}

  private async config() {
    const [signinUrl, username, password, timeoutMs] = await Promise.all([
      this.siteConf.getString('cicd.providers.icoin-spot.signin_url', ''),
      this.siteConf.getString('cicd.providers.icoin-spot.username', ''),
      this.siteConf.getString('cicd.providers.icoin-spot.password', ''),
      this.siteConf.getNumber(
        'cicd.providers.icoin-spot.timeout_ms',
        7_200_000,
      ),
    ]);
    let parsed: URL;
    try {
      parsed = new URL(signinUrl);
    } catch {
      throw new ServiceUnavailableException('iCoin 现货推包地址未配置或无效');
    }
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      !username ||
      !password
    )
      throw new ServiceUnavailableException('iCoin 现货推包凭据未完成配置');
    return {
      signinUrl: parsed.toString(),
      buildUrl: new URL('/build', parsed).toString(),
      username,
      password,
      timeoutMs: Math.min(
        7_200_000,
        Math.max(60_000, Number(timeoutMs) || 7_200_000),
      ),
    };
  }

  async catalog(force = false) {
    if (!force && this.cache && this.cache.expiresAt > Date.now())
      return this.cache.items;
    const config = await this.config();
    const body = new URLSearchParams({
      username: config.username,
      password: config.password,
    });
    const response = await axios.post<string>(
      config.signinUrl,
      body.toString(),
      {
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        timeout: 30_000,
        maxRedirects: 0,
        validateStatus: () => true,
        responseType: 'text',
      },
    );
    if (response.status !== 200)
      throw new ServiceUnavailableException(
        `iCoin 现货推包认证失败（HTTP ${response.status}）`,
      );
    const items = parseSpotPublishCatalog(String(response.data || ''));
    if (!items.length)
      throw new ServiceUnavailableException('iCoin 现货推包服务目录解析失败');
    this.cache = { expiresAt: Date.now() + 5 * 60_000, items };
    return items;
  }

  private async execute(
    item: SpotPublishCatalogItem,
    gitRef: string,
    registry: string,
  ) {
    const config = await this.config();
    const response = await axios.post(
      config.buildUrl,
      { name: item.name, repo: item.repo, ref: gitRef, registry },
      {
        timeout: config.timeoutMs,
        maxRedirects: 0,
        validateStatus: () => true,
        headers: { 'content-type': 'application/json' },
      },
    );
    if (
      response.status !== 201 ||
      !['success', 'failed'].includes(String(response.data?.status))
    )
      throw new Error(`外部推包返回未知响应（HTTP ${response.status}）`);
    return {
      success: response.data.status === 'success',
      tag: String(response.data?.tag || ''),
    };
  }

  @Interval(5_000)
  async work() {
    try {
      await this.db.query(
        `UPDATE cicd_external_tasks t JOIN cicd_runs r ON r.run_id=t.run_id
         SET t.status='UNKNOWN',r.status='UNKNOWN',r.error_summary='Dashboard Worker 在外部请求期间中断，远端结果未知',r.updated_at=UTC_TIMESTAMP(),t.updated_at=UTC_TIMESTAMP()
         WHERE t.status='RUNNING' AND t.lease_expires_at < UTC_TIMESTAMP()`,
      );
      const claimed: any = await this.db.query(
        `UPDATE cicd_external_tasks SET status='RUNNING',lease_owner=?,lease_expires_at=DATE_ADD(UTC_TIMESTAMP(),INTERVAL 130 MINUTE),attempt_count=attempt_count+1,started_at=UTC_TIMESTAMP(),updated_at=UTC_TIMESTAMP()
         WHERE status='QUEUED'
           AND NOT EXISTS (SELECT 1 FROM (SELECT id FROM cicd_external_tasks WHERE status='RUNNING' LIMIT 1) active)
         ORDER BY id LIMIT 1`,
        [this.workerId],
      );
      if (!Number(claimed.affectedRows)) return;
      const rows = await this.db.query<any[]>(
        `SELECT t.*,r.environment_id,r.job_name FROM cicd_external_tasks t JOIN cicd_runs r ON r.run_id=t.run_id
         WHERE t.status='RUNNING' AND t.lease_owner=? ORDER BY t.id DESC LIMIT 1`,
        [this.workerId],
      );
      const task = rows[0];
      if (!task) return;
      const items = await this.catalog(true);
      const item = items.find((entry) => entry.name === task.service_key);
      if (!item) throw new Error('服务已不在外部推包目录中');
      const result = await this.execute(item, task.git_ref, task.registry);
      const status = result.success ? 'SUCCESS' : 'FAILURE';
      await this.db.query(
        `UPDATE cicd_external_tasks t JOIN cicd_runs r ON r.run_id=t.run_id
         SET t.status=?,t.result_tag=?,t.finished_at=UTC_TIMESTAMP(),t.updated_at=UTC_TIMESTAMP(),r.status=?,r.finished_at=UTC_TIMESTAMP(),r.error_summary=?,r.updated_at=UTC_TIMESTAMP()
         WHERE t.id=?`,
        [
          status,
          result.tag,
          status,
          result.success ? null : '外部推包返回 failed',
          task.id,
        ],
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '外部推包请求结果未知';
      this.logger.warn(`iCoin spot publish worker result unknown: ${message}`);
      await this.db
        .query(
          `UPDATE cicd_external_tasks t JOIN cicd_runs r ON r.run_id=t.run_id
         SET t.status='UNKNOWN',t.finished_at=UTC_TIMESTAMP(),t.updated_at=UTC_TIMESTAMP(),r.status='UNKNOWN',r.error_summary=?,r.finished_at=UTC_TIMESTAMP(),r.updated_at=UTC_TIMESTAMP()
         WHERE t.status='RUNNING' AND t.lease_owner=?`,
          [message.slice(0, 1000), this.workerId],
        )
        .catch(() => undefined);
    }
  }
}
