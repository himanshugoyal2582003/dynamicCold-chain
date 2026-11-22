'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { Spinner, EmptyState, ErrorAlert, SuccessAlert, Modal } from '@/components/ui/shared';

const NAV = [
  { href: '/owner/trips', label: 'Trip Management', icon: '🛣️' },
  { href: '/owner', label: 'My Fleet', icon: '🚛' },
  { href: '/owner/tracking', label: 'Live Tracking', icon: '📍' },
  { href: '/owner/drivers', label: 'Drivers', icon: '👤' },
];

export default function OwnerDrivers() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [drivers, setDrivers] = useState<any[]>([]);
  const [trucks, setTrucks] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add Driver Modal
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [driverName, setDriverName] = useState('');
  const [driverEmail, setDriverEmail] = useState('');
  const [driverPassword, setDriverPassword] = useState('');
  const [assignedTruckId, setAssignedTruckId] = useState('');
  const [savingDriver, setSavingDriver] = useState(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'owner')) router.replace('/login');
  }, [user, loading, router]);

  async function loadData() {
    setFetching(true);
    setError('');
    try {
      const [dList, tList] = await Promise.all([
        apiFetch('/api/owner/drivers'),
        apiFetch('/api/owner/trucks'),
      ]);
      if (!Array.isArray(dList)) throw new Error('GET /api/owner/drivers returned an invalid driver response.');
      if (!Array.isArray(tList)) throw new Error('GET /api/owner/trucks returned an invalid truck response.');
      setDrivers(dList);
      setTrucks(tList);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    if (user?.role === 'owner') {
      loadData();
    }
  }, [user]);

  async function handleCreateDriver(e: React.FormEvent) {
    e.preventDefault();
    setSavingDriver(true);
    setError('');
    try {
      await apiFetch('/api/owner/drivers', {
        method: 'POST',
        body: JSON.stringify({
          name: driverName.trim(),
          email: driverEmail.trim().toLowerCase(),
          password: driverPassword || undefined,
          truckId: assignedTruckId || undefined,
        }),
      });
      setSuccess(`Driver account for "${driverName}" created successfully.`);
      setShowAddDriver(false);
      setDriverName('');
      setDriverEmail('');
      setDriverPassword('');
      setAssignedTruckId('');
      loadData();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSavingDriver(false);
    }
  }

  if (loading || !user) return null;

  return (
    <DashboardLayout navItems={NAV} title="Fleet Drivers Management" roleLabel="Fleet Owner">
      <div className="space-y-6">
        {error && <ErrorAlert message={error} />}
        {success && <SuccessAlert message={success} />}

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white">Authorized Fleet Drivers</h2>
            <p className="text-xs text-gray-400">
              Per cold-chain security policy, drivers cannot self-register; fleet owners and administrators provision driver credentials.
            </p>
          </div>
          <button
            onClick={() => setShowAddDriver(true)}
            className="btn-gold flex items-center justify-center gap-2 whitespace-nowrap"
          >
            <span>+</span>
            <span>Provision Driver</span>
          </button>
        </div>

        <div className="card p-0 overflow-x-auto">
          {fetching ? <Spinner /> : drivers.length === 0 ? (
            <EmptyState message="No drivers registered for your fleet yet. Click '+ Provision Driver' above to add one." icon="👤" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Driver Name</th>
                  <th>Email Login</th>
                  <th>Assigned Truck Plate</th>
                  <th>Account Status</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map(d => (
                  <tr key={d.id} className="hover:bg-slate-800/40">
                    <td className="font-semibold text-white">{d.name}</td>
                    <td className="font-mono text-xs text-gray-400">{d.email}</td>
                    <td>
                      {d.truck_plate ? (
                        <span className="font-mono text-xs font-bold text-amber-400 bg-amber-950/40 px-2 py-0.5 rounded border border-amber-500/30">
                          {d.truck_plate}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-500 italic">Unassigned</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-bold uppercase ${
                          d.active
                            ? 'bg-emerald-950/60 text-emerald-400 border border-emerald-500/30'
                            : 'bg-red-950/60 text-red-400 border border-red-500/30'
                        }`}
                      >
                        {d.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Provision Driver Modal */}
        {showAddDriver && (
          <Modal title="Provision New Fleet Driver" onClose={() => setShowAddDriver(false)}>
            <form onSubmit={handleCreateDriver} className="space-y-4">
              <p className="text-xs text-gray-400">
                Create driver login credentials. The driver can then sign in directly to the Driver Control Panel (:3000/truck).
              </p>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Full Name *</label>
                <input
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={driverName}
                  onChange={e => setDriverName(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Email Address *</label>
                <input
                  type="email"
                  required
                  placeholder="driver@example.com"
                  value={driverEmail}
                  onChange={e => setDriverEmail(e.target.value)}
                  className="input-field font-mono"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Initial Password (Default: password123)</label>
                <input
                  type="password"
                  placeholder="Leave empty for default 'password123'"
                  value={driverPassword}
                  onChange={e => setDriverPassword(e.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="text-xs text-gray-400 block mb-1">Assign Truck (Optional)</label>
                <select
                  value={assignedTruckId}
                  onChange={e => setAssignedTruckId(e.target.value)}
                  className="input-field"
                >
                  <option value="">Do not assign yet</option>
                  {trucks.map(t => (
                    <option key={t.id} value={t.id}>
                      {t.plate_number} — {t.type} ({t.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddDriver(false)}
                  className="btn-ghost"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingDriver}
                  className="btn-gold"
                >
                  {savingDriver ? 'Creating Driver…' : 'Create Driver Account'}
                </button>
              </div>
            </form>
          </Modal>
        )}
      </div>
    </DashboardLayout>
  );
}
