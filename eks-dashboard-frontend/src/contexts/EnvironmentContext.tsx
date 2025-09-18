import React, { createContext, useState, useEffect, useMemo } from 'react';
import type { ReactNode } from 'react';
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
      setLoading(true);
      setError(null);
      try {
        // Step 1: Fetch the configuration to determine the API base URL.
        const configResponse = await fetch('/environment.json');
        if (!configResponse.ok) {
          throw new Error('Could not load /environment.json. Please ensure it exists in the public folder.');
        }
        const config = await configResponse.json();
        const apiBaseUrl = config.API_BASE_URL;

        if (!apiBaseUrl) {
          throw new Error('API_BASE_URL not found in /environment.json');
        }

        // Step 2: Use the base URL to fetch the list of environments.
        const response = await fetch(`${apiBaseUrl}/environments`);
        if (!response.ok) {
          throw new Error('Failed to fetch environments');
        }
        const data: Environment[] = await response.json();
        setEnvironments(data);

        // Step 3: Set the initial environment from localStorage or default to the first one.
        const storedEnvId = localStorage.getItem('currentEnvironmentId');
        const initialEnv = data.find(e => e.id === storedEnvId) || data[0] || null;
        if (initialEnv) {
          // Use the handler which also updates localStorage and the API service
          handleSetCurrentEnvironment(initialEnv);
        }
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