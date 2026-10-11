import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import * as api from './api';

interface AuthValue {
  user: api.AdminUser | null;
  ready: boolean;
  signIn: (email: string, password: string, code?: string) => Promise<void>;
  /** After authenticator setup, which signs in by itself. */
  signedIn: (user: api.AdminUser) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<api.AdminUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.setExpiredHandler(() => setUser(null));
    api.restore().then(setUser).finally(() => setReady(true));
    return () => api.setExpiredHandler(null);
  }, []);

  const signIn = useCallback(async (email: string, password: string, code?: string) => {
    setUser(await api.login(email.trim(), password, code?.replace(/\s/g, '') || undefined));
  }, []);
  const signedIn = useCallback((u: api.AdminUser) => setUser(u), []);
  const signOut = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, ready, signIn, signedIn, signOut }), [user, ready, signIn, signedIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
