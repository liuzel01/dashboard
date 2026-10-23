import { BadRequestException } from '@nestjs/common';
import { DEFAULT_MENU_ORDERS, MENU_CATALOG, MenuOrderService } from './menu-order.service';

describe('MenuOrderService', () => {
  const db = { query: jest.fn().mockResolvedValue([]) };
  const service = new MenuOrderService(db as never);

  beforeEach(() => jest.clearAllMocks());

  it('accepts a complete reordering of known menu entries', () => {
    const input = Object.fromEntries(Object.entries(DEFAULT_MENU_ORDERS).map(([group, entries]) => [group, [...entries].reverse()]));
    expect((service as any).validate(input)).toEqual(input);
  });

  it('rejects menu entries moved across groups', () => {
    const input = Object.fromEntries(Object.entries(DEFAULT_MENU_ORDERS).map(([group, entries]) => [group, [...entries]]));
    input['/ops-tools'][0] = '/deployments';
    expect(() => (service as any).validate(input)).toThrow(BadRequestException);
  });

  it('includes nested submenu orders in the default configuration', () => {
    expect(DEFAULT_MENU_ORDERS['/access-control']).toEqual([
      '/access-control/users',
      '/access-control/audit-logs',
    ]);
  });

  it('includes every recently added sidebar menu in the catalog', () => {
    const keys = MENU_CATALOG.flatMap((group) => group.items.map((item) => item.key));
    expect(keys).toEqual(expect.arrayContaining([
      '/dependency-health',
      '/jumpserver-access',
      '/bytebase',
      '/aws-access',
      '/aws-governance',
    ]));
  });

  it('keeps saved positions and appends newly registered menus', async () => {
    const stored = Object.fromEntries(
      Object.entries(DEFAULT_MENU_ORDERS).map(([group, entries]) => [group, [...entries]]),
    );
    stored['/ops-tools'] = ['/ai-ops', '/data-query'];
    db.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT order_json')) return [{ order_json: stored }];
      return [];
    });

    const result = await service.get();

    expect(result.groups['/ops-tools'].slice(0, 2)).toEqual(['/ai-ops', '/data-query']);
    expect(result.groups['/ops-tools']).toEqual(expect.arrayContaining(DEFAULT_MENU_ORDERS['/ops-tools']));
    expect(result.catalog).toBe(MENU_CATALOG);
  });

  it('reads the JSON object shape returned by mysql2 without falling back to defaults', async () => {
    const custom = Object.fromEntries(Object.entries(DEFAULT_MENU_ORDERS).map(([group, entries]) => [group, [...entries]]));
    custom['/cloud-resources'] = ['/deployments', '/jump-servers', '/s3-upload', '/security-groups'];
    db.query.mockImplementation(async (sql: string) => {
      if (sql.startsWith('SELECT order_json')) return [{ order_json: custom }];
      return [];
    });

    const result = await service.get();
    expect(result.isDefault).toBe(false);
    expect(result.groups['/cloud-resources']).toEqual([
      ...custom['/cloud-resources'],
      '/aws-governance',
    ]);
  });

  it('does not persist a custom order when reset', async () => {
    await service.reset();
    expect(db.query).toHaveBeenCalledWith('DELETE FROM dashboard_menu_order WHERE scope = ?', ['global']);
  });
});
