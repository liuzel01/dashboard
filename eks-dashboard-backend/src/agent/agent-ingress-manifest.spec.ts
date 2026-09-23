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
