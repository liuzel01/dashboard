import { createContext } from 'react';

export interface Environment {
  id: string;
  name: string;
}

export interface EnvironmentContextType {
  environments: Environment[];
  currentEnvironment: Environment | null;
  setCurrentEnvironment: (environment: Environment) => void;
  refreshEnvironments: () => Promise<void>;
  loading: boolean;
  error: string | null;
}

export const EnvironmentContext = createContext<EnvironmentContextType>({
  environments: [],
  currentEnvironment: null,
  setCurrentEnvironment: () => {},
  refreshEnvironments: async () => {},
  loading: true,
  error: null,
});
