import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const proxy = {
  // Signal Monitor（price-alert）接口走独立后端
  '/api/signal-monitor': {
    target: 'http://localhost:8787',
    changeOrigin: true,
  },
  // 其他 /api 仍走现有后端
  '/api': {
    target: 'http://localhost:3000',
    changeOrigin: true,
  },
  // 为 WebSocket 连接添加代理
  '/socket.io': {
    target: 'http://localhost:3000',
    ws: true,
  },
};

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0', // 允许通过 IP 地址访问
    proxy,
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: ['www.pree.mg56.net'],
    proxy,
  },
});
