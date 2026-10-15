import type { LoginResponse, Permission, SessionUser } from '@app/shared';
import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, refreshSession, session } from './api';

type Status = 'loading' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  status: Status;
  user: SessionUser | null;
  login: (email: string, password: string) => Promise<SessionUser>;
  completeLogin: (res: LoginResponse) => void;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
  serverSlow: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [serverSlow, setServerSlow] = useState(false);
  const queryClient = useQueryClient();

  const reset = useCallback(() => {
    session.setToken(null);
    setUser(null);
    setStatus('anonymous');
    queryClient.clear();
  }, [queryClient]);

  // Restore the session from the httpOnly refresh cookie on first load.
  useEffect(() => {
    session.onEnded(reset);
    session.onSlow(setServerSlow);
    refreshSession()
      .then((res) => {
        if (res) {
          setUser(res.user);
          setStatus('authenticated');
        } else setStatus('anonymous');
      })
      .catch(() => setStatus('anonymous'));
  }, [reset]);

  const completeLogin = useCallback((res: LoginResponse) => {
    session.setToken(res.accessToken);
    setUser(res.user);
    setStatus('authenticated');
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<LoginResponse>('/auth/login', { email, password });
      completeLogin(res);
      return res.user;
    },
    [completeLogin],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      reset();
    }
  }, [reset]);

  const value = useMemo<AuthContextValue>(
    () => ({ status, user, login, completeLogin, logout, can: (p) => !!user?.permissions.includes(p), serverSlow }),
    [status, user, login, completeLogin, logout, serverSlow],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
