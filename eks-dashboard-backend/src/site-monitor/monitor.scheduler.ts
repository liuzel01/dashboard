import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnvironmentsService } from '../environments/environments.service';
import { SiteMonitorService } from './site-monitor.service';
import { CentralDatabaseService } from './central-database.service';
import { AlertsService } from './alerts.service';

@Injectable()
export class MonitorScheduler {
  private readonly logger = new Logger(MonitorScheduler.name);

  constructor(
    private readonly envs: EnvironmentsService,
    private readonly monitor: SiteMonitorService,
    private readonly db: CentralDatabaseService,
    private readonly alerts: AlertsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async run() {
    const envList = await this.envs.getEnvironments();
    for (const env of envList) {
      try {
        // 按环境获取站点
        const sites = await this.monitor.listSites(env.id);
        const cfg = await this.alerts.getEnvAlertConfig(env.id);
        try {
          await this.monitor.syncLineMonitorAlerts(env.id);
        } catch (e: any) {
          this.logger.warn(
            `line monitor sync failed for env=${env.id}: ${e?.message || e}`,
          );
        }
        for (const s of sites) {
          if ((s as any).monitor_source === 'line_inventory') continue;
          try {
            const updated = await this.monitor.checkSite(env.id, s.id);
            // 判断是否连续失败并需要告警（按可接受状态码判定）
            const ok =
              !!updated.http_status &&
              this.alerts.isAcceptableStatus(
                updated.http_status,
                cfg.acceptableStatusCodes,
              );
            const prevOk =
              !!s.http_status && s.http_status >= 200 && s.http_status < 400;
            // 恢复通知：从不可用 -> 可用 触发一次
            if (!prevOk && ok) {
              await this.alerts.sendRecoveryAlert(env.id, updated);
            }
            if (!ok) {
              const failureCount = (updated as any).failure_count ?? 0;
              const lastAlertRaw = (updated as any).last_alert_at as
                string | null;
              const lastAlertAt = lastAlertRaw
                ? lastAlertRaw.includes('T')
                  ? new Date(lastAlertRaw)
                  : new Date(lastAlertRaw.replace(' ', 'T') + 'Z')
                : null;
              const needCooldown =
                lastAlertAt &&
                Date.now() - lastAlertAt.getTime() <
                  cfg.cooldownMinutes * 60 * 1000;
              if (failureCount >= cfg.failureThreshold && !needCooldown) {
                await this.alerts.sendUnavailableAlert(env.id, updated);
                await this.alerts.markAlertSent(env.id, updated.id);
              }
            }
          } catch (e: any) {
            this.logger.warn(
              `checkSite failed for env=${env.id} id=${s.id}: ${e?.message || e}`,
            );
          }
        }
      } catch (e: any) {
        this.logger.warn(
          `monitor loop failed for env=${env.id}: ${e?.message || e}`,
        );
      }
    }
  }
}
