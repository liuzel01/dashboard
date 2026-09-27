import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { setApiEnvironment } from '../services/api';
import { getRuntimeConfig } from '../services/runtimeConfig';
import { AuthContext } from './AuthContextValue';
import { EnvironmentContext } from './EnvironmentContextValue';
import type { Environment } from './EnvironmentContextValue';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchJsonWithTimeout = async <T,>(url: string, timeoutMs = 8000): Promise<T> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) {
      throw new Error(`${url} returned ${response.status}`);
    }
    return (await response.json()) as T;
  } finally {
    window.clearTimeout(timeout);
  }
};

export const EnvironmentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated, loading: authLoading } = useContext(AuthContext);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [currentEnvironment, setCurrentEnvironment] = useState<Environment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const handleSetCurrentEnvironment = useCallback((environment: Environment) => {
    setCurrentEnvironment(environment);
    localStorage.setItem('currentEnvironmentId', environment.id);
    setApiEnvironment(environment.id);
  }, []);

  const fetchEnvironments = useCallback(async () => {
    if (authLoading) return;
    if (!isAuthenticated) {
      setEnvironments([]);
      setCurrentEnvironment(null);
      setApiEnvironment(null);
      setError(null);
      setLoading(false);
      return;
    }

    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setLoading(true);
    setError(null);

    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const config = await getRuntimeConfig();
        const apiBaseUrl = config.API_BASE_URL;
        if (!apiBaseUrl) {
          throw new Error('API_BASE_URL not found in /environment.json');
        }

        const data = await fetchJsonWithTimeout<Environment[]>(`${apiBaseUrl}/environments`);
        if (seq !== requestSeq.current) return;

        setEnvironments(data);
        const storedEnvId = localStorage.getItem('currentEnvironmentId');
        const initialEnv = data.find((e) => e.id === storedEnvId) || data[0] || null;
        if (initialEnv) {
          handleSetCurrentEnvironment(initialEnv);
        } else {
          setCurrentEnvironment(null);
          setApiEnvironment(null);
        }
        setError(null);
        return;
      } catch (err: unknown) {
        lastError = err;
        if (attempt < 2) {
          await sleep(400 * (attempt + 1));
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
        }
      }
    }

    if (seq === requestSeq.current) {
      setError((lastError as ApiError | null)?.message || '加载环境失败');
    }
  }, [authLoading, isAuthenticated, handleSetCurrentEnvironment]);

  useEffect(() => {
    fetchEnvironments();
  }, [fetchEnvironments]);

  const value = useMemo(
    () => ({
      environments,
      currentEnvironment,
      setCurrentEnvironment: handleSetCurrentEnvironment,
      refreshEnvironments: fetchEnvironments,
      loading,
      error,
    }),
    [environments, currentEnvironment, handleSetCurrentEnvironment, fetchEnvironments, loading, error],
  );

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
};
