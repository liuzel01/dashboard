module.exports = {
  apps: [
    {
      name: 'eks-dashboard-backend',
      namespace: 'prod',
      cwd: 'eks-dashboard-backend',
      script: 'node',
      args: 'dist/main.js',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
        DASHBOARD_K8S_PRESERVE_EXEC_AUTH: 'false',
        KUBECONFIG: '/root/.kube/config',
        HOME: '/root',
      },
      error_file: 'logs/pm2-err.log',
      out_file: 'logs/pm2-out.log',
      time: true,
      watch: false,
    },
    {
      name: 'eks-dashboard-frontend',
      namespace: 'prod',
      cwd: 'eks-dashboard-frontend',
      script: 'npm',
      args: 'run preview -- --host 0.0.0.0 --port 5173',
      merge_logs: true,
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'logs/pm2-err.log',
      out_file: 'logs/pm2-out.log',
      time: true,
      watch: false,
    },
  ],
};
