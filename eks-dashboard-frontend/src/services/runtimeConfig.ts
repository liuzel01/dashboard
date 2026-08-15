export type RuntimeConfig = {
  API_BASE_URL?: string;
  SSO_REDIRECT_URI?: string;
  SSO_POST_LOGOUT_REDIRECT_URI?: string;
};

export type PublicRuntimeConfig = {
  socketUrl?: string;
};

let cached: RuntimeConfig | null = null;
let publicCached: PublicRuntimeConfig | null = null;

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


export const getPublicRuntimeConfig = async (): Promise<PublicRuntimeConfig> => {
  if (publicCached) return publicCached;
  const resp = await fetch('/api/site-conf/runtime-config', { cache: 'no-store' });
  if (!resp.ok) {
    throw new Error(`Could not load public runtime config (${resp.status})`);
  }
  const data = await resp.json() as PublicRuntimeConfig;
  publicCached = data || {};
  return publicCached;
};
