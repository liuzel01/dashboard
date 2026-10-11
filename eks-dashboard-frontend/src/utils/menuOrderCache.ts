import type { MenuOrderMap } from '../services/api';

const CACHE_KEY = 'dashboard.menu-order.v1';
const CACHE_VERSION = 1;

type CachedMenuOrder = {
  version: number;
  groups: MenuOrderMap;
};

const isMenuOrderMap = (value: unknown): value is MenuOrderMap =>
  Boolean(value)
  && typeof value === 'object'
  && !Array.isArray(value)
  && Object.values(value as Record<string, unknown>).every((entries) =>
    Array.isArray(entries) && entries.every((entry) => typeof entry === 'string'));

export const readCachedMenuOrder = (): MenuOrderMap | null => {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_KEY) || '') as CachedMenuOrder;
    if (parsed?.version !== CACHE_VERSION || !isMenuOrderMap(parsed.groups)) return null;
    return parsed.groups;
  } catch {
    return null;
  }
};

export const writeCachedMenuOrder = (groups: MenuOrderMap) => {
  if (!isMenuOrderMap(groups) || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ version: CACHE_VERSION, groups } satisfies CachedMenuOrder));
  } catch {
    // Storage may be disabled; the next refresh safely falls back to loading once.
  }
};
