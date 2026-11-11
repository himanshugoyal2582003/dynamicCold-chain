'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Spinner, EmptyState, ErrorAlert, SuccessAlert, Modal, formatDate } from '@/components/ui/shared';

const NAV = [
  { href: '/admin', label: 'Overview', icon: '◈' },
  { href: '/admin/owners', label: 'Owners', icon: '🏢' },
  { href: '/admin/trucks', label: 'Trucks', icon: '🚛' },
  { href: '/admin/users', label: 'Drivers', icon: '👤' },
  { href: '/admin/activity', label: 'Activity Log', icon: '📋' },
];

export default function AdminOwners() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [owners, setOwners] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: 'password123' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) router.replace('/login');
  }, [user, loading, router]);

  async function fetchOwners() {
    setFetching(true);
    try {
      const data = await apiFetch('/api/admin/owners');
      setOwners(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => { if (user?.role === 'admin') fetchOwners(); }, [user]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/admin/owners', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setSuccess('Owner created successfully.');
      setShowModal(false);
      setForm({ name: '', email: '', password: 'password123' });
      fetchOwners();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id: string, name: string) {
    if (!confirm(`Deactivate owner "${name}"? This will remove their access.`)) return;
    try {
      await apiFetch(`/api/admin/owners/${id}/deactivate`, { method: 'PATCH' });
      setSuccess(`Owner "${name}" deactivated.`);
      fetchOwners();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Owner Management" roleLabel="Administrator">
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}
        {success && <SuccessAlert message={success} />}

        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: 'var(--color-slate)' }}>
            {owners.length} fleet owner{owners.length !== 1 ? 's' : ''} registered
          </p>
          <button className="btn-primary text-sm" onClick={() => setShowModal(true)}>
            + Add Owner
          </button>
        </div>

        <div className="card p-0 overflow-hidden">
          {fetching ? (
            <Spinner />
          ) : owners.length === 0 ? (
            <EmptyState message="No owners found. Add your first fleet owner." icon="🏢" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Trucks</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {owners.map((o) => (
                  <tr key={o.id}>
                    <td className="font-medium">{o.name}</td>
                    <td style={{ color: 'var(--color-slate)' }}>{o.email}</td>
                    <td className="tabular-nums">{o.truck_count}</td>
                    <td style={{ color: 'var(--color-slate)' }}>{formatDate(o.created_at)}</td>
                    <td>
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase`}
                        style={o.active
                          ? { background: '#DDEEE8', color: 'var(--status-available)' }
                          : { background: '#F9E0E1', color: 'var(--status-issue)' }
                        }
                      >
                        {o.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      {o.active && (
                        <button
                          className="btn-danger"
                          onClick={() => handleDeactivate(o.id, o.name)}
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {showModal && (
        <Modal title="Add Fleet Owner" onClose={() => setShowModal(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            {[
              { label: 'Full Name / Company', key: 'name', type: 'text', placeholder: 'Bespoke Reefer Logistics' },
              { label: 'Email Address', key: 'email', type: 'email', placeholder: 'owner@elitecold.com' },
              { label: 'Initial Password', key: 'password', type: 'text', placeholder: 'password123' },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                  {f.label} <span style={{ color: 'var(--status-issue)' }}>*</span>
                </label>
                <input
                  type={f.type}
                  value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  required
                  className="input-field"
                />
              </div>
            ))}
            {error && <ErrorAlert message={error} />}
            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary flex-1" disabled={saving}>
                {saving ? 'Creating…' : 'Add Owner'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setShowModal(false)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </DashboardLayout>
  );
}
