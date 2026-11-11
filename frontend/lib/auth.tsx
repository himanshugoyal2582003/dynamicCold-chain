'use client';

import { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

// Inactivity timeout: 15 minutes of idle time
const IDLE_TIMEOUT_MS = 15 * 60 * 1000;
const IDLE_WARNING_MS = 60 * 1000; // Warning shown 60s before auto-logout

export interface User {
  sub: string;
  email: string;
  role: 'admin' | 'owner' | 'truckUser';
  name: string;
  truckId?: string | null;
  ownerId?: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: (reason?: string | any) => Promise<void>;
  refetch: () => Promise<void>;
  idleWarning: boolean;
  resetIdleTimer: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [idleWarning, setIdleWarning] = useState(false);
  const router = useRouter();
  const pathname = usePathname();

  const lastActivityRef = useRef<number>(Date.now());
  const logoutTimerRef = useRef<NodeJS.Timeout | null>(null);
  const warningTimerRef = useRef<NodeJS.Timeout | null>(null);

  const logout = useCallback(async (reason?: string | any) => {
    try {
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('coldchain_jwt') : null;
      await fetch(`${API}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          ...(storedToken ? { Authorization: `Bearer ${storedToken}`, 'x-auth-token': storedToken } : {}),
        },
      });
    } catch {
      // Ignore network errors on logout
    }
    if (typeof window !== 'undefined') {
      localStorage.removeItem('coldchain_jwt');
    }
    setUser(null);
    setIdleWarning(false);
    const redirectReason = typeof reason === 'string' ? reason : null;
    const redirectUrl = redirectReason ? `/login?reason=${encodeURIComponent(redirectReason)}` : '/login';
    router.push(redirectUrl);
  }, [router]);

  const resetIdleTimer = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (idleWarning) setIdleWarning(false);

    if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current);

    if (user) {
      // Set warning timer
      warningTimerRef.current = setTimeout(() => {
        setIdleWarning(true);
      }, IDLE_TIMEOUT_MS - IDLE_WARNING_MS);

      // Set auto-logout timer
      logoutTimerRef.current = setTimeout(() => {
        logout('idle');
      }, IDLE_TIMEOUT_MS);
    }
  }, [user, idleWarning, logout]);

  // Activity listeners for idle detection
  useEffect(() => {
    if (!user) return;

    const events = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click'];
    const handleActivity = () => {
      // Debounce activity resets to every 1.5 seconds
      if (Date.now() - lastActivityRef.current > 1500) {
        resetIdleTimer();
      }
    };

    resetIdleTimer();
    events.forEach((evt) => window.addEventListener(evt, handleActivity, { passive: true }));

    return () => {
      events.forEach((evt) => window.removeEventListener(evt, handleActivity));
      if (logoutTimerRef.current) clearTimeout(logoutTimerRef.current);
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current);
    };
  }, [user, resetIdleTimer]);

  // Fetch initial profile
  async function fetchMe() {
    try {
      const storedToken = typeof window !== 'undefined' ? localStorage.getItem('coldchain_jwt') : null;
      const res = await fetch(`${API}/api/auth/me`, {
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          ...(storedToken ? { Authorization: `Bearer ${storedToken}`, 'x-auth-token': storedToken } : {}),
        },
      });
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchMe();
  }, []);

  // Strict Client-Side Route & Role Enforcer
  useEffect(() => {
    if (loading) return;

    const publicRoutes = ['/', '/login'];
    const isPublic = publicRoutes.includes(pathname);

    if (!user && !isPublic) {
      router.replace('/login?reason=unauthorized');
      return;
    }

    if (user) {
      // Role scoping: prevent unauthorized cross-tenant route hopping
      if (pathname.startsWith('/admin') && user.role !== 'admin') {
        router.replace(user.role === 'owner' ? '/owner' : '/truck');
      } else if (pathname.startsWith('/owner') && user.role !== 'owner') {
        router.replace(user.role === 'admin' ? '/admin' : '/truck');
      } else if (pathname.startsWith('/truck') && user.role !== 'truckUser') {
        router.replace(user.role === 'admin' ? '/admin' : '/owner');
      }
    }
  }, [user, loading, pathname, router]);

  async function login(email: string, password: string) {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ message: 'Sign in failed' }));
      throw new Error(err.message || 'Login failed');
    }

    const data = await res.json();
    if (data.token && typeof window !== 'undefined') {
      localStorage.setItem('coldchain_jwt', data.token);
    }
    setUser(data.user);
    lastActivityRef.current = Date.now();

    const roleRoute = { admin: '/admin', owner: '/owner', truckUser: '/truck' };
    router.push(roleRoute[data.user.role] || '/');
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        logout,
        refetch: fetchMe,
        idleWarning,
        resetIdleTimer,
      }}
    >
      {/* Idle Session Warning Toast */}
      {idleWarning && user && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 99999,
            background: '#14171C',
            color: '#FFFFFF',
            border: '1px solid #B08D3C',
            borderRadius: 8,
            padding: '16px 20px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
            maxWidth: 380,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <span style={{ fontSize: 20 }}>⏳</span>
            <div>
              <p style={{ fontWeight: 600, fontSize: 14, margin: '0 0 4px', color: '#B08D3C' }}>
                Inactivity Warning
              </p>
              <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.7)', margin: 0 }}>
                You have been idle. For security, your session will automatically lock in 60 seconds.
              </p>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button
                  onClick={resetIdleTimer}
                  style={{
                    background: '#B08D3C',
                    color: '#14171C',
                    border: 0,
                    fontWeight: 700,
                    fontSize: 12,
                    padding: '6px 12px',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Stay Signed In
                </button>
                <button
                  onClick={() => logout('manual')}
                  style={{
                    background: 'transparent',
                    color: 'rgba(255,255,255,0.6)',
                    border: '1px solid rgba(255,255,255,0.2)',
                    fontSize: 12,
                    padding: '6px 12px',
                    borderRadius: 4,
                    cursor: 'pointer',
                  }}
                >
                  Sign Out
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}

export async function apiFetch(path: string, options?: RequestInit) {
  const storedToken = typeof window !== 'undefined' ? localStorage.getItem('coldchain_jwt') : null;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(storedToken ? { Authorization: `Bearer ${storedToken}`, 'x-auth-token': storedToken } : {}),
    ...((options?.headers as Record<string, string>) || {}),
  };

  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    ...options,
    headers,
  });

  if (res.status === 401) {
    if (typeof window !== 'undefined') {
      localStorage.removeItem('coldchain_jwt');
      window.location.href = '/login?reason=unauthorized';
    }
    throw new Error('Authentication required. Session expired.');
  }

  if (res.status === 403) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.message || 'Access Denied: You do not have permission to access this resource.');
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(err.message || `Error ${res.status}`);
  }

  return res.json();
}
