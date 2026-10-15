import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ColumnSettingOption } from './ColumnSettingsPopover';

type UseVisibleColumnsOptions<Key extends string> = {
  storageKey?: string;
  options: Array<ColumnSettingOption<Key>>;
  defaultVisibleKeys: Key[];
};

export const useVisibleColumns = <Key extends string>({ storageKey, options, defaultVisibleKeys }: UseVisibleColumnsOptions<Key>) => {
  const optionSignature = options.map((option) => option.value).join('|');
  const defaultSignature = defaultVisibleKeys.join('|');
  const validKeys = useMemo(() => new Set(options.map((option) => option.value)), [optionSignature]);
  const normalizedDefaults = useMemo(
    () => Array.from(new Set(defaultVisibleKeys.filter((key) => validKeys.has(key)))),
    [defaultSignature, validKeys],
  );
  const normalize = useCallback((value: unknown): Key[] => {
    if (!Array.isArray(value)) return normalizedDefaults;
    const next = Array.from(new Set(value.filter((key): key is Key => typeof key === 'string' && validKeys.has(key as Key))));
    return next.length > 0 ? next : normalizedDefaults;
  }, [normalizedDefaults, validKeys]);
  const load = useCallback(() => {
    if (!storageKey || typeof window === 'undefined') return normalizedDefaults;
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw ? normalize(JSON.parse(raw)) : normalizedDefaults;
    } catch {
      return normalizedDefaults;
    }
  }, [storageKey, normalize, normalizedDefaults]);
  const [visibleKeys, setVisibleKeysState] = useState<Key[]>(load);

  useEffect(() => { setVisibleKeysState(load()); }, [load]);
  useEffect(() => {
    if (storageKey && typeof window !== 'undefined') window.localStorage.setItem(storageKey, JSON.stringify(visibleKeys));
  }, [storageKey, visibleKeys]);

  return {
    visibleKeys,
    setVisibleKeys: (value: Array<string | number | boolean>) => setVisibleKeysState(normalize(value)),
    resetVisibleKeys: () => setVisibleKeysState(normalizedDefaults),
  };
};
