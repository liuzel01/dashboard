import { DeploymentsController } from './deployments.controller';

describe('DeploymentsController workload listing', () => {
  it('uses the selected registered workload type and returns its capability contract', async () => {
    const k8sService = {
      getWorkloads: jest.fn().mockResolvedValue([{
        metadata: { name: 'ledger', namespace: 'default', generation: 3 },
        spec: { replicas: 2, template: { spec: { containers: [{ image: 'example/ledger:v1' }] } } },
        status: { readyReplicas: 2, updatedReplicas: 2, availableReplicas: 2, observedGeneration: 3 },
      }]),
    };
    const controller = new DeploymentsController(k8sService as any);

    const result = await controller.getDeployments('test', 'ledger', 'default', 'statefulset');

    expect(k8sService.getWorkloads).toHaveBeenCalledWith('test', 'statefulset', 'default');
    expect(result).toEqual([expect.objectContaining({
      name: 'ledger',
      workloadType: 'statefulset',
      workloadKind: 'StatefulSet',
      capabilities: expect.objectContaining({ logs: true, restart: true, imageRollback: false }),
    })]);
  });

  it('does not offer automatic restart for partial or OnDelete StatefulSet updates', async () => {
    const k8sService = {
      getWorkloads: jest.fn().mockResolvedValue([{
        metadata: { name: 'ledger', namespace: 'default' },
        spec: {
          replicas: 2,
          updateStrategy: { type: 'RollingUpdate', rollingUpdate: { partition: 1 } },
          template: { spec: { containers: [{ image: 'example/ledger:v1' }] } },
        },
        status: {},
      }]),
    };
    const controller = new DeploymentsController(k8sService as any);

    const [result] = await controller.getDeployments('test', undefined, 'default', 'statefulset');

    expect(result.capabilities).toMatchObject({ restart: false });
    expect(result.capabilities.restartReason).toContain('partition=1');
  });

  it('rejects a resource type outside the registry', async () => {
    const controller = new DeploymentsController({ getWorkloads: jest.fn() } as any);
    await expect(controller.getDeployments('test', undefined, 'default', 'job')).rejects.toMatchObject({ status: 400 });
  });
});
