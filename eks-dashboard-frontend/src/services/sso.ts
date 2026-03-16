export const resolveSsoRedirectUri = (value?: string) => {
  const raw = (value || '').trim();
  if (!raw) return `${window.location.origin}/sso/callback`;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) return `${window.location.origin}${raw}`;
  return `${window.location.origin}/${raw}`;
};
