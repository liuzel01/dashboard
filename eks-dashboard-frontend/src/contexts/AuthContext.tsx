import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { getMe, login as loginApi, setAuthToken } from '../services/api';
import { AuthContext } from './AuthContextValue';

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

export type AuthLoginResponse = {
  token?: string;
  user?: AuthUser;
  mfaRequired?: boolean;
  mfaSetupRequired?: boolean;
  username?: string;
  secret?: string;
  qrCodeDataUrl?: string;
  otpauthUrl?: string;
  message?: string;
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [me, setMe] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const authRequestSequence = useRef(0);

  const fetchMe = useCallback(async () => {
    const requestSequence = ++authRequestSequence.current;
    setLoading(true);
    setError(null);
    try {
      const data = await getMe();
      if (requestSequence !== authRequestSequence.current) return;
      setMe(data);
      setError(null);
    } catch (err: unknown) {
      if (requestSequence !== authRequestSequence.current) return;
      const status = (err as ApiError)?.response?.status;
      if (status === 401) {
        setMe(null);
        setError(null);
      } else {
        setError((err as ApiError)?.message || '加载用户信息失败');
        setMe(null);
      }
    } finally {
      if (requestSequence === authRequestSequence.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const storedToken = localStorage.getItem('authToken');
    if (storedToken) {
      setAuthToken(storedToken);
      fetchMe();
    } else {
      setLoading(false);
    }
  }, [fetchMe]);

  const login = useCallback(async (username: string, password: string, otpCode?: string) => {
    // Invalidate a bootstrap /me request that may still be in flight while the
    // user submits the login form. Its failure must not overwrite a successful login.
    authRequestSequence.current += 1;
    setLoading(false);
    setError(null);
    const resp = await loginApi({ username, password, otpCode });
    const token = resp?.token as string | undefined;
    if (!token) {
      return resp;
    }
    localStorage.setItem('authToken', token);
    setAuthToken(token);
    if (resp?.user) {
      setMe(resp.user);
      setError(null);
      setLoading(false);
    } else {
      await fetchMe();
    }
    return resp as AuthLoginResponse;
  }, [fetchMe]);

  const applyToken = useCallback(async (token: string) => {
    localStorage.setItem('authToken', token);
    setAuthToken(token);
    setError(null);
    await fetchMe();
  }, [fetchMe]);

  const logout = useCallback(() => {
    authRequestSequence.current += 1;
    localStorage.removeItem('authToken');
    setAuthToken(null);
    setMe(null);
    setError(null);
    setLoading(false);
  }, []);

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
    [me, loading, error, fetchMe, login, applyToken, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
