import React from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import { BrowserRouter } from 'react-router-dom';
import 'antd/dist/reset.css'; // 关键：导入 Ant Design 的全局重置样式
import '@ant-design/v5-patch-for-react-19';


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* 1. 将路由包裹在最外层 */}
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1677ff',
          colorInfo: '#1677ff',
          colorSuccess: '#389e0d',
          colorWarning: '#d48806',
          colorError: '#cf1322',
          colorBgLayout: '#f5f7fa',
          borderRadius: 8,
          fontFamily: 'Inter, PingFang SC, Microsoft YaHei, system-ui, sans-serif',
        },
        components: {
          Layout: { headerBg: '#ffffff', siderBg: '#0f2741' },
          Menu: { darkItemBg: '#0f2741', darkSubMenuItemBg: '#0b2037', darkItemSelectedBg: '#1677ff' },
        },
      }}
    >
      <BrowserRouter>
        {/* 2. 将 Ant Design 的 App 上下文包裹在路由内部 */}
        <AntApp>
          {/* 3. 渲染你的主应用组件 */}
          <App />
        </AntApp>
      </BrowserRouter>
    </ConfigProvider>
  </React.StrictMode>,
);
