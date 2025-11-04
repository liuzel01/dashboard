module.exports = {
  apps: [
    {
      name: 'eks-dashboard-backend',
      namespace: 'prod',
      cwd: 'eks-dashboard-backend',
      script: 'node',
      args: 'dist/main.js',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'eks-dashboard-backend/logs/pm2-err.log',
      out_file: 'eks-dashboard-backend/logs/pm2-out.log',
      time: true,
      watch: false,
    },
    {
      name: 'eks-dashboard-frontend',
      namespace: 'prod',
      cwd: 'eks-dashboard-frontend',
      script: 'npm',
      args: 'run preview -- --host 0.0.0.0 --port 5173',
      env: {
        NODE_ENV: 'production',
      },
      error_file: 'eks-dashboard-frontend/pm2-err.log',
      out_file: 'eks-dashboard-frontend/pm2-out.log',
      time: true,
      watch: false,
    },
  ],
};
