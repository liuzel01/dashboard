import axios from 'axios';

const baseURL = (import.meta as any)?.env?.VITE_SIGNAL_MONITOR_API_BASE_URL || '/api/signal-monitor';

const signalMonitorApi = axios.create({
  baseURL,
  timeout: 10000,
});

export type RealtimeItem = {
  symbol: string;
  timeframe: string;
  rule: string;
  direction: string;
  priority: string;
  latest_price: number;
  latest_trigger_time: string;
};

export type RealtimeResponse = {
  ts: string;
  active: RealtimeItem[];
};

export type TriggerRow = {
  event_time: string;
  symbol: string;
  timeframe: string;
  rule: string;
  direction: string;
  priority: string;
  latest_price: number;
  dedupe_key: string;
  emitted: boolean;
  suppressed_reason?: string | null;
};

export type Triggers24hParams = {
  symbol?: string;
  rule?: string;
  timeframe?: string;
  priority?: string;
  page?: number;
  pageSize?: number;
};

export type Triggers24hResponse = {
  total: number;
  page: number;
  pageSize: number;
  items: TriggerRow[];
};

export type Stats24hResponse = {
  trigger_count: number;
  emitted_count: number;
  suppressed_count: number;
  suppressed_breakdown: Record<string, number>;
  send_success_rate: number;
  by_rule: Array<{ rule: string; trigger_count: number; emitted_count: number }>;
};

export type DailyReportResponse = {
  date: string;
  markdown: string;
  summary: {
    trigger_count: number;
    top_noise_rules: string[];
  };
};

export const getSignalMonitorRealtime = async (): Promise<RealtimeResponse> => {
  const resp = await signalMonitorApi.get('/realtime');
  return resp.data;
};

export const getSignalMonitorTriggers24h = async (params: Triggers24hParams): Promise<Triggers24hResponse> => {
  const resp = await signalMonitorApi.get('/triggers-24h', { params });
  return resp.data;
};

export const getSignalMonitorStats24h = async (): Promise<Stats24hResponse> => {
  const resp = await signalMonitorApi.get('/stats-24h');
  return resp.data;
};

export const getSignalMonitorDailyReport = async (date: string): Promise<DailyReportResponse> => {
  const resp = await signalMonitorApi.get('/daily-report', { params: { date } });
  return resp.data;
};

export default signalMonitorApi;
