export type RuntimeConfig = {
  API_BASE_URL?: string;
  SSO_REDIRECT_URI?: string;
  SSO_POST_LOGOUT_REDIRECT_URI?: string;
};

let cached: RuntimeConfig | null = null;

export const getRuntimeConfig = async (): Promise<RuntimeConfig> => {
  if (cached) return cached;
  const resp = await fetch('/environment.json');
  if (!resp.ok) {
    throw new Error('Could not load /environment.json');
  }
  const data = await resp.json();
  cached = data || {};
  return cached || {};
};
