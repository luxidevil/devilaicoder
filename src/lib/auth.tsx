import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { apiJson, setAuthToken } from './supabase';

export interface AuthUser {
  id: string;
  email: string;
  display_name: string;
  is_admin: boolean;
  subscription_tier: string;
  credit_balance: number;
  total_purchased: number;
  created_at: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  authDisabled: boolean;
  signUp: (email: string, password: string, displayName: string) => Promise<{ error: string | null }>;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [authDisabled, setAuthDisabled] = useState(false);

  useEffect(() => {
    apiJson<{ user: AuthUser; auth_disabled?: boolean }>('/auth/me')
      .then((data) => {
        setUser(data.user);
        setAuthDisabled(!!data.auth_disabled);
      })
      .catch(() => {
        setAuthToken(null);
        setUser(null);
        setAuthDisabled(false);
      })
      .finally(() => setLoading(false));
  }, []);

  const signUp = async (email: string, password: string, displayName: string) => {
    if (authDisabled) {
      return { error: 'Authentication is disabled in this deployment.' };
    }
    try {
      await apiJson('/auth/signup', {
        method: 'POST',
        body: JSON.stringify({ email, password, displayName }),
      });
      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Sign up failed' };
    }
  };

  const signIn = async (email: string, password: string) => {
    if (authDisabled) {
      return { error: 'Authentication is disabled in this deployment.' };
    }
    try {
      const data = await apiJson<{ token: string; user: AuthUser }>('/auth/signin', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      setAuthToken(data.token);
      setUser(data.user);
      return { error: null };
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Sign in failed' };
    }
  };

  const signOut = async () => {
    if (authDisabled) return;
    setAuthToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, authDisabled, signUp, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
