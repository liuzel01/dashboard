import React, { createContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getMe, login as loginApi, setAuthToken } from '../services/api';

export type AuthRole = {
  id: number;
  name: string;
};

export type AuthUser = {
  id: number | null;
  username: string;
  status?: string | null;
  roles: AuthRole[];
  permissions: string[];
  identity?: {
    source?: 'local' | 'keycloak' | string;
    username?: string;
    display_name?: string;
    email?: string | null;
  };
  bootstrap?: boolean;
};

interface AuthContextType {
  me: AuthUser | null;
  permissions: string[];
  isAuthenticated: boolean;
  loading: boolean;
  error: string | null;
  refreshMe: () => Promise<void>;
  login: (username: string, password: string, otpCode?: string) => Promise<any>;
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
  login: async () => {},
  applyToken: async () => {},
  logout: () => {},
});

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [me, setMe] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMe = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getMe();
      setMe(data);
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401) {
        setMe(null);
        setError(null);
      } else {
        setError(err?.message || '加载用户信息失败');
        setMe(null);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const storedToken = localStorage.getItem('authToken');
    if (storedToken) {
      setAuthToken(storedToken);
      fetchMe();
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (username: string, password: string, otpCode?: string) => {
    const resp = await loginApi({ username, password, otpCode });
    const token = resp?.token as string | undefined;
    if (!token) {
      return resp;
    }
    localStorage.setItem('authToken', token);
    setAuthToken(token);
    await fetchMe();
    return resp;
  };

  const applyToken = async (token: string) => {
    localStorage.setItem('authToken', token);
    setAuthToken(token);
    await fetchMe();
  };

  const logout = () => {
    localStorage.removeItem('authToken');
    setAuthToken(null);
    setMe(null);
  };

  const value = useMemo(
    () => ({
      me,
      permissions: me?.permissions || [],
      isAuthenticated: !!me,
      loading,
      error,
      refreshMe: fetchMe,
      login,
      applyToken,
      logout,
    }),
    [me, loading, error],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
