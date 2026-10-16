const DEFAULT_TIME_ZONE = 'Asia/Shanghai';
const SQL_DATE_TIME = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

let displayTimeZone = DEFAULT_TIME_ZONE;

export const setDisplayTimeZone = (value?: string) => {
  const candidate = String(value || '').trim() || DEFAULT_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('zh-CN', { timeZone: candidate }).format();
    displayTimeZone = candidate;
  } catch {
    displayTimeZone = DEFAULT_TIME_ZONE;
  }
};

export const getDisplayTimeZone = () => displayTimeZone;

export const parseApiDateTime = (value?: string | Date | null): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const raw = String(value).trim();
  if (!raw || DATE_ONLY.test(raw)) return null;
  const normalized = SQL_DATE_TIME.test(raw) ? `${raw.replace(' ', 'T')}Z` : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatParts = (value: string | Date | null | undefined, options: Intl.DateTimeFormatOptions) => {
  const date = parseApiDateTime(value);
  if (!date) return value ? String(value) : '-';
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: displayTimeZone,
    hourCycle: 'h23',
    ...options,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || '';
  return { part };
};

export const formatDateTime = (value?: string | Date | null) => {
  const formatted = formatParts(value, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  if (typeof formatted === 'string') return formatted;
  return `${formatted.part('year')}-${formatted.part('month')}-${formatted.part('day')} ${formatted.part('hour')}:${formatted.part('minute')}:${formatted.part('second')}`;
};

export const formatDate = (value?: string | Date | null) => {
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value;
  const formatted = formatParts(value, { year: 'numeric', month: '2-digit', day: '2-digit' });
  if (typeof formatted === 'string') return formatted;
  return `${formatted.part('year')}-${formatted.part('month')}-${formatted.part('day')}`;
};

export const formatTime = (value?: string | Date | null) => {
  const formatted = formatParts(value, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  if (typeof formatted === 'string') return formatted;
  return `${formatted.part('hour')}:${formatted.part('minute')}:${formatted.part('second')}`;
};
