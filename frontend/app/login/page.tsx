'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { ErrorAlert } from '@/components/ui/shared';

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [sessionNotice, setSessionNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const reason = params.get('reason');
      if (reason === 'idle') {
        setSessionNotice('⚠️ You were automatically signed out due to inactivity to protect fleet data.');
      } else if (reason === 'unauthorized') {
        setSessionNotice('🔒 Protected Route: Authentication required. Please sign in.');
      }
    }
  }, []);

  useEffect(() => {
    if (!loading && user) {
      const routes = { admin: '/admin', owner: '/owner', truckUser: '/truck' };
      router.replace(routes[user.role] || '/');
    }
  }, [user, loading, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.message || 'Login failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return null;

  return (
    <main className="min-h-screen flex flex-col md:flex-row" style={{ background: 'var(--color-paper)' }}>
      {/* Left panel — Decorative */}
      <div
        className="hidden md:flex flex-col justify-between p-12 w-2/5"
        style={{ background: 'var(--color-ink)', color: 'var(--color-paper)' }}
      >
        <div>
          <div className="flex items-center gap-2 mb-12">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-gold)' }} />
            <span className="text-xs font-semibold tracking-widest uppercase">COLDCHAIN</span>
          </div>
          <h2
            className="font-serif-display leading-tight mb-4"
            style={{ fontSize: '2.5rem', fontWeight: 300, color: 'var(--color-paper)' }}
          >
            Precision logistics <br />
            <em>at every degree.</em>
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)', maxWidth: '28ch' }}>
            Trusted by elite cold-chain operators to manage refrigerated fleets with integrity.
          </p>
        </div>

        {/* Demo credentials */}
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-widest mb-3" style={{ color: 'rgba(255,255,255,0.35)' }}>
            Demo Accounts
          </p>
          {[
            { role: 'Admin', email: 'admin@elitecold.com' },
            { role: 'Owner', email: 'owner1@elitecold.com' },
            { role: 'Driver', email: 'driver1@elitecold.com' },
          ].map((d) => (
            <button
              key={d.email}
              onClick={() => { setEmail(d.email); setPassword('password123'); }}
              className="w-full text-left p-3 rounded text-xs transition-colors"
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: 'rgba(255,255,255,0.7)',
              }}
            >
              <span className="block font-semibold" style={{ color: 'var(--color-gold)' }}>{d.role}</span>
              <span>{d.email}</span>
            </button>
          ))}
          <p className="text-xs" style={{ color: 'rgba(255,255,255,0.3)' }}>Password: password123</p>
        </div>
      </div>

      {/* Right panel — Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 md:hidden">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-gold)' }} />
            <span className="text-xs font-semibold tracking-widest uppercase">COLDCHAIN</span>
          </div>

          <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--color-ink)' }}>
            Sign in to Portal
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--color-slate)' }}>
            Access your fleet management dashboard.
          </p>

          {sessionNotice && (
            <div
              className="mb-4 p-3 rounded text-xs border"
              style={{
                background: '#FEF3D6',
                borderColor: '#C9962B',
                color: '#8A5800',
              }}
            >
              {sessionNotice}
            </div>
          )}

          {error && (
            <div className="mb-4">
              <ErrorAlert message={error} />
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@elitecold.com"
                required
                className="input-field"
                autoComplete="email"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                Password
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                className="input-field"
                autoComplete="current-password"
              />
            </div>

            {error && <ErrorAlert message={error} />}

            <button type="submit" className="btn-primary w-full mt-2" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Mobile demo accounts */}
          <div className="mt-8 md:hidden">
            <p className="text-xs mb-2" style={{ color: 'var(--color-slate)' }}>Quick demo fill:</p>
            <div className="flex gap-2 flex-wrap">
              {[
                { role: 'Admin', email: 'admin@elitecold.com' },
                { role: 'Owner', email: 'owner1@elitecold.com' },
                { role: 'Driver', email: 'driver1@elitecold.com' },
              ].map((d) => (
                <button
                  key={d.email}
                  onClick={() => { setEmail(d.email); setPassword('password123'); }}
                  className="btn-ghost text-xs"
                  style={{ fontSize: '11px' }}
                >
                  {d.role}
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs mt-8" style={{ color: 'var(--color-hairline)' }}>
            GLA University · Elite Avengers · Phase 1 · 2026
          </p>
        </div>
      </div>
    </main>
  );
}
