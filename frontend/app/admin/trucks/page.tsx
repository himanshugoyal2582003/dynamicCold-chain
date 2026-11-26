'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { AvailableOwner, getAvailableOwners } from '@/lib/owners';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { StatusBadge, Spinner, EmptyState, ErrorAlert, SuccessAlert, Modal, formatDate, isExpired, isExpiringSoon } from '@/components/ui/shared';

const NAV = [
  { href: '/admin', label: 'Overview', icon: '◈' },
  { href: '/admin/tracking', label: 'Global Map', icon: '📍' },
  { href: '/admin/trips', label: 'Trips', icon: '🛣️' },
  { href: '/admin/owners', label: 'Owners', icon: '🏢' },
  { href: '/admin/trucks', label: 'Trucks', icon: '🚛' },
  { href: '/admin/insurance', label: 'LSTM Insurance', icon: '🛡️' },
  { href: '/admin/users', label: 'Drivers', icon: '👤' },
  { href: '/admin/activity', label: 'Activity Log', icon: '📋' },
];

const BLANK_FORM = {
  owner_id: '', plate_number: '', type: 'Refrigerated Semi 10T',
  capacity_tons: '10', target_temp_c: '4', base_insurance_price: '450',
  insurance_expiry: '', permit_expiry: '', fitness_expiry: '',
};

