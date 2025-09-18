import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // 允许通过 IP 地址访问
    proxy: {
      // 将 /api 开头的请求代理到后端服务
      '/api': {
        target: 'http://localhost:3000', // 你的 NestJS 后端地址
        changeOrigin: true, // 改变源，以避免跨域问题
      },
      // 为 WebSocket 连接添加代理
      '/socket.io': {
        target: 'http://localhost:3000', // 你的 NestJS 后端地址
        ws: true, // 启用 WebSocket 代理
      },
    },
  },
});