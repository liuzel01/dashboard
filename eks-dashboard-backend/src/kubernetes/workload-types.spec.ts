import { listWorkloadTypes, resolveWorkloadType } from './workload-types';

describe('workload type registry', () => {
  it('uses Deployment as the backwards-compatible default', () => {
    expect(resolveWorkloadType()).toBe('deployment');
  });

  it('exposes the same supported types and capability contract to callers', () => {
    expect(listWorkloadTypes()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          value: 'deployment',
          capabilities: expect.objectContaining({ imageRollback: true }),
        }),
        expect.objectContaining({
          value: 'statefulset',
          capabilities: expect.objectContaining({
            logs: true,
            imageRollback: false,
          }),
        }),
        expect.objectContaining({
          value: 'daemonset',
          capabilities: expect.objectContaining({ logs: true, restart: true }),
        }),
      ]),
    );
  });

  it('does not accept arbitrary Kubernetes resource kinds', () => {
    expect(() => resolveWorkloadType('job')).toThrow(
      'Unsupported workload type',
    );
  });
});
