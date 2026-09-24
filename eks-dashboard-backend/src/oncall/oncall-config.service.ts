import { Injectable } from '@nestjs/common';
import { SiteConfService } from '../site-conf/site-conf.service';

/**
 * Runtime configuration boundary for Oncall.
 *
 * SiteConf is the primary source. The envKey mappings in SITE_CONF_DEFAULTS
 * remain as a deployment-safe fallback while existing hosts migrate their
 * values from .env into dashboard_site_conf.
 */
@Injectable()
export class OncallConfigService {
  constructor(private readonly siteConf: SiteConfService) {}

  getAlertmanagerBearerToken() {
    return this.siteConf.getString('oncall.alertmanager.bearer_token', '');
  }

  getLarkWebhookUrl() {
    return this.siteConf.getString('oncall.lark.webhook_url', '');
  }

  getLarkChatId() {
    return this.siteConf.getString('oncall.lark.chat_id', '');
  }

  getDefaultEnvironment() {
    return this.siteConf.getString('oncall.default_environment', 'mgbx');
  }

  getAllowInsecureWebhook() {
    return this.siteConf.getBoolean('oncall.webhook.allow_insecure', false);
  }

  getHotlineAppId() {
    return this.siteConf.getString('oncall.hotline.lark_app_id', '');
  }

  getHotlineAppSecret() {
    return this.siteConf.getString('oncall.hotline.lark_app_secret', '');
  }

  getHotlineEnabled() {
    return this.siteConf.getBoolean('oncall.hotline.enabled', false);
  }

  getUrgentPhoneSupported() {
    return this.siteConf.getBoolean('oncall.hotline.urgent_phone_supported', false);
  }

  getEscalationEnabled() {
    return this.siteConf.getBoolean('oncall.escalation.enabled', false);
  }

  getL1AckTimeoutMinutes() {
    return this.siteConf.getNumber('oncall.escalation.l1_ack_timeout_minutes', 10);
  }

  getL2AckTimeoutMinutes() {
    return this.siteConf.getNumber('oncall.escalation.l2_ack_timeout_minutes', 5);
  }

  getOwnerAckTimeoutMinutes() {
    return this.siteConf.getNumber('oncall.escalation.owner_ack_timeout_minutes', 5);
  }
}
