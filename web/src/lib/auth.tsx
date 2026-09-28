import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, clearImageCache, setUnauthorizedHandler, tokenStore } from './api';

export interface Me {
  id: string; name: string; email: string; role: string; roleLabel: string; title?: string; permissions: string[]; branchIds: string[];
  tenant: { id: string; name: string; slug: string; planId: string; branding: { accent?: string; displayName?: string; logoText?: string }; onboarding: Record<string, boolean> } | null;
}
interface AuthCtx { me: Me | null; ready: boolean; login: (email: string, password: string) => Promise<Me>; logout: () => void; can: (p: string) => boolean }
const Ctx = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [ready, setReady] = useState(false);
  const logout = useCallback(() => { tokenStore.set(null); clearImageCache(); setMe(null); }, []);
  useEffect(() => {
    setUnauthorizedHandler(logout);
    if (!tokenStore.get()) { setReady(true); return; }
    api<Me>('/auth/me').then(setMe).catch(() => tokenStore.set(null)).finally(() => setReady(true));
  }, [logout]);
  const login = useCallback(async (email: string, password: string) => {
    const r = await api<{ token: string; user: Me }>('/auth/login', { body: { email, password } });
    tokenStore.set(r.token);
    setMe(r.user);
    return r.user;
  }, []);
  const can = useCallback((p: string) => !!me?.permissions.includes(p), [me]);
  return <Ctx.Provider value={{ me, ready, login, logout, can }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
