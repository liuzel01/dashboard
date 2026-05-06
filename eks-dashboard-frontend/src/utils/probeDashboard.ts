const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> })?.env || {};

export const probeDashboardBaseUrl = String(viteEnv.VITE_PROBE_DASHBOARD_URL || '').trim();

export const getProbeDetailBaseUrl = (probeSourceApi?: string | null) => {
  if (probeDashboardBaseUrl) return probeDashboardBaseUrl;
  if (probeSourceApi) {
    try {
      const parsed = new URL(probeSourceApi);
      return `${parsed.protocol}//${parsed.host}`;
    } catch {
      // ignore invalid source api
    }
  }
  return '';
};

export const buildProbeDetailUrl = (lineUrl?: string | null, probeSourceApi?: string | null) => {
  if (!lineUrl) return null;
  const base = getProbeDetailBaseUrl(probeSourceApi);
  if (!base) return null;
  try {
    const url = new URL(base);
    url.searchParams.set('lineUrl', lineUrl);
    return url.toString();
  } catch {
    return `${base}${base.includes('?') ? '&' : '?'}lineUrl=${encodeURIComponent(lineUrl)}`;
  }
};
