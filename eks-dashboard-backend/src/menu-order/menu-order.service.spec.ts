import { BadRequestException } from '@nestjs/common';
import { DEFAULT_MENU_ORDERS, MenuOrderService } from './menu-order.service';

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

  it('does not persist a custom order when reset', async () => {
    await service.reset();
    expect(db.query).toHaveBeenCalledWith('DELETE FROM dashboard_menu_order WHERE scope = ?', ['global']);
  });
});
