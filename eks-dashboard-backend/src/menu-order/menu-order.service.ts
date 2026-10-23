import { BadRequestException, Injectable, OnModuleInit } from '@nestjs/common';
import { PlatformDatabaseService } from '../access-control/platform-database.service';

export type MenuOrderMap = Record<string, string[]>;

export type MenuCatalogGroup = {
  key: string;
  label: string;
  items: Array<{ key: string; label: string }>;
};

export const MENU_CATALOG: MenuCatalogGroup[] = [
  { key: '/cloud-resources', label: '云资源', items: [
    { key: '/deployments', label: 'EKS 部署' },
    { key: '/jump-servers', label: 'Windows 跳板机' },
    { key: '/security-groups', label: '安全组管理' },
    { key: '/aws-governance', label: 'AWS 云资源治理' },
    { key: '/s3-upload', label: 'S3 上传' },
  ] },
  { key: '/asset-management', label: '资产管理', items: [
    { key: '/asset-management/overview', label: '资产总览' },
    { key: '/asset-management/resources', label: '服务资源' },
    { key: '/asset-management/domains', label: '域名管理' },
    { key: '/asset-management/accounts', label: '账号管理' },
    { key: '/asset-management/credential-refs', label: '凭证索引' },
    { key: '/asset-management/change-logs', label: '变更记录' },
  ] },
  { key: '/line-management', label: '线路管理', items: [
    { key: '/lines', label: '线路总览' },
    { key: '/line-onboarding', label: '新增线路' },
    { key: '/admin-site-ingress', label: '管理端网站 Ingress' },
  ] },
  { key: '/monitoring', label: '监控与告警', items: [
    { key: '/site-monitors', label: '站点监控' },
    { key: '/dependency-health', label: '外部依赖健康' },
    { key: '/monitoring-requests', label: '监控资源申请' },
    { key: '/oncall', label: 'Oncall 告警' },
  ] },
  { key: '/ops-tools', label: '运维工具', items: [
    { key: '/data-query', label: '查询中心' },
    { key: '/cicd-runs', label: 'CI/CD 执行中心' },
    { key: '/jumpserver-access', label: 'jumpserver' },
    { key: '/bytebase', label: '数据库访问与变更' },
    { key: '/ssl-certificates', label: 'SSL证书申请' },
    { key: '/kms-values', label: 'KMS 配置加解密' },
    { key: '/ai-ops', label: 'AI 运维' },
    { key: '/aws-access', label: 'AWS 临时访问' },
  ] },
  { key: '/system-management', label: '系统管理', items: [
    { key: '/access-control', label: '账号管理' },
    { key: '/environments', label: '环境管理' },
    { key: '/site-conf', label: 'siteconf 配置' },
    { key: '/menu-management', label: '菜单排序管理' },
  ] },
  { key: '/access-control', label: '账号管理', items: [
    { key: '/access-control/users', label: '账号与权限' },
    { key: '/access-control/audit-logs', label: '审计日志' },
  ] },
  { key: '/cert-study', label: '证书题库', items: [
    { key: '/cert-study/sap-c02', label: 'SAP-C02' },
    { key: '/cert-study/dop-c02', label: 'DOP-C02' },
    { key: '/cert-study/scs-c03', label: 'SCS-C03' },
  ] },
  { key: '/signal-monitor', label: 'Signal Monitor', items: [
    { key: '/signal-monitor/realtime', label: '实时' },
    { key: '/signal-monitor/history', label: '触发记录' },
    { key: '/signal-monitor/stats', label: '统计' },
    { key: '/signal-monitor/daily', label: '日报' },
  ] },
];

export const DEFAULT_MENU_ORDERS: MenuOrderMap = Object.fromEntries(
  MENU_CATALOG.map((group) => [group.key, group.items.map((item) => item.key)]),
);

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
    if (!rows[0]?.order_json) return this.response(this.defaultOrders(), true);
    try {
      const raw = rows[0].order_json;
      const stored = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>;
      return this.response(this.mergeWithDefaults(stored), false);
    } catch {
      return this.response(this.defaultOrders(), true);
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
    return this.response(groups, false);
  }

  async reset() {
    await this.ensureTable();
    await this.db.query('DELETE FROM dashboard_menu_order WHERE scope = ?', [CONFIG_SCOPE]);
    return this.response(this.defaultOrders(), true);
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

  private response(groups: MenuOrderMap, isDefault: boolean) {
    return { groups, catalog: MENU_CATALOG, isDefault };
  }

  private mergeWithDefaults(stored: Record<string, unknown>): MenuOrderMap {
    const merged: MenuOrderMap = {};
    for (const [group, expected] of Object.entries(DEFAULT_MENU_ORDERS)) {
      const saved = Array.isArray(stored[group]) ? stored[group] : [];
      const retained = saved.filter(
        (entry, index): entry is string =>
          typeof entry === 'string' && expected.includes(entry) && saved.indexOf(entry) === index,
      );
      merged[group] = [...retained, ...expected.filter((entry) => !retained.includes(entry))];
    }
    return merged;
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
