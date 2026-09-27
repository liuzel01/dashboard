import React from 'react';
import { Space, Tag } from 'antd';
import './ops-ui.css';

type PageHeaderProps = {
  title: React.ReactNode;
  description?: React.ReactNode;
  environmentName?: string | null;
  scope?: React.ReactNode;
  actions?: React.ReactNode;
};

const PageHeader: React.FC<PageHeaderProps> = ({ title, description, environmentName, scope, actions }) => (
  <section className="ops-page-header" aria-label={typeof title === 'string' ? title : undefined}>
    <div className="ops-page-header__main">
      <div className="ops-page-header__title-row"><h1 className="ops-page-header__title">{title}</h1></div>
      {description && <div className="ops-page-header__description">{description}</div>}
      {(environmentName || scope) && (
        <Space size={[8, 8]} wrap className="ops-page-header__meta">
          {environmentName && <Tag color="blue">环境：{environmentName}</Tag>}
          {scope}
        </Space>
      )}
    </div>
    {actions && <div className="ops-page-header__actions">{actions}</div>}
  </section>
);

export default PageHeader;
