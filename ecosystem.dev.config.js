module.exports = {
  apps: [
    {
      name: 'eks-dashboard-backend',
      namespace: 'dev',
      cwd: 'eks-dashboard-backend',
      script: 'node',
      args: 'dist/main.js',
      env: {
        NODE_ENV: 'development',
      },
      error_file: 'eks-dashboard-backend/logs/pm2-err.log',
      out_file: 'eks-dashboard-backend/logs/pm2-out.log',
      time: true,
      watch: false,
    },
    {
      name: 'eks-dashboard-frontend',
      namespace: 'dev',
      cwd: 'eks-dashboard-frontend',
      script: 'npm',
      args: 'run dev',
      env: {
        NODE_ENV: 'development',
      },
      error_file: 'eks-dashboard-frontend/pm2-err.log',
      out_file: 'eks-dashboard-frontend/pm2-out.log',
      time: true,
      watch: false,
    },
  ],
};
