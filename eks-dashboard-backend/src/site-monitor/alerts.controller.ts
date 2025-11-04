import { Body, Controller, Get, Headers, HttpException, HttpStatus, Post } from '@nestjs/common';
import { CentralDatabaseService } from './central-database.service';
import { AlertsService } from './alerts.service';

@Controller('alerts')
export class AlertsController {
  constructor(
    private readonly db: CentralDatabaseService,
    private readonly alerts: AlertsService,
  ) {}

  @Get('config')
  async getConfig(@Headers('x-target-environment') environmentId: string) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    const [row] = await this.db.query<{ lark_webhook_url: string | null; failure_threshold?: number | null; cooldown_minutes?: number | null; probe_timeout_ms?: number | null; acceptable_status_codes?: string | null }[]>(
      'SELECT lark_webhook_url, failure_threshold, cooldown_minutes, probe_timeout_ms, acceptable_status_codes FROM environment_alerts WHERE environment_id = ? LIMIT 1',
      [environmentId],
    );
    const defaults = await this.alerts.getEnvAlertConfig(environmentId);
    const effective = await this.alerts.getEffectiveWebhook(environmentId);
    return {
      environmentId,
      lark_webhook_url: row?.lark_webhook_url ?? null,
      failure_threshold: row?.failure_threshold ?? defaults.failureThreshold,
      cooldown_minutes: row?.cooldown_minutes ?? defaults.cooldownMinutes,
      probe_timeout_ms: row?.probe_timeout_ms ?? defaults.probeTimeoutMs,
      acceptable_status_codes: row?.acceptable_status_codes ?? defaults.acceptableStatusCodes ?? null,
      effective_lark_webhook_url: effective,
      source: row?.lark_webhook_url ? 'db' : (effective ? 'file' : null),
    };
  }

  @Post('config')
  async setConfig(
    @Headers('x-target-environment') environmentId: string,
    @Body() body: { lark_webhook_url?: string | null; failure_threshold?: number | null; cooldown_minutes?: number | null; probe_timeout_ms?: number | null; acceptable_status_codes?: string | null },
  ) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    const url = body?.lark_webhook_url ?? null;
    const failureThreshold = body?.failure_threshold ?? null;
    const cooldownMinutes = body?.cooldown_minutes ?? null;
    const probeTimeoutMs = body?.probe_timeout_ms ?? null;
    await this.db.query(
      `INSERT INTO environment_alerts(environment_id, lark_webhook_url, failure_threshold, cooldown_minutes, probe_timeout_ms, acceptable_status_codes, created_at, updated_at)
       VALUES(?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE lark_webhook_url = VALUES(lark_webhook_url), failure_threshold = VALUES(failure_threshold), cooldown_minutes = VALUES(cooldown_minutes), probe_timeout_ms = VALUES(probe_timeout_ms), acceptable_status_codes = VALUES(acceptable_status_codes), updated_at = UTC_TIMESTAMP()`,
      [environmentId, url, failureThreshold, cooldownMinutes, probeTimeoutMs, body?.acceptable_status_codes ?? null],
    );
    return { ok: true };
  }

  @Post('test')
  async test(@Headers('x-target-environment') environmentId: string) {
    if (!environmentId) {
      throw new HttpException('Header "X-Target-Environment" is required.', HttpStatus.BAD_REQUEST);
    }
    const url = await this.alerts.getEffectiveWebhook(environmentId);
    if (!url) {
      throw new HttpException('No Lark webhook configured for this environment (DB or file).', HttpStatus.BAD_REQUEST);
    }
    await this.alerts.sendTestAlert(environmentId);
    return { ok: true };
  }
}
