import React, { createContext, useState, useEffect, useMemo, ReactNode } from 'react';
import { setApiEnvironment } from '../services/api';

export interface Environment {
  id: string;
  name: string;
}

interface EnvironmentContextType {
  environments: Environment[];
  currentEnvironment: Environment | null;
  setCurrentEnvironment: (environment: Environment) => void;
  loading: boolean;
  error: string | null;
}

export const EnvironmentContext = createContext<EnvironmentContextType>({
  environments: [],
  currentEnvironment: null,
  setCurrentEnvironment: () => {},
  loading: true,
  error: null,
});

export const EnvironmentProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [currentEnvironment, setCurrentEnvironment] = useState<Environment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchEnvironments = async () => {
      try {
        const response = await fetch('http://localhost:3000/api/environments');
        if (!response.ok) {
          throw new Error('Failed to fetch environments');
        }
        const data: Environment[] = await response.json();
        setEnvironments(data);

        // 从 localStorage 或 默认选择第一个
        const storedEnvId = localStorage.getItem('currentEnvironmentId');
        const initialEnv = data.find(e => e.id === storedEnvId) || data[0] || null;
        setCurrentEnvironment(initialEnv);
        if (initialEnv) setApiEnvironment(initialEnv.id);

      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchEnvironments();
  }, []);

  const handleSetCurrentEnvironment = (environment: Environment) => {
    setCurrentEnvironment(environment);
    localStorage.setItem('currentEnvironmentId', environment.id);
    setApiEnvironment(environment.id);
  };

  const value = useMemo(() => ({ environments, currentEnvironment, setCurrentEnvironment: handleSetCurrentEnvironment, loading, error }), [environments, currentEnvironment, loading, error]);

  return <EnvironmentContext.Provider value={value}>{children}</EnvironmentContext.Provider>;
};