export default function AdminTrucks() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [trucks, setTrucks] = useState<any[]>([]);
  const [owners, setOwners] = useState<AvailableOwner[]>([]);
  const [loadingOwners, setLoadingOwners] = useState(false);
  const [ownerError, setOwnerError] = useState('');
  const [fetching, setFetching] = useState(true);
  const [trucksError, setTrucksError] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [assignTruck, setAssignTruck] = useState<any>(null);
  const [assignmentDrivers, setAssignmentDrivers] = useState<any[]>([]);
  const [selectedDriverId, setSelectedDriverId] = useState('');
  const [loadingAssignmentDrivers, setLoadingAssignmentDrivers] = useState(false);
  const [assignmentError, setAssignmentError] = useState('');
  const [savingAssignment, setSavingAssignment] = useState(false);
  const [iotTruck, setIotTruck] = useState<any>(null);
  const [iotDevices, setIotDevices] = useState<any[]>([]);
  const [iotLoading, setIotLoading] = useState(false);
  const [iotError, setIotError] = useState('');
  const [iotSaving, setIotSaving] = useState(false);
  const [selectedIotDevice, setSelectedIotDevice] = useState('');
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) router.replace('/login');
  }, [user, loading, router]);

  async function fetchAll() {
    setFetching(true);
    setTrucksError('');
    try {
      const response = await apiFetch('/api/admin/trucks');
      const rows = Array.isArray(response) ? response : response?.trucks;
      if (!Array.isArray(rows)) throw new Error('Truck service returned an invalid response.');
      setTrucks(rows);
    } catch (e: any) {
      setTrucksError(e?.message || 'Could not load trucks.');
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => { if (user?.role === 'admin') fetchAll(); }, [user]);

  useEffect(() => {
    if (!showModal) return;
    let active = true;
    setOwners([]);
    setOwnerError('');
    setLoadingOwners(true);
    setForm((current) => ({ ...current, owner_id: '' }));
    getAvailableOwners()
      .then((rows) => { if (active) setOwners(rows); })
      .catch((e: any) => { if (active) setOwnerError(e?.message || 'Could not load registered owners.'); })
      .finally(() => { if (active) setLoadingOwners(false); });
    return () => { active = false; };
  }, [showModal]);

  useEffect(() => {
    if (!assignTruck) return;
    let active = true;
    setAssignmentDrivers([]);
    setSelectedDriverId('');
    setAssignmentError('');
    setLoadingAssignmentDrivers(true);
    apiFetch(`/api/admin/trucks/${assignTruck.id}/available-drivers`)
      .then((rows) => {
        if (!active) return;
        if (!Array.isArray(rows)) throw new Error('The driver service returned an invalid response.');
        setAssignmentDrivers(rows);
      })
      .catch((e: any) => { if (active) setAssignmentError(e?.message || 'Could not load eligible drivers.'); })
      .finally(() => { if (active) setLoadingAssignmentDrivers(false); });
    return () => { active = false; };
  }, [assignTruck]);

  useEffect(() => {
    if (!iotTruck) return;
    let active = true;
    setIotLoading(true);
    setIotError('');
    setIotDevices([]);
    setSelectedIotDevice('');
    apiFetch('/api/iot/devices')
      .then((response) => {
        if (!Array.isArray(response?.devices)) throw new Error('The device registry returned an invalid response.');
        if (active) setIotDevices(response.devices);
      })
      .catch((e: any) => { if (active) setIotError(e?.message || 'Could not load registered IoT devices.'); })
      .finally(() => { if (active) setIotLoading(false); });
    return () => { active = false; };
  }, [iotTruck]);

  async function saveIotPairing(action: 'pair' | 'unpair') {
    if (!iotTruck || iotSaving) return;
    setIotSaving(true);
    setIotError('');
    try {
      if (action === 'pair') {
        if (!iotDevices.some((device) => device.connection_number === selectedIotDevice && !device.isPaired)) {
          throw new Error('Select an available registered device.');
        }
        await apiFetch('/api/iot/connect', {
          method: 'POST',
          body: JSON.stringify({ truckId: iotTruck.id, connectionNumber: selectedIotDevice }),
        });
        setSuccess(`IoT device ${selectedIotDevice} paired with ${iotTruck.plate_number}.`);
      } else {
        await apiFetch('/api/iot/disconnect', { method: 'POST', body: JSON.stringify({ truckId: iotTruck.id }) });
        setSuccess(`IoT device unpaired from ${iotTruck.plate_number}.`);
      }
      await fetchAll();
      setIotTruck(null);
    } catch (e: any) {
      setIotError(e?.message || 'IoT pairing update failed.');
    } finally {
      setIotSaving(false);
    }
  }

  async function handleAssignDriver(e: React.FormEvent) {
    e.preventDefault();
    if (!assignTruck || !selectedDriverId || savingAssignment) return;
    setSavingAssignment(true);
    setAssignmentError('');
    setError('');
    try {
      await apiFetch(`/api/admin/trucks/${assignTruck.id}/assign-driver`, {
        method: 'POST', body: JSON.stringify({ driverId: selectedDriverId }),
      });
      setSuccess(`Driver assigned to ${assignTruck.plate_number}.`);
      setAssignTruck(null);
      setSelectedDriverId('');
      await fetchAll();
    } catch (e: any) {
      setAssignmentError(e?.message || 'Driver assignment failed.');
    } finally {
      setSavingAssignment(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!owners.some((owner) => owner.id === form.owner_id && owner.active)) {
      setError('Select an active registered owner before creating the truck.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await apiFetch('/api/admin/trucks', {
        method: 'POST',
        body: JSON.stringify({
          ...form,
          capacity_tons: parseFloat(form.capacity_tons),
          target_temp_c: parseFloat(form.target_temp_c),
          base_insurance_price: parseFloat(form.base_insurance_price) || 450,
        }),
      });
      setSuccess('Truck created successfully.');
      setShowModal(false);
      setForm(BLANK_FORM);
      await fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string, plate: string) {
    if (!confirm(`Delete truck "${plate}"? Its active trip will end and its driver will be unassigned.`)) return;
    try {
      await apiFetch(`/api/admin/trucks/${id}`, { method: 'DELETE' });
      setSuccess(`Truck "${plate}" deleted.`);
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
          ) : trucksError ? (
            <div className="p-6 space-y-3">
              <ErrorAlert message={`Truck list could not be loaded: ${trucksError}`} />
              <button className="btn-ghost" onClick={fetchAll}>Retry</button>
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState message="No trucks found." icon="🚛" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Type</th>
                  <th>Owner</th>
                  <th>Assigned Driver</th>
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
                    <td style={{ color: 'var(--color-slate)', fontSize: 13 }}>
                      {t.driver_name ? <>{t.driver_name}<span className="block text-[11px] text-slate-500">{t.driver_email}</span></> : 'Unassigned'}
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="tabular-nums" style={{ color: 'var(--color-ink)' }}>{t.target_temp_c}°C</td>
                    <td><DocTag date={t.insurance_expiry} /></td>
                    <td><DocTag date={t.permit_expiry} /></td>
                    <td><DocTag date={t.fitness_expiry} /></td>
                    <td>
                      {t.active && (
                        <button className="btn-danger" onClick={() => handleDelete(t.id, t.plate_number)}>
                          Delete
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
                required disabled={loadingOwners || !!ownerError || owners.length === 0}
                className="input-field"
              >
                <option value="">{loadingOwners ? 'Loading owners…' : ownerError ? 'Owners could not be loaded' : owners.length ? 'Select owner…' : 'No registered owners found'}</option>
                {owners.map(o => <option key={o.id} value={o.id}>{o.name} ({o.email})</option>)}
              </select>
              {loadingOwners && <p className="text-xs text-slate-400" role="status">Loading registered owners…</p>}
              {ownerError && <p className="text-xs text-red-600" role="alert">{ownerError}</p>}
            </div>
            {[
              { label: 'Plate Number', key: 'plate_number', placeholder: 'DL-01-AX-4821' },
              { label: 'Truck Type', key: 'type', placeholder: 'Refrigerated Semi 10T' },
              { label: 'Capacity (tons)', key: 'capacity_tons', placeholder: '10.5' },
              { label: 'Target Temp (°C)', key: 'target_temp_c', placeholder: '4.0' },
              { label: 'Base Insurance Price ($/mo)', key: 'base_insurance_price', placeholder: '450.00' },
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
              <button type="submit" className="btn-primary flex-1" disabled={saving || loadingOwners || !!ownerError || owners.length === 0 || !form.owner_id}>
                {saving ? 'Creating…' : 'Add Truck'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setShowModal(false)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}

      {assignTruck && (
        <Modal title={`Assign Driver · ${assignTruck.plate_number}`} onClose={() => setAssignTruck(null)}>
          <form onSubmit={handleAssignDriver} className="space-y-4">
            <label className="block text-xs font-medium uppercase tracking-wide text-slate-400">
              Eligible drivers · {assignTruck.owner_name}
            </label>
            <select
              className="input-field w-full"
              value={selectedDriverId}
              onChange={(event) => setSelectedDriverId(event.target.value)}
              disabled={loadingAssignmentDrivers || !!assignmentError || assignmentDrivers.length === 0}
              required
            >
              <option value="">{loadingAssignmentDrivers ? 'Loading drivers…' : assignmentError ? 'Drivers could not be loaded' : assignmentDrivers.length ? 'Select a driver…' : 'No available drivers'}</option>
              {assignmentDrivers.map((driver) => (
                <option key={driver.id} value={driver.id}>
                  {driver.name} ({driver.email}){driver.truck_id && driver.truck_id !== assignTruck.id ? ` — transfer from ${driver.truck_plate || 'another truck'}` : driver.truck_id ? ' — currently assigned here' : ' — unassigned'}
                </option>
              ))}
            </select>
            {loadingAssignmentDrivers && <p className="text-xs text-slate-400" role="status">Loading eligible drivers…</p>}
            {assignmentError && <ErrorAlert message={assignmentError} />}
            <div className="flex justify-end gap-3 pt-2">
              <button type="button" className="btn-ghost" onClick={() => setAssignTruck(null)}>Cancel</button>
              <button type="submit" className="btn-gold" disabled={savingAssignment || loadingAssignmentDrivers || !!assignmentError || !selectedDriverId}>
                {savingAssignment ? 'Assigning…' : 'Confirm Assignment'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {iotTruck && (
        <Modal title={`IoT Device · ${iotTruck.plate_number}`} onClose={() => setIotTruck(null)}>
          <div className="space-y-4">
            <p className="text-xs text-slate-500">Pairing is saved in PostgreSQL. Online state is based on recent device telemetry and is independent from pairing.</p>
            {iotError && <ErrorAlert message={iotError} />}
            {iotTruck.iot_connection_number ? (
              <div className="flex items-center justify-between rounded border p-3" style={{ borderColor: 'var(--color-hairline)' }}>
                <div>
                  <p className="text-xs uppercase text-slate-500">Currently paired</p>
                  <p className="font-mono font-semibold">{iotTruck.iot_connection_number}</p>
                  <p className="text-xs text-slate-500">{iotDevices.find((device) => device.connection_number === iotTruck.iot_connection_number)?.status || 'OFFLINE'}</p>
                </div>
                <button type="button" className="btn-danger" disabled={iotSaving} onClick={() => saveIotPairing('unpair')}>
                  {iotSaving ? 'Saving…' : 'Unpair'}
                </button>
              </div>
            ) : (
              <>
                <label className="block text-xs font-medium uppercase tracking-wide text-slate-500">Registered devices</label>
                <select className="input-field w-full" value={selectedIotDevice} onChange={(e) => setSelectedIotDevice(e.target.value)} disabled={iotLoading || !!iotError}>
                  <option value="">{iotLoading ? 'Loading devices…' : iotError ? 'Devices unavailable' : iotDevices.filter((d) => !d.isPaired).length ? 'Select an available device…' : 'No available devices'}</option>
                  {iotDevices.filter((device) => !device.isPaired).map((device) => (
                    <option key={device.device_id} value={device.connection_number}>
                      {device.name} ({device.connection_number}) · {device.status}
                    </option>
                  ))}
                </select>
                {!iotLoading && !iotError && iotDevices.length === 0 && <p className="text-xs text-slate-500">Open the IoT Simulator and load its device registry before pairing.</p>}
                <button type="button" className="btn-primary w-full" disabled={iotSaving || iotLoading || !selectedIotDevice} onClick={() => saveIotPairing('pair')}>
                  {iotSaving ? 'Saving pairing…' : 'Pair Device'}
                </button>
              </>
            )}
            <button type="button" className="btn-ghost w-full" onClick={() => setIotTruck(null)}>Close</button>
          </div>
        </Modal>
      )}
    </DashboardLayout>
  );
}
