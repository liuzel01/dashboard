import { AgentIngressService } from './agent-ingress.service';

const service = Object.create(AgentIngressService.prototype) as AgentIngressService;

describe('AgentIngressService manifest validation', () => {
  const validManifest = `apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: tenant-example
  namespace: default
spec:
  ingressClassName: nginx
  rules:
    - host: tenant.example.com
      http:
        paths: []
`;

  it('accepts one editable Ingress document and identifies risk warnings', () => {
    const manifest = (service as any).parseIngressManifest(validManifest.replace(
      '  namespace: default\n',
      "  namespace: default\n  annotations:\n    nginx.ingress.kubernetes.io/server-snippet: 'return 403;'\n",
    ));
    const warnings = (service as any).getManifestWarnings(manifest);

    expect(manifest.metadata.name).toBe('tenant-example');
    expect(warnings.map((warning: { annotation: string }) => warning.annotation)).toEqual([
      'nginx.ingress.kubernetes.io/server-snippet',
      'spec.ingressClassName',
    ]);
  });

  it('rejects multiple Kubernetes resources in one YAML payload', () => {
    expect(() => (service as any).parseIngressManifest(`${validManifest}---\n${validManifest}`))
      .toThrow('exactly one resource document');
  });

  it('rejects server-managed metadata before dry-run', () => {
    expect(() => (service as any).parseIngressManifest(validManifest.replace(
      '  namespace: default\n',
      "  namespace: default\n  resourceVersion: '123'\n",
    )))
      .toThrow('server-managed metadata');
  });

  it('rejects non-string annotation values with an actionable message', () => {
    expect(() => (service as any).parseIngressManifest(validManifest.replace(
      '  namespace: default\n',
      '  namespace: default\n  annotations:\n    nginx.ingress.kubernetes.io/ssl-redirect: true\n',
    ))).toThrow('metadata.annotations values must be strings');
  });

  it('quotes ambiguous string scalars when generating preview YAML', () => {
    const yaml = (service as any).toYaml({
      metadata: { annotations: { 'example.com/enabled': 'true', 'example.com/port': '443' } },
    });
    expect(yaml).toContain('example.com/enabled: "true"');
    expect(yaml).toContain('example.com/port: "443"');
  });
});

describe('AgentIngressService TLS Secret naming', () => {
  it('derives the new Secret from the new host even when a stale name is supplied', () => {
    const resolveTlsSecretName = (service as any).resolveTlsSecretName.bind(service);

    expect(
      resolveTlsSecretName('line-c-tls', {
        newHost: '24e1b9eef5430ffd.line-c.ekb26app.cfd',
        tlsSecretMode: 'new',
        tlsSecretName: 'line-c-tls',
      }),
    ).toBe('24e1b9eef5430ffd-line-c-ekb26app-cfd-tls');

    expect(
      resolveTlsSecretName('bk-tls', {
        newHost: 'bk.vlink2tenant.shop',
        tlsSecretMode: 'new',
        tlsSecretName: 'bk-tls',
      }),
    ).toBe('bk-vlink2tenant-shop-tls');
  });

  it('keeps explicit reuse and custom strategies unchanged', () => {
    const resolveTlsSecretName = (service as any).resolveTlsSecretName.bind(service);

    expect(resolveTlsSecretName('source-tls', { newHost: 'new.example.com', tlsSecretMode: 'reuse' })).toBe('source-tls');
    expect(
      resolveTlsSecretName('source-tls', {
        newHost: 'new.example.com',
        tlsSecretMode: 'custom',
        tlsSecretName: 'my-custom-tls',
      }),
    ).toBe('my-custom-tls');
  });
});

describe('AgentIngressService Ingress route conflict helpers', () => {
  it('treats exact hosts and matching wildcard hosts as overlapping', () => {
    const hostsOverlap = (service as any).hostsOverlap.bind(service);

    expect(hostsOverlap('bk.example.com', 'bk.example.com')).toBe(true);
    expect(hostsOverlap('*.example.com', 'bk.example.com')).toBe(true);
    expect(hostsOverlap('*.example.com', 'deep.bk.example.com')).toBe(false);
    expect(hostsOverlap('bk.example.com', 'other.example.com')).toBe(false);
  });

  it('allows disjoint paths but detects overlapping prefix and exact routes', () => {
    const pathsOverlap = (service as any).pathsOverlap.bind(service);

    expect(pathsOverlap({ path: '/api', pathType: 'Prefix' }, { path: '/web', pathType: 'Prefix' })).toBe(false);
    expect(pathsOverlap({ path: '/api', pathType: 'Prefix' }, { path: '/api/orders', pathType: 'Prefix' })).toBe(true);
    expect(pathsOverlap({ path: '/api', pathType: 'Exact' }, { path: '/api', pathType: 'Prefix' })).toBe(true);
    expect(pathsOverlap({ path: '/api', pathType: 'Exact' }, { path: '/api/orders', pathType: 'Prefix' })).toBe(false);
  });

  it('reports same-host ingresses without blocking disjoint routes', async () => {
    (service as any).networkingV1Api = {
      listIngressForAllNamespaces: jest.fn().mockResolvedValue({ body: { items: [
        {
          metadata: { namespace: 'default', name: 'existing-api' },
          spec: { ingressClassName: 'nginx', rules: [{ host: 'bk.example.com', http: { paths: [{ path: '/api', pathType: 'Prefix' }] } }] },
        },
        {
          metadata: { namespace: 'default', name: 'existing-web' },
          spec: { ingressClassName: 'nginx', rules: [{ host: 'bk.example.com', http: { paths: [{ path: '/web', pathType: 'Prefix' }] } }] },
        },
      ] } }),
    };

    const report = await (service as any).findIngressConflicts({
      spec: { ingressClassName: 'nginx', rules: [{ host: 'bk.example.com', http: { paths: [{ path: '/shop', pathType: 'Prefix' }] } }] },
    });

    expect(report.hostConflicts).toHaveLength(2);
    expect(report.routeConflicts).toHaveLength(0);
  });

  it('blocks a same-host route that overlaps an existing prefix', async () => {
    (service as any).networkingV1Api = {
      listIngressForAllNamespaces: jest.fn().mockResolvedValue({ body: { items: [
        {
          metadata: { namespace: 'default', name: 'existing-api' },
          spec: { ingressClassName: 'nginx', rules: [{ host: 'bk.example.com', http: { paths: [{ path: '/api', pathType: 'Prefix' }] } }] },
        },
      ] } }),
    };

    const report = await (service as any).findIngressConflicts({
      spec: { ingressClassName: 'nginx', rules: [{ host: 'bk.example.com', http: { paths: [{ path: '/api/orders', pathType: 'Prefix' }] } }] },
    });

    expect(report.hostConflicts).toHaveLength(1);
    expect(report.routeConflicts).toHaveLength(1);
    expect(report.routeConflicts[0].overlappingPaths).toEqual(['/api/orders']);
  });
});
