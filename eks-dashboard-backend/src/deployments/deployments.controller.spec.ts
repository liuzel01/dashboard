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

  it('returns an actionable forbidden response when namespace listing is blocked by RBAC', async () => {
    const controller = new DeploymentsController({
      listNamespaces: jest.fn().mockRejectedValue({
        body: { reason: 'Forbidden', code: 403 },
      }),
    } as any);

    await expect(controller.getNamespaces('tb')).rejects.toMatchObject({
      status: 403,
      response: expect.stringContaining('default'),
    });
  });

  it('reports unavailable Kubernetes access when the selected kubecontext is absent locally', async () => {
    const controller = new DeploymentsController({
      listNamespaces: jest.fn().mockRejectedValue(
        new Error('Kubeconfig context "tb" not found in your kubeconfig file.'),
      ),
    } as any);

    await expect(controller.getNamespaces('tb')).rejects.toMatchObject({
      status: 503,
      response: expect.stringContaining('Kubernetes 访问链路'),
    });
  });

  it('uses the same unavailable-access response for workload listing', async () => {
    const controller = new DeploymentsController({
      getWorkloads: jest.fn().mockRejectedValue(
        new Error('Kubeconfig context "tb" not found in your kubeconfig file.'),
      ),
    } as any);

    await expect(controller.getDeployments('tb', undefined, 'default', 'deployment')).rejects.toMatchObject({
      status: 503,
      response: expect.stringContaining('Kubernetes 访问链路'),
    });
  });
});
