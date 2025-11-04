module.exports = {
  apps: [
    {
      name: 'eks-dashboard-backend',
      namespace: 'dev',
      cwd: 'eks-dashboard-backend',
      script: 'node',
      args: 'dist/main.js',
      merge_logs: true,
      env: {
        NODE_ENV: 'development',
      },
      error_file: 'logs/pm2-err.log',
      out_file: 'logs/pm2-out.log',
      time: true,
      watch: false,
    },
    {
      name: 'eks-dashboard-frontend',
      namespace: 'dev',
      cwd: 'eks-dashboard-frontend',
      script: 'npm',
      args: 'run dev',
      merge_logs: true,
      env: {
        NODE_ENV: 'development',
      },
      error_file: 'logs/pm2-err.log',
      out_file: 'logs/pm2-out.log',
      time: true,
      watch: false,
    },
  ],
};
