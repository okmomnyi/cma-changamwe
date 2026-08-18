'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { fetchMe, refreshSession, signIn as apiSignIn, signOut as apiSignOut, setAccessToken, type SessionUser } from './api';
interface AuthState {
    user: SessionUser | null;
    loading: boolean;
    signIn: (identifier: string, password: string) => Promise<SessionUser>;
    signOut: () => Promise<void>;
    refresh: () => Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: {
    children: React.ReactNode;
}) {
    const [user, setUser] = useState<SessionUser | null>(null);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                if (await refreshSession()) {
                    const me = await fetchMe();
                    if (!cancelled)
                        setUser(me);
                }
            }
            catch {
                if (!cancelled)
                    setUser(null);
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);
    const signIn = useCallback(async (identifier: string, password: string) => {
        const signedIn = await apiSignIn(identifier, password);
        setUser(signedIn);
        return signedIn;
    }, []);
    const signOut = useCallback(async () => {
        await apiSignOut();
        setAccessToken(null);
        setUser(null);
    }, []);
    const refresh = useCallback(async () => {
        try {
            setUser(await fetchMe());
        }
        catch {
            setUser(null);
        }
    }, []);
    const value = useMemo(() => ({ user, loading, signIn, signOut, refresh }), [user, loading, signIn, signOut, refresh]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export function useAuth(): AuthState {
    const ctx = useContext(AuthContext);
    if (!ctx)
        throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
}
