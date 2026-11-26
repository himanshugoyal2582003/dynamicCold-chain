'use client';

import { useEffect, useState } from 'react';
import { useAuth, apiFetch } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { openColdChainPdfReport } from '@/lib/pdf-report';
import {
  Spinner,
  EmptyState,
  ErrorAlert,
  SuccessAlert,
  Modal,
  formatDateTime,
} from '@/components/ui/shared';

const NAV = [
  { href: '/admin', label: 'Overview', icon: '◈' },
  { href: '/admin/owners', label: 'Owners', icon: '🏢' },
  { href: '/admin/trucks', label: 'Trucks', icon: '🚛' },
  { href: '/admin/insurance', label: 'LSTM Insurance', icon: '🛡️' },
  { href: '/admin/users', label: 'Drivers', icon: '👤' },
  { href: '/admin/activity', label: 'Activity Log', icon: '📋' },
];

export default function AdminInsurancePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [trucks, setTrucks] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [recalcId, setRecalcId] = useState<string | null>(null);

  // Edit base price modal
  const [editingTruck, setEditingTruck] = useState<any>(null);
  const [basePriceInput, setBasePriceInput] = useState('450');
  const [savingPrice, setSavingPrice] = useState(false);

  useEffect(() => {
    if (!loading && (!user || user.role !== 'admin')) router.replace('/login');
  }, [user, loading, router]);

  async function fetchAll() {
    setFetching(true);
    try {
      const [tData, lData] = await Promise.all([
        apiFetch('/api/admin/trucks'),
        apiFetch('/api/admin/lstm-logs').catch(() => []),
      ]);
      setTrucks(Array.isArray(tData) ? tData.filter((t: any) => t.active) : []);
      setLogs(Array.isArray(lData) ? lData : []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setFetching(false);
    }
  }

  useEffect(() => {
    if (user?.role === 'admin') {
      fetchAll();
      const timer = setInterval(fetchAll, 30000);
      return () => clearInterval(timer);
    }
  }, [user]);

  async function handleSaveBasePrice(e: React.FormEvent) {
    e.preventDefault();
    if (!editingTruck) return;
    setSavingPrice(true);
    setError('');
    try {
      const val = parseFloat(basePriceInput);
      if (!Number.isFinite(val) || val <= 0) throw new Error('Enter a valid positive base price.');
      await apiFetch(`/api/admin/trucks/${editingTruck.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ base_insurance_price: val }),
      });
      await apiFetch(`/api/iot/insurance/${editingTruck.id}/recalculate`, { method: 'POST' });
      setSuccess(`Updated real base price for ${editingTruck.plate_number} to ₹${val.toFixed(2)}/mo and recalculated LSTM insurance.`);
      setEditingTruck(null);
      await fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSavingPrice(false);
    }
  }

  async function handleRecalculate(truckId: string, plate: string) {
    setRecalcId(truckId);
    setError('');
    try {
      const res = await apiFetch(`/api/iot/insurance/${truckId}/recalculate`, { method: 'POST' });
      const ins = res.insurance || res;
      setSuccess(`LSTM Insurance updated for ${plate}: ₹${ins.current_price}/mo (${ins.risk_tier})`);
      await fetchAll();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setRecalcId(null);
    }
  }

  if (loading || !user) return null;

  const avgBase = trucks.length
    ? (trucks.reduce((s, t) => s + (Number(t.base_insurance_price) || 450), 0) / trucks.length).toFixed(2)
    : '450.00';
  const avgPred = trucks.length
    ? (trucks.reduce((s, t) => s + (Number(t.current_insurance_price) || 450), 0) / trucks.length).toFixed(2)
    : '450.00';

  const companiesMap = new Map<string, any[]>();
  for (const t of trucks) {
    const companyName = t.owner_name || 'Unassigned Company';
    if (!companiesMap.has(companyName)) companiesMap.set(companyName, []);
    companiesMap.get(companyName)!.push(t);
  }
  const companiesList = Array.from(companiesMap.entries());

  function printAllCompaniesPdf() {
    openColdChainPdfReport({
      title: 'All Companies & Every Truck — LSTM Insurance & Spoilage Report',
      subtitle: `Covers ${companiesList.length} companies and ${trucks.length} trucks with 1-minute Neon DB LSTM logs.`,
      trucks,
      logs,
      groupByCompany: true,
    });
  }

  function printCompanyPdf(companyName: string, companyTrucks: any[]) {
    const companyLogs = logs.filter((l) =>
      companyTrucks.some((t) => t.id === l.truck_id || t.plate_number === l.plate_number),
    );
    openColdChainPdfReport({
      title: `Company Fleet Report — ${companyName}`,
      subtitle: `${companyTrucks.length} truck(s) · 1-minute SpoilageLSTM & InsuranceLSTM audit`,
      trucks: companyTrucks,
      logs: companyLogs,
      groupByCompany: false,
    });
  }

  function printTruckPdf(truck: any) {
    const truckLogs = logs.filter((l) => l.truck_id === truck.id || l.plate_number === truck.plate_number);
    openColdChainPdfReport({
      title: `Truck Report — ${truck.plate_number}`,
      subtitle: `Company: ${truck.owner_name || '—'} · ${truck.type || 'Cold Reefer'}`,
      trucks: [truck],
      logs: truckLogs,
      groupByCompany: false,
    });
  }

  return (
    <DashboardLayout navItems={NAV} title="LSTM Insurance & Spoilage Pipeline" roleLabel="Administrator">
      <div className="space-y-6">
        {error && <ErrorAlert message={error} />}
        {success && <SuccessAlert message={success} />}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium" style={{ color: 'var(--color-ink)' }}>
              Dual-LSTM Fleet Underwriting & 1-Minute Neon DB Telemetry Ledger
            </p>
            <p className="text-xs" style={{ color: 'var(--color-slate)' }}>
              Set real truck base prices, inspect SpoilageLSTM (good vs. bad environment) predictions, and print PDF reports.
            </p>
          </div>
          <div className="no-print flex items-center gap-2">
            <button onClick={fetchAll} className="btn-ghost text-xs">
              Refresh
            </button>
            <button onClick={printAllCompaniesPdf} className="btn-primary text-xs">
              🖨️ All Companies & Trucks PDF
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="card p-4">
            <p className="text-2xl font-bold tabular-nums">{trucks.length}</p>
            <p className="text-xs uppercase tracking-wide mt-1" style={{ color: 'var(--color-slate)' }}>Active Trucks</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold tabular-nums">₹{avgBase}</p>
            <p className="text-xs uppercase tracking-wide mt-1" style={{ color: 'var(--color-slate)' }}>Avg Admin Base Price</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--color-gold)' }}>₹{avgPred}</p>
            <p className="text-xs uppercase tracking-wide mt-1" style={{ color: 'var(--color-slate)' }}>Avg LSTM Predicted Price</p>
          </div>
          <div className="card p-4">
            <p className="text-2xl font-bold tabular-nums">{logs.length}</p>
            <p className="text-xs uppercase tracking-wide mt-1" style={{ color: 'var(--color-slate)' }}>1-Min LSTM Logs (Neon DB)</p>
          </div>
        </div>

        {/* Per-Company PDF Export Cards */}
        {companiesList.length > 0 && (
          <div className="no-print card p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold">Generate PDF Report by Company</h2>
              <span className="text-xs" style={{ color: 'var(--color-slate)' }}>{companiesList.length} companies</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {companiesList.map(([companyName, companyTrucks]) => (
                <div key={companyName} className="p-3 rounded border flex items-center justify-between gap-2" style={{ borderColor: 'var(--color-hairline)', background: 'var(--color-ivory)' }}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{companyName}</p>
                    <p className="text-xs" style={{ color: 'var(--color-slate)' }}>{companyTrucks.length} truck(s)</p>
                  </div>
                  <button
                    onClick={() => printCompanyPdf(companyName, companyTrucks)}
                    className="btn-ghost text-xs whitespace-nowrap"
                  >
                    🖨️ Company PDF
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Truck Base & LSTM Predicted Insurance Table */}
        <div className="card p-0 overflow-x-auto">
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--color-hairline)' }}>
            <h2 className="text-sm font-semibold">Truck Insurance Pricing (Admin Real Price vs. InsuranceLSTM Prediction)</h2>
          </div>
          {fetching ? <Spinner /> : trucks.length === 0 ? (
            <EmptyState message="No active trucks found." icon="🛡️" />
          ) : (
            <table className="data-table min-w-[960px]">
              <thead>
                <tr>
                  <th>Plate</th>
                  <th>Owner / Company</th>
                  <th>Admin Base Price</th>
                  <th>LSTM Predicted Price</th>
                  <th>Risk Score</th>
                  <th>Status</th>
                  <th className="no-print">Actions</th>
                </tr>
              </thead>
              <tbody>
                {trucks.map((t) => {
                  const base = Number(t.base_insurance_price) || 450;
                  const curr = Number(t.current_insurance_price) || 450;
                  const diff = curr - base;
                  return (
                    <tr key={t.id}>
                      <td className="font-mono font-semibold">{t.plate_number}</td>
                      <td>{t.owner_name || '—'}</td>
                      <td className="font-mono tabular-nums">₹{base.toFixed(2)}/mo</td>
                      <td className="font-mono font-semibold tabular-nums">
                        ₹{curr.toFixed(2)}/mo{' '}
                        <span className="text-xs" style={{ color: diff > 0 ? 'var(--status-issue)' : diff < 0 ? 'var(--status-available)' : 'var(--color-slate)' }}>
                          ({diff >= 0 ? '+' : ''}{diff.toFixed(2)})
                        </span>
                      </td>
                      <td className="font-mono tabular-nums">{Number(t.insurance_risk_score || 15).toFixed(1)} / 100</td>
                      <td>
                        <span className="text-xs font-semibold uppercase px-2 py-0.5 rounded" style={{ background: 'var(--color-ivory)' }}>
                          {t.insurance_status || 'standard'}
                        </span>
                      </td>
                      <td className="no-print">
                        <div className="flex gap-2">
                          <button
                            className="btn-ghost text-xs"
                            onClick={() => {
                              setEditingTruck(t);
                              setBasePriceInput(String(base));
                            }}
                          >
                            Set Base Price
                          </button>
                          <button
                            className="btn-primary text-xs"
                            disabled={recalcId === t.id}
                            onClick={() => handleRecalculate(t.id, t.plate_number)}
                          >
                            {recalcId === t.id ? 'Running…' : 'Run LSTM'}
                          </button>
                          <button
                            className="btn-ghost text-xs whitespace-nowrap"
                            onClick={() => printTruckPdf(t)}
                          >
                            🖨️ Truck PDF
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 1-Minute Neon DB LSTM Logs */}
        <div className="card p-0 overflow-x-auto">
          <div className="px-6 py-4 border-b" style={{ borderColor: 'var(--color-hairline)' }}>
            <h2 className="text-sm font-semibold">Per-Minute LSTM Spoilage & Insurance Log (Neon DB)</h2>
          </div>
          {fetching ? <Spinner /> : logs.length === 0 ? (
            <EmptyState message="No per-minute LSTM logs recorded yet. Start a trip or stream IoT telemetry." icon="📊" />
          ) : (
            <table className="data-table min-w-[1120px]">
              <thead>
                <tr>
                  <th>Recorded At</th>
                  <th>Truck</th>
                  <th>Owner</th>
                  <th>Temp / Target</th>
                  <th>Humidity</th>
                  <th>Spoilage Risk</th>
                  <th>Good Env RSL</th>
                  <th>Bad Env RSL</th>
                  <th>LSTM Insurance</th>
                  <th>Model</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((row) => (
                  <tr key={row.id} className="text-xs">
                    <td className="font-mono whitespace-nowrap">{formatDateTime(row.recorded_at)}</td>
                    <td className="font-mono font-semibold">{row.plate_number}</td>
                    <td>{row.owner_name || '—'}</td>
                    <td className="tabular-nums">{row.temperature}°C / {row.target_temp}°C</td>
                    <td className="tabular-nums">{row.humidity}%</td>
                    <td>
                      <span className="font-semibold">{row.spoilage_risk_level}</span> ({row.spoilage_risk})
                    </td>
                    <td className="tabular-nums" style={{ color: 'var(--status-available)' }}>
                      {row.good_env_rsl_hours ?? row.rsl_hours ?? '—'} hrs
                    </td>
                    <td className="tabular-nums" style={{ color: 'var(--status-issue)' }}>
                      {row.bad_env_rsl_hours ?? '—'} hrs
                    </td>
                    <td className="font-mono font-semibold tabular-nums">
                      ₹{Number(row.predicted_insurance_price ?? row.truck_current_price ?? 450).toFixed(2)}/mo
                    </td>
                    <td className="font-mono text-[11px]">{row.model_type || 'PyTorch-LSTM'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {editingTruck && (
        <Modal title={`Set Real Base Price — ${editingTruck.plate_number}`} onClose={() => setEditingTruck(null)}>
          <form onSubmit={handleSaveBasePrice} className="space-y-4">
            <div>
              <label className="block text-xs font-medium uppercase tracking-wide mb-1" style={{ color: 'var(--color-slate)' }}>
                Monthly Base Insurance Price (INR ₹)
              </label>
              <input
                type="number"
                step="0.01"
                min="50"
                required
                value={basePriceInput}
                onChange={(e) => setBasePriceInput(e.target.value)}
                className="input-field font-mono text-lg"
              />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="submit" className="btn-primary flex-1" disabled={savingPrice}>
                {savingPrice ? 'Saving…' : 'Save & Recalculate LSTM'}
              </button>
              <button type="button" className="btn-ghost flex-1" onClick={() => setEditingTruck(null)}>
                Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}
    </DashboardLayout>
  );
}
