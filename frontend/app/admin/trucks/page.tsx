'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { StatusBadge, Spinner, EmptyState, ErrorAlert, SuccessAlert, Modal, formatDate, isExpired, isExpiringSoon } from '@/components/ui/shared';

const NAV = [
  { href: '/admin', label: 'Overview', icon: '◈' },
  { href: '/admin/owners', label: 'Owners', icon: '🏢' },
  { href: '/admin/trucks', label: 'Trucks', icon: '🚛' },
  { href: '/admin/users', label: 'Drivers', icon: '👤' },
  { href: '/admin/activity', label: 'Activity Log', icon: '📋' },
];

const BLANK_FORM = {
  owner_id: '', plate_number: '', type: 'Refrigerated Semi 10T',
  capacity_tons: '10', target_temp_c: '4',
  insurance_expiry: '', permit_expiry: '', fitness_expiry: '',
};

export default function AdminTrucks() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [trucks, setTrucks] = useState<any[]>([]);
  const [owners, setOwners] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) router.replace('/login');
  }, [user, loading, router]);

  async function fetchAll() {
    setFetching(true);
    try {
      const [t, o] = await Promise.all([
        apiFetch('/api/admin/trucks'),
        apiFetch('/api/admin/owners'),
      ]);
      setTrucks(t);
      setOwners(o.filter((o: any) => o.active));
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => { if (user?.role === 'admin') fetchAll(); }, [user]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/admin/trucks', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          capacity_tons: parseFloat(form.capacity_tons),
          target_temp_c: parseFloat(form.target_temp_c),
        }),
      });
      setSuccess('Truck created successfully.');
      setShowModal(false);
      setForm(BLANK_FORM);
      fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDeactivate(id: string, plate: string) {
    if (!confirm(`Deactivate truck "${plate}"?`)) return;
    try {
      await apiFetch(`/api/admin/trucks/${id}/deactivate`, { method: 'PATCH' });
      setSuccess(`Truck "${plate}" deactivated.`);
      fetchAll();
    } catch (e: any) {
      setError(e.message);
    }
  }

  const filtered = trucks.filter(t =>
    t.plate_number.toLowerCase().includes(search.toLowerCase()) ||
    t.owner_name?.toLowerCase().includes(search.toLowerCase()) ||
    t.type.toLowerCase().includes(search.toLowerCase())
  );

  if (loading || !user) return null;

  const DocTag = ({ date }: { date: string | null }) => {
    if (!date) return <span style={{ color: 'var(--color-hairline)' }}>—</span>;
    if (isExpired(date)) return <span className="tag-expired">{formatDate(date)}</span>;
    if (isExpiringSoon(date)) return <span className="tag-expiring">{formatDate(date)}</span>;
    return <span style={{ color: 'var(--color-slate)', fontSize: 13 }}>{formatDate(date)}</span>;
  };

  return (
    <DashboardLayout navItems={NAV} title="Truck Management" roleLabel="Administrator">
      <div className="space-y-4">
        {error && <ErrorAlert message={error} />}
        {success && <SuccessAlert message={success} />}

        <div className="flex items-center gap-3">
          <input
            className="input-field max-w-xs"
            placeholder="Search by plate, owner, type…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <button className="btn-primary text-sm ml-auto" onClick={() => setShowModal(true)}>
            + Add Truck
          </button>
        </div>

        <div className="card p-0 overflow-x-auto">
          {fetching ? (
            <Spinner />
          ) : filtered.length === 0 ? (
            <EmptyState message="No trucks found." icon="🚛" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Type</th>
                  <th>Owner</th>
                  <th>Status</th>
                  <th>Temp °C</th>
                  <th>Insurance</th>
                  <th>Permit</th>
                  <th>Fitness</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id}>
                    <td className="font-mono font-semibold text-sm">{t.plate_number}</td>
                    <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>{t.type}</td>
                    <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>{t.owner_name}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="tabular-nums" style={{ color: 'var(--color-ink)' }}>{t.target_temp_c}°C</td>
                    <td><DocTag date={t.insurance_expiry} /></td>
                    <td><DocTag date={t.permit_expiry} /></td>
                    <td><DocTag date={t.fitness_expiry} /></td>
                    <td>
                      {t.active && (
                        <button className="btn-danger" onClick={() => handleDeactivate(t.id, t.plate_number)}>
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
        <Modal title="Add Truck" onClose={() => setShowModal(false)}>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                Owner <span style={{ color: 'var(--status-issue)' }}>*</span>
              </label>
              <select
                value={form.owner_id}
                onChange={e => setForm(p => ({ ...p, owner_id: e.target.value }))}
                required
                className="input-field"
              >
                <option value="">Select owner…</option>
                {owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
            {[
              { label: 'Plate Number', key: 'plate_number', placeholder: 'DL-01-AX-4821' },
              { label: 'Truck Type', key: 'type', placeholder: 'Refrigerated Semi 10T' },
              { label: 'Capacity (tons)', key: 'capacity_tons', placeholder: '10.5' },
              { label: 'Target Temp (°C)', key: 'target_temp_c', placeholder: '4.0' },
              { label: 'Insurance Expiry', key: 'insurance_expiry', type: 'date' },
              { label: 'Permit Expiry', key: 'permit_expiry', type: 'date' },
              { label: 'Fitness Expiry', key: 'fitness_expiry', type: 'date' },
            ].map(f => (
              <div key={f.key} className="space-y-1">
                <label className="block text-xs font-medium uppercase tracking-wide" style={{ color: 'var(--color-slate)' }}>
                  {f.label}
                </label>
                <input
                  type={f.type || 'text'}
                  value={form[f.key as keyof typeof form]}
                  onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="input-field"
                />
              </div>
            ))}
            {error && <ErrorAlert message={error} />}
            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary flex-1" disabled={saving}>
                {saving ? 'Creating…' : 'Add Truck'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
    </DashboardLayout>
  );
}
