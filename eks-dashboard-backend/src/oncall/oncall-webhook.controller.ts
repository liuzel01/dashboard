import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { OncallService } from './oncall.service';
import type { AlertmanagerPayload } from './oncall.types';

/**
 * This controller is intentionally mounted only in the 62233 listener.
 * Do not add dashboard management routes to this application.
 */
@Controller()
export class OncallWebhookController {
  constructor(private readonly service: OncallService) {}

  @Get('health/oncall')
  health() {
    return { status: 'ok', service: 'dashboard-oncall-webhook' };
  }

  @Post('api/oncall/alertmanager')
  async receiveAlertmanager(
    @Headers('authorization') authorization: string | undefined,
    @Headers() headers: Record<string, unknown>,
    @Body() body: AlertmanagerPayload,
  ) {
    this.service.assertWebhookAuthorization(authorization);
    const forwarded = headers['x-forwarded-for'];
    const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null;
    return this.service.receiveAlertmanagerWebhook(body, {
      ip,
      userAgent: typeof headers['user-agent'] === 'string' ? headers['user-agent'] : null,
      traceId: typeof headers['x-request-id'] === 'string' ? headers['x-request-id'] : null,
    });
  }
}
