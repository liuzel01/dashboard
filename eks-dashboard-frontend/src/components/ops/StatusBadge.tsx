import React from 'react';
import { Badge, Tag } from 'antd';

export type StatusTone = 'success' | 'processing' | 'warning' | 'error' | 'default';

export type StatusDisplay = {
  label: string;
  tone: StatusTone;
};

const statusMap: Record<string, StatusDisplay> = {
  completed: { label: '已完成', tone: 'success' },
  healthy: { label: '健康', tone: 'success' },
  resolved: { label: '已恢复', tone: 'success' },
  sent: { label: '已发送', tone: 'success' },
  in_progress: { label: '处理中', tone: 'processing' },
  progressing: { label: '处理中', tone: 'processing' },
  firing: { label: '告警中', tone: 'error' },
  failed: { label: '失败', tone: 'error' },
  critical: { label: '严重', tone: 'error' },
  blocked: { label: '受阻', tone: 'warning' },
  acked: { label: '已确认', tone: 'warning' },
  unsupported: { label: '当前能力不支持', tone: 'warning' },
  warning: { label: '注意', tone: 'warning' },
  unknown: { label: '未知', tone: 'default' },
};

type StatusBadgeProps = {
  status?: string | null;
  label?: string;
  mode?: 'tag' | 'badge';
};

const toDisplay = (status?: string | null, label?: string): StatusDisplay => {
  const normalized = String(status || 'unknown').trim().toLowerCase();
  const mapped = statusMap[normalized] || { label: status || '未知', tone: 'default' as StatusTone };
  return { ...mapped, label: label || mapped.label };
};

const StatusBadge: React.FC<StatusBadgeProps> = ({ status, label, mode = 'tag' }) => {
  const display = toDisplay(status, label);
  return mode === 'badge'
    ? <Badge status={display.tone} text={display.label} />
    : <Tag color={display.tone}>{display.label}</Tag>;
};

export default StatusBadge;
