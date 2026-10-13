import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PlatformDatabaseService } from '../access-control/platform-database.service';

export type MenuOrderMap = Record<string, string[]>;

export const DEFAULT_MENU_ORDERS: MenuOrderMap = {
  '/cloud-resources': ['/deployments', '/jump-servers', '/security-groups', '/s3-upload'],
  '/asset-management': ['/asset-management/overview', '/asset-management/resources', '/asset-management/domains', '/asset-management/accounts', '/asset-management/credential-refs', '/asset-management/change-logs'],
  '/line-management': ['/lines', '/line-onboarding', '/admin-site-ingress'],
  '/monitoring': ['/site-monitors', '/dependency-health', '/monitoring-requests', '/oncall'],
  '/ops-tools': ['/data-query', '/cicd-runs', '/ssl-certificates', '/kms-values', '/ai-ops'],
  '/system-management': ['/access-control', '/environments', '/site-conf', '/menu-management'],
  '/access-control': ['/access-control/users', '/access-control/audit-logs'],
  '/cert-study': ['/cert-study/sap-c02', '/cert-study/dop-c02', '/cert-study/scs-c03'],
  '/signal-monitor': ['/signal-monitor/realtime', '/signal-monitor/history', '/signal-monitor/stats', '/signal-monitor/daily'],
};

const CONFIG_SCOPE = 'global';

@Injectable()
export class MenuOrderService implements OnModuleInit {
  constructor(private readonly db: PlatformDatabaseService) {}

  async onModuleInit() {
    await this.ensureTable();
  }

  async get() {
    await this.ensureTable();
    const rows = await this.db.query<Array<{ order_json: unknown }>>(
      'SELECT order_json FROM dashboard_menu_order WHERE scope = ? LIMIT 1',
      [CONFIG_SCOPE],
    );
    if (!rows[0]?.order_json) return { groups: this.defaultOrders(), isDefault: true };
    try {
      const raw = rows[0].order_json;
      const stored = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
      // New nested menus keep their default order until an administrator saves
      // the expanded tree once.
      return { groups: this.validate({ ...this.defaultOrders(), ...stored }), isDefault: false };
    } catch {
      return { groups: this.defaultOrders(), isDefault: true };
    }
  }

  async update(input: unknown, actorId: number) {
    const groups = this.validate(input);
    await this.ensureTable();
    await this.db.query(
      `INSERT INTO dashboard_menu_order (scope, order_json, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, UTC_TIMESTAMP(), UTC_TIMESTAMP())
       ON DUPLICATE KEY UPDATE order_json = VALUES(order_json), updated_by = VALUES(updated_by), updated_at = UTC_TIMESTAMP()`,
      [CONFIG_SCOPE, JSON.stringify(groups), actorId],
    );
    return { groups, isDefault: false };
  }

  async reset() {
    await this.ensureTable();
    await this.db.query('DELETE FROM dashboard_menu_order WHERE scope = ?', [CONFIG_SCOPE]);
    return { groups: this.defaultOrders(), isDefault: true };
  }

  private async ensureTable() {
    await this.db.query(`CREATE TABLE IF NOT EXISTS dashboard_menu_order (
      scope VARCHAR(32) NOT NULL,
      order_json JSON NOT NULL,
      updated_by BIGINT UNSIGNED NULL,
      created_at DATETIME NOT NULL,
      updated_at DATETIME NOT NULL,
      PRIMARY KEY (scope),
      KEY idx_dashboard_menu_order_updated_at (updated_at)
    )`);
  }

  private defaultOrders(): MenuOrderMap {
    return Object.fromEntries(Object.entries(DEFAULT_MENU_ORDERS).map(([group, items]) => [group, [...items]]));
  }

  private validate(input: unknown): MenuOrderMap {
    let candidate: unknown = input;
    if (typeof input === 'string') {
      try { candidate = JSON.parse(input); } catch { throw new BadRequestException('菜单排序配置必须为合法 JSON'); }
    }
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
      throw new BadRequestException('菜单排序配置格式无效');
    }
    const groups = candidate as Record<string, unknown>;
    const knownGroups = Object.keys(DEFAULT_MENU_ORDERS);
    if (Object.keys(groups).length !== knownGroups.length || Object.keys(groups).some((group) => !knownGroups.includes(group))) {
      throw new BadRequestException('菜单分组不允许新增、删除或跨组移动');
    }
    const normalized: MenuOrderMap = {};
    for (const group of knownGroups) {
      const entries = groups[group];
      if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) {
        throw new BadRequestException(`菜单分组 ${group} 的排序格式无效`);
      }
      const expected = DEFAULT_MENU_ORDERS[group];
      if (entries.length !== expected.length || new Set(entries).size !== entries.length || entries.some((entry) => !expected.includes(entry))) {
        throw new BadRequestException(`菜单分组 ${group} 仅允许调整现有菜单顺序`);
      }
      normalized[group] = [...entries];
    }
    return normalized;
  }
}
