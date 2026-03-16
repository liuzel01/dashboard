import React from 'react';
import { Result } from 'antd';

const ForbiddenPage: React.FC = () => (
  <Result
    status="403"
    title="403"
    subTitle="你没有权限访问该页面"
  />
);

export default ForbiddenPage;
