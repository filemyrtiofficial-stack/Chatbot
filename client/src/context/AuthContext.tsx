import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { api, clearAuthRefresh, registerAuthRefresh, resolveApiUrl } from '../api';

export type User = { id: number; name: string; email: string; pictureUrl?: string | null } | null;

type AuthContextType = {
  user: User;
  initializing: boolean;
  login: (user: User) => void;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

async function fetchSession() {
  try {
    const data = await api<{ user: User }>('/api/auth/me');
    return data.user;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      const sessionUser = await fetchSession();
      if (mounted) {
        setUser(sessionUser);
        setInitializing(false);
      }
    }
    bootstrap();
    return () => {
      mounted = false;
      clearAuthRefresh();
    };
  }, []);

  useEffect(() => {
    async function refreshSession() {
      try {
        const res = await fetch(resolveApiUrl('/api/auth/refresh'), {
          method: 'POST',
          credentials: 'include',
        });
        if (!res.ok) {
          setUser(null);
          return false;
        }
        const data = await res.json();
        setUser(data.user ?? null);
        return true;
      } catch {
        setUser(null);
        return false;
      }
    }

    registerAuthRefresh(refreshSession);
  }, []);

  const login = (u: User) => {
    setUser(u);
  };

  const logout = async () => {
    try {
      await fetch(resolveApiUrl('/api/auth/logout'), {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore network errors; cookies will clear server-side when possible
    } finally {
      setUser(null);
    }
  };

  const value = useMemo(
    () => ({
      user,
      initializing,
      login,
      logout,
    }),
    [user, initializing]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
