module.exports = {
  apps: [{
    name: 'eks-dashboard-backend',
    script: 'dist/main.js',
    // 重点：在这里为应用进程注入环境变量
    env: {
      // 明确指定 kubeconfig 文件的绝对路径
      // 请将 /home/jenkins 替换为 jenkins 用户的实际主目录
      "KUBECONFIG": "/Users/liuzelin/.kube/config",

      // AWS SDK 会自动在 HOME 目录下的 .aws/ 文件夹中寻找配置文件
      // 为保险起见，也可以明确指定 HOME 目录
      // "HOME": "/home/jenkins"
    }
  }]
};

