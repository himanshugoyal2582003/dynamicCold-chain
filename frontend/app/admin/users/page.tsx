'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { AvailableOwner, getAvailableOwners } from '@/lib/owners';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Spinner, EmptyState, ErrorAlert, SuccessAlert, Modal, formatDate } from '@/components/ui/shared';

const NAV = [
  { href: '/admin', label: 'Overview', icon: '◈' },
  { href: '/admin/tracking', label: 'Global Map', icon: '📍' },
  { href: '/admin/trips', label: 'Trips', icon: '🛣️' },
  { href: '/admin/owners', label: 'Owners', icon: '🏢' },
  { href: '/admin/trucks', label: 'Trucks', icon: '🚛' },
  { href: '/admin/users', label: 'Drivers', icon: '👤' },
  { href: '/admin/activity', label: 'Activity Log', icon: '📋' },
];

export default function AdminUsers() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [users, setUsers] = useState<any[]>([]);
  const [owners, setOwners] = useState<AvailableOwner[]>([]);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const [ownerError, setOwnerError] = useState('');
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: 'password123', owner_id: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) router.replace('/login');
  }, [user, loading, router]);

  async function fetchAll() {
    setFetching(true);
    try {
      const u = await apiFetch('/api/admin/users');
      setUsers(u);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => { if (user?.role === 'admin') fetchAll(); }, [user]);

  // Load owner records on each modal open. Keep this separate from the driver
  // table request so a failure loading drivers cannot leave owner options blank.
  useEffect(() => {
    if (!showModal) return;
    let active = true;
    setOwners([]);
    setOwnerError('');
    setLoadingOwners(true);
    getAvailableOwners()
      .then((rows) => { if (active) setOwners(rows); })
      .catch((e: any) => {
        if (active) setOwnerError(e?.message || 'Could not load registered owners.');
      })
      .finally(() => { if (active) setLoadingOwners(false); });
    return () => { active = false; };
  }, [showModal]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/admin/users', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setSuccess('Driver created successfully.');
      setShowModal(false);
      setForm({ name: '', email: '', password: 'password123', owner_id: '' });
      await fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id: string, name: string) {
    if (!confirm(`Deactivate driver "${name}"?`)) return;
    try {
      await apiFetch(`/api/admin/users/${id}/deactivate`, { method: 'PATCH' });
      setSuccess(`Driver "${name}" deactivated.`);
      fetchAll();
    } catch (e: any) {
      setError(e.message);
    }
  }

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Driver Management" roleLabel="Administrator">
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}
        {success && <SuccessAlert message={success} />}

        <div className="flex items-center justify-between">
          <p className="text-sm" style={{ color: 'var(--color-slate)' }}>
            {users.length} truck driver{users.length !== 1 ? 's' : ''} registered
          </p>
          <button className="btn-primary text-sm" onClick={() => { setForm({ name: '', email: '', password: 'password123', owner_id: '' }); setShowModal(true); }}>
            + Add Driver
          </button>
        </div>

        <div className="card p-0 overflow-x-auto">
          {fetching ? <Spinner /> : users.length === 0 ? (
            <EmptyState message="No drivers found. Add your first driver." icon="👤" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Owner</th>
                  <th>Assigned Truck</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.id}>
                    <td className="font-medium">{u.name}</td>
                    <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>{u.email}</td>
                    <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>{u.owner_name || '—'}</td>
                    <td className="font-mono text-xs">{u.truck_plate || '—'}</td>
                    <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>{formatDate(u.created_at)}</td>
                    <td>
                      <span
                        className="inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase"
                        style={u.active
                          ? { background: '#DDEEE8', color: 'var(--status-available)' }
                          : { background: '#F9E0E1', color: 'var(--status-issue)' }
                        }
                      >
                        {u.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      {u.active && (
                        <button className="btn-danger" onClick={() => handleDeactivate(u.id, u.name)}>
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
        <Modal title="Add Driver" onClose={() => setShowModal(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            {[
              { label: 'Full Name', key: 'name', type: 'text', placeholder: 'Marcus Vance' },
              { label: 'Email Address', key: 'email', type: 'email', placeholder: 'driver@elitecold.com' },
              { label: 'Initial Password', key: 'password', type: 'text', placeholder: 'password123' },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                  {f.label} <span style={{ color: 'var(--status-issue)' }}>*</span>
                </label>
                <input
                  type={f.type}
                  value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  required
                  className="input-field"
                />
              </div>
            ))}
            <div className="space-y-1">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                Assign to Owner <span style={{ color: 'var(--status-issue)' }}>*</span>
              </label>
              <select
                value={form.owner_id}
                onChange={e => setForm(p => ({ ...p, owner_id: e.target.value }))}
                required disabled={loadingOwners || !!ownerError || owners.length === 0}
                className="input-field"
              >
                <option value="">{loadingOwners ? 'Loading owners…' : ownerError ? 'Owners could not be loaded' : owners.length ? 'Select owner…' : 'No registered owners found'}</option>
                {owners.map(o => <option key={o.id} value={o.id}>{o.name} ({o.email})</option>)}
              </select>
              {loadingOwners && <p className="text-xs text-slate-400" role="status">Loading registered owners…</p>}
              {ownerError && <p className="text-xs text-red-600" role="alert">{ownerError}</p>}
            </div>
            {error && <ErrorAlert message={error} />}
            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary flex-1" disabled={saving || loadingOwners || !!ownerError || owners.length === 0 || !form.owner_id}>
                {saving ? 'Creating…' : 'Add Driver'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </DashboardLayout>
  );
}
