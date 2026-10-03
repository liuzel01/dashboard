import { validateWorkloadBundle } from './workload-bundle-policy';

const valid = `apiVersion: v1
kind: Service
metadata:
  name: demo-service
spec:
  ports:
    - port: 80
      targetPort: 8080
  selector:
    app: demo
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-deployment
spec:
  replicas: 1
  selector:
    matchLabels:
      app: demo
  template:
    metadata:
      labels:
        app: demo
    spec:
      serviceAccountName: kms-app-sa
      imagePullSecrets:
        - name: \${IMAGE_PULL_SECRET}
      containers:
        - name: demo
          image: \${IMAGE_REGISTRY}/\${IMAGE_NAME}:\${DOCKER_TAG}
          ports:
            - containerPort: 8080
          readinessProbe: { httpGet: { path: /health, port: 8080 } }
          livenessProbe: { httpGet: { path: /health, port: 8080 } }
          resources:
            requests: { cpu: 100m, memory: 128Mi }
            limits: { cpu: 1, memory: 1Gi }
`;

describe('workload bundle policy', () => {
  it('accepts one controlled Service and Deployment', () => {
    expect(validateWorkloadBundle(valid, 'k8s-yaml/deployments/kylin/demo-deployment.yaml')).toMatchObject({ deploymentName: 'demo-deployment', serviceName: 'demo-service' });
  });
  it('rejects privileged containers', () => {
    expect(() => validateWorkloadBundle(valid.replace('image:', 'securityContext: { privileged: true }\n          image:'), 'k8s-yaml/deployments/kylin/demo-deployment.yaml')).toThrow('privileged');
  });
  it('rejects selectors that do not match', () => {
    expect(() => validateWorkloadBundle(valid.replace('selector:\n    app: demo', 'selector:\n    app: other'), 'k8s-yaml/deployments/kylin/demo-deployment.yaml')).toThrow('必须完全一致');
  });
});
