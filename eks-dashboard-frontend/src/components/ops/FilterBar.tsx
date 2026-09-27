import React from 'react';
import './ops-ui.css';

type FilterBarProps = {
  children: React.ReactNode;
  actions?: React.ReactNode;
  ariaLabel?: string;
};

const FilterBar: React.FC<FilterBarProps> = ({ children, actions, ariaLabel = '筛选条件' }) => (
  <section className="ops-filter-bar" aria-label={ariaLabel}>
    <div className="ops-filter-bar__fields">{children}</div>
    {actions && <div className="ops-filter-bar__actions">{actions}</div>}
  </section>
);

export default FilterBar;
