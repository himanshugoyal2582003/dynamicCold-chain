'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { ErrorAlert } from '@/components/ui/shared';

export default function SignupPage() {
  const router = useRouter();
  const { refetch } = useAuth();
  const [role, setRole] = useState<'owner' | 'admin'>('owner');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(`${API}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, email, password, role }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || 'Registration failed');
      }

      if (data.token && typeof window !== 'undefined') {
        localStorage.setItem('coldchain_jwt', data.token);
      }

      await refetch();
      router.push(role === 'admin' ? '/admin' : '/owner');
    } catch (err: any) {
      setError(err.message || 'Registration failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col md:flex-row" style={{ background: 'var(--color-paper)' }}>
      {/* Left panel — Brand Story */}
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
            Join the elite fleet <br />
            <em>intelligence network.</em>
          </h2>
          <p className="text-sm leading-relaxed" style={{ color: 'rgba(255,255,255,0.55)', maxWidth: '28ch' }}>
            Empower your cold-chain logistics with real-time IoT ingestion, AI shelf-life forecasting, and dynamic risk management.
          </p>
        </div>

        <div className="p-4 rounded border border-white/10 bg-white/5 text-xs text-slate-300">
          <p className="font-semibold text-amber-400 mb-1">Driver Provisioning Policy</p>
          <p>
            Drivers cannot self-register publicly. Driver accounts are issued and managed strictly by authorized Fleet Owners or Company Admins.
          </p>
        </div>
      </div>

      {/* Right panel — Registration Form */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          {/* Mobile logo */}
          <div className="flex items-center gap-2 mb-8 md:hidden">
            <div className="w-3 h-3 rounded-sm" style={{ background: 'var(--color-gold)' }} />
            <span className="text-xs font-semibold tracking-widest uppercase">COLDCHAIN</span>
          </div>

          <h1 className="text-2xl font-semibold mb-1" style={{ color: 'var(--color-ink)' }}>
            Create an Account
          </h1>
          <p className="text-sm mb-6" style={{ color: 'var(--color-slate)' }}>
            Register as a Fleet Owner or Company Admin.
          </p>

          {error && (
            <div className="mb-4">
              <ErrorAlert message={error} />
            </div>
          )}

          {/* Role selector tabs */}
          <div className="flex gap-2 p-1 rounded mb-5" style={{ background: 'var(--color-ivory)' }}>
            <button
              type="button"
              className={`flex-1 py-2 text-xs font-semibold rounded transition-colors ${
                role === 'owner' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'
              }`}
              onClick={() => setRole('owner')}
            >
              🚛 Fleet Owner
            </button>
            <button
              type="button"
              className={`flex-1 py-2 text-xs font-semibold rounded transition-colors ${
                role === 'admin' ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'
              }`}
              onClick={() => setRole('admin')}
            >
              🛡️ Company Admin
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                Full Name / Organization
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={role === 'owner' ? 'Apex Cold Logistics' : 'Alexander Wright'}
                required
                className="input-field"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                Work Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="operator@elitecold.com"
                required
                className="input-field"
                autoComplete="email"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                Password (min 6 characters)
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                required
                minLength={6}
                className="input-field"
                autoComplete="new-password"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="btn-primary w-full py-3 text-sm mt-2"
            >
              {submitting ? 'Creating account…' : `Sign Up as ${role === 'owner' ? 'Fleet Owner' : 'Company Admin'}`}
            </button>
          </form>

          <p className="text-xs text-center mt-6" style={{ color: 'var(--color-slate)' }}>
            Already have an account?{' '}
            <Link href="/login" className="font-semibold text-slate-800 hover:underline">
              Sign in →
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}

