import React from 'react';
import { Empty } from 'antd';

const PlaceholderPage: React.FC = () => {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
      <Empty description="此功能正在开发中..." />
    </div>
  );
};

export default PlaceholderPage;
