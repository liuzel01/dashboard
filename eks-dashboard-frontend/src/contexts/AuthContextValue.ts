import { createContext } from 'react';
import type { AuthLoginResponse, AuthUser } from './AuthContext';

export interface AuthContextType {
  me: AuthUser | null;
  permissions: string[];
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  refreshMe: () => Promise<void>;
  login: (username: string, password: string, otpCode?: string) => Promise<AuthLoginResponse>;
  applyToken: (token: string) => Promise<void>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType>({
  me: null,
  permissions: [],
  isAuthenticated: false,
  loading: true,
  error: null,
  refreshMe: async () => {},
  login: async () => ({}),
  applyToken: async () => {},
  logout: () => {},
});
