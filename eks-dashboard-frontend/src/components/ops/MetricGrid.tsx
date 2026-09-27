import React from 'react';
import { Card, Statistic } from 'antd';
import type { StatisticProps } from 'antd';
import './ops-ui.css';

export type MetricItem = {
  key: React.Key;
  label: React.ReactNode;
  value: StatisticProps['value'];
  hint?: React.ReactNode;
  valueStyle?: StatisticProps['valueStyle'];
  formatter?: StatisticProps['formatter'];
};

type MetricGridProps = {
  items: MetricItem[];
  loading?: boolean;
  ariaLabel?: string;
};

const MetricGrid: React.FC<MetricGridProps> = ({ items, loading = false, ariaLabel = '摘要指标' }) => (
  <section className="ops-metric-grid" aria-label={ariaLabel}>
    {items.map((item) => (
      <Card key={item.key} size="small" className="ops-metric-card" loading={loading}>
        <Statistic
          title={item.label}
          value={item.value}
          formatter={item.formatter}
          valueStyle={item.valueStyle}
        />
        {item.hint && <span className="ops-metric-card__hint">{item.hint}</span>}
      </Card>
    ))}
  </section>
);

export default MetricGrid;
