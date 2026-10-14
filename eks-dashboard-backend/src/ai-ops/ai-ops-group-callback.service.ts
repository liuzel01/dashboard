import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PlatformDatabaseService } from '../access-control/platform-database.service';
import { HotlineService } from '../oncall/hotline.service';
import { SiteConfService } from '../site-conf/site-conf.service';

type CallbackRow = {
  id: number;
  message_text: string;
};

@Injectable()
export class AiOpsGroupCallbackService {
  private readonly logger = new Logger(AiOpsGroupCallbackService.name);
  private running = false;

  constructor(
    private readonly db: PlatformDatabaseService,
    private readonly siteConf: SiteConfService,
    private readonly hotline: HotlineService,
  ) {}

  async enqueue(input: {
    investigationId: number;
    sourceType: string;
    sourceStatus: string;
    alertName: string;
    environmentId: string;
    classification: string;
    confidence: string;
    summary: string;
  }) {
    if (input.sourceType !== 'ALERTMANAGER_ALERT')
      return { status: 'SKIPPED_REPLAY' };
    if (input.sourceStatus !== 'FIRING') return { status: 'SKIPPED_RESOLVED' };
    if (
      !(await this.siteConf.getBoolean(
        'aiops.alerts.group_callback.enabled',
        false,
      ))
    ) {
      return { status: 'DISABLED' };
    }
    const maxLength = Math.min(
      4000,
      Math.max(
        200,
        await this.siteConf.getNumber(
          'aiops.alerts.group_callback.max_length',
          1200,
        ),
      ),
    );
    const baseUrl = (
      await this.siteConf.getString(
        'aiops.alerts.group_callback.dashboard_base_url',
        'http://localhost:5173',
      )
    ).replace(/\/+$/, '');
    const message = [
      '【AI 初步调查】',
      `告警：${input.alertName}`,
      `环境：${input.environmentId}`,
      `判断：${input.classification}`,
      `置信度：${input.confidence}`,
      `摘要：${input.summary}`,
      `详情：${baseUrl}/ai-ops/investigations/${input.investigationId}`,
      '说明：这是只读证据生成的初步判断，请由值班人员复核。',
    ]
      .join('\n')
      .slice(0, maxLength);
    const key = `aiops:lark:${input.investigationId}:firing`;
    await this.db.query(
      `INSERT INTO aiops_group_callback_records
       (investigation_id, channel, status, idempotency_key, message_text, created_at, updated_at)
       VALUES (?, 'lark-group', 'PENDING', ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE id=id`,
      [input.investigationId, key, message],
    );
    return { status: 'PENDING' };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async dispatchPending() {
    if (this.running) return;
    if (
      !(await this.siteConf.getBoolean(
        'aiops.alerts.group_callback.enabled',
        false,
      ))
    )
      return;
    this.running = true;
    try {
      const pending = await this.db.query<CallbackRow[]>(
        `SELECT id, message_text FROM aiops_group_callback_records
         WHERE status='PENDING' ORDER BY id LIMIT 20`,
      );
      for (const row of pending) await this.dispatchOne(row);
    } finally {
      this.running = false;
    }
  }

  private async dispatchOne(row: CallbackRow) {
    const claimed = await this.db.query<{ affectedRows: number }>(
      `UPDATE aiops_group_callback_records SET status='SENDING', updated_at=UTC_TIMESTAMP()
       WHERE id=? AND status='PENDING'`,
      [row.id],
    );
    if (Number(claimed.affectedRows || 0) !== 1) return;
    const result = await this.hotline.sendGroupMessage(row.message_text);
    const status =
      result.status === 'SENT'
        ? 'SENT'
        : result.status === 'SKIPPED'
          ? 'SKIPPED'
          : 'FAILED';
    await this.db.query(
      `UPDATE aiops_group_callback_records
       SET status=?, provider_message_id=?, error_message=?, sent_at=IF(?='SENT', UTC_TIMESTAMP(), NULL), updated_at=UTC_TIMESTAMP()
       WHERE id=?`,
      [status, result.messageId || null, result.detail || null, status, row.id],
    );
    if (status === 'FAILED')
      this.logger.warn(
        `AIOps group callback ${row.id} failed: ${result.detail || 'unknown error'}`,
      );
  }
}
