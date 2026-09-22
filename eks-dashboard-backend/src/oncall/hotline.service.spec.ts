import { HotlineService } from './hotline.service';

describe('HotlineService', () => {
  const previous = process.env.HOTLINE_ENABLED;
  afterEach(() => { if (previous === undefined) delete process.env.HOTLINE_ENABLED; else process.env.HOTLINE_ENABLED = previous; });

  it('is fail-closed when outbound hotline is not explicitly enabled', async () => {
    process.env.HOTLINE_ENABLED = 'false';
    await expect(new HotlineService().requestUrgentPhone('message-id', ['ou_test']))
      .resolves.toEqual({ status: 'SKIPPED', detail: 'HOTLINE_ENABLED is not true' });
  });
});
