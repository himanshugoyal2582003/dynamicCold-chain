'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { ErrorAlert, Spinner } from '@/components/ui/shared';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

type NumericField = [name: string, label: string, initial: number | '', min: number, max: number, step: number];
const groups: { title: string; fields: NumericField[] }[] = [
  { title: 'Trip and cargo', fields: [
    ['plannedMinutes', 'Planned time to delivery (min)', 120, 1, 720, 1],
    ['delayMinutes', 'Extra delivery delay (min)', 0, 0, 720, 1],
    ['ambientC', 'Outside temperature (°C)', 30, -50, 55, 0.1],
    ['initialShelfLifeHours', 'Assumed shelf life at setpoint (h)', '', 0.1, 8760, 0.1],
    ['cargoTimeConstantMinutes', 'Cargo thermal time constant (min)', 90, 5, 360, 1],
    ['cargoValue', 'Cargo value', '', 0, 100000000, 0.01],
  ] },
  { title: 'Emergency events', fields: [
    ['failureStart', 'Refrigeration failure starts (min)', 0, 0, 1439, 1],
    ['failureMinutes', 'Refrigeration failure duration (min)', 0, 0, 1440, 1],
    ['powerLossStart', 'Power loss starts (min)', 0, 0, 1439, 1],
    ['powerLossMinutes', 'Power loss duration (min)', 0, 0, 1440, 1],
    ['doorStart', 'Door opening starts (min)', 0, 0, 1439, 1],
    ['doorMinutes', 'Door open duration (min)', 0, 0, 1440, 1],
    ['ambientRiseStart', 'Outside temperature rise starts (min)', 0, 0, 1439, 1],
    ['ambientRiseC', 'Outside temperature increase (°C)', 0, 0, 30, 0.1],
  ] },
];

type Point = { minute: number; airC: number; cargoC: number; qualityPct: number; remainingHours: number };
type Forecast = { series: Point[]; arrival: Point; peakCargoC: number; modeledLoss: number; risk: string };
type Result = {
  modelVersion: string;
  truck: { plate: string; cargoType: string | null };
  seed: { airC: number; targetC: number; observedAt: string };
  input: { currency: string };
  baseline: Forecast;
  emergency: Forecast;
  incrementalLoss: number;
  maintenance: { severity: string; score: number | null; stale: boolean; observedAt: string } | null;
  rescue: { facility: string; status: string; routeMinute: number; bufferMinutes: number; remainingHoursAtEta: number | null; reserveAfterBuffer: number | null } | null;
};
type Fleet = { trucks: { id: string; plate_number: string }[]; hasMore: boolean };
type Metric = 'airC' | 'cargoC' | 'qualityPct' | 'remainingHours';
const metrics: Record<Metric, string> = { airC: 'Truck air (°C)', cargoC: 'Cargo temperature (°C)', qualityPct: 'Cargo quality index (%)', remainingHours: 'Shelf-life reserve (h)' };
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });

function ForecastChart({ result, metric }: { result: Result; metric: Metric }) {
  const [minute, setMinute] = useState(0);
  const horizon = result.emergency.arrival.minute;
  const values = [result.baseline, result.emergency].flatMap(run => run.series.map(point => point[metric]));
  const min = metric === 'qualityPct' ? 0 : Math.floor(Math.min(...values));
  const max = Math.max(min + 1, Math.ceil(Math.max(...values)));
  const x = (time: number) => 60 + 500 * time / horizon;
  const y = (value: number) => 172 - 150 * (value - min) / (max - min);
  const line = (run: Forecast) => run.series.map(point => `${x(point.minute).toFixed(2)},${y(point[metric]).toFixed(2)}`).join(' ');
  const cursor = Math.min(minute, horizon);
  const baselinePoint = result.baseline.series[cursor];

  return <section className="card space-y-3">
    <h2 className="text-lg font-semibold">{metrics[metric]}</h2>
    <svg viewBox="0 0 580 200" role="img" aria-label={`Baseline and emergency ${metrics[metric]} by elapsed minute`} className="w-full">
      {[0, 0.5, 1].map(fraction => {
        const value = min + fraction * (max - min);
        return <g key={fraction}><line x1="60" x2="560" y1={y(value)} y2={y(value)} stroke="#d7dce1" />
          <text x="54" y={y(value) + 4} textAnchor="end" fontSize="11">{number(value)}</text></g>;
      })}
      <polyline points={line(result.baseline)} fill="none" stroke="#236286" strokeWidth="3" />
      <polyline points={line(result.emergency)} fill="none" stroke="#a32e39" strokeWidth="3" strokeDasharray="6 3" />
      <line x1={x(cursor)} x2={x(cursor)} y1="22" y2="172" stroke="#64748b" />
      <text x="60" y="193" fontSize="11">0 min</text>
      <text x="560" y="193" textAnchor="end" fontSize="11">{horizon} min</text>
    </svg>
    <label className="block text-sm">Inspect minute {cursor}
      <input className="block w-full accent-slate-700" type="range" min="0" max={horizon} value={cursor} onChange={event => setMinute(Number(event.target.value))} />
    </label>
    <p className="text-sm"><span className="text-[#236286]">Baseline {baselinePoint ? number(baselinePoint[metric]) : 'delivered'}</span>
      {' · '}<span className="text-[#a32e39]">Emergency {number(result.emergency.series[cursor][metric])}</span></p>
  </section>;
}

export default function DigitalTwinDashboard({ role }: { role: 'admin' | 'owner' }) {
  const { user, loading } = useAuth();
  const allowed = user?.role === role;
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [page, setPage] = useState(1);
  const [truck, setTruck] = useState('');
  const [fleetError, setFleetError] = useState('');
  const [runError, setRunError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [running, setRunning] = useState(false);
  const [metric, setMetric] = useState<Metric>('cargoC');

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setFleet(null);
    setFleetError('');
    void apiFetch<Fleet>(`/api/digital-twin/trucks?page=${page}`, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setFleet(data); },
      error => { if (!controller.signal.aborted) setFleetError(error.message); },
    );
    return () => controller.abort();
  }, [allowed, page]);

  async function run(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!truck || running) return;
    const form = new FormData(event.currentTarget);
    const input = Object.fromEntries(groups.flatMap(group => group.fields.map(([name]) => [name, Number(form.get(name))] as const)));
    setResult(null);
    setRunError('');
    setRunning(true);
    try {
      setResult(await apiFetch<Result>(`/api/digital-twin/trucks/${truck}/simulate`, {
        method: 'POST', body: JSON.stringify({ ...input, currency: form.get('currency') }),
      }));
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Simulation unavailable');
    } finally {
      setRunning(false);
    }
  }

  if (loading || !allowed) return null;
  const money = (value: number) => `${result?.input.currency} ${number(value)}`;
  return <DashboardLayout title="Digital Twin" roleLabel={role === 'admin' ? 'Administrator' : 'Fleet Owner'} navItems={[
    { href: `/${role}`, label: 'Overview', icon: '' },
    { href: `/${role}/trips`, label: 'Trips', icon: '' },
    { href: `/${role}/tracking`, label: 'Tracking', icon: '' },
  ]}>
    <div className="space-y-4">
      <p className="card text-sm">Hypothetical planning estimates seeded from a recent paired truck reading. Forecasts have no field validation and are unsuitable for food safety or dispatch decisions.</p>
      {fleetError && <ErrorAlert message={fleetError} />}
      {!fleet && !fleetError && <Spinner />}
      {fleet && <form onSubmit={run} className="card space-y-5">
        <fieldset disabled={running} className="space-y-5">
          <legend className="text-lg font-semibold">Simulation setup</legend>
          <div className="flex flex-wrap items-end gap-3">
            <label className="block text-sm">Truck
              <select className="input block" required value={truck} onChange={event => { setTruck(event.target.value); setResult(null); setRunError(''); }}>
                <option value="">{fleet.trucks.length ? 'Select a truck' : 'No active trucks on this page'}</option>
                {fleet.trucks.map(row => <option key={row.id} value={row.id}>{row.plate_number}</option>)}
              </select>
            </label>
            {(page > 1 || fleet.hasMore) && <div className="flex items-center gap-2">
              <button type="button" className="btn-ghost" disabled={page === 1} onClick={() => { setTruck(''); setResult(null); setRunError(''); setPage(page - 1); }}>Previous</button>
              <span className="text-sm">Page {page}</span>
              <button type="button" className="btn-ghost" disabled={!fleet.hasMore} onClick={() => { setTruck(''); setResult(null); setRunError(''); setPage(page + 1); }}>Next</button>
            </div>}
          </div>
          <p className="text-sm text-slate-600">Event starts are elapsed minutes from the seed. Leave duration or temperature rise at zero to disable an event.</p>
          {groups.map(group => <fieldset key={group.title} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="mb-2 font-semibold">{group.title}</legend>
            {group.fields.map(([name, label, value, min, max, step]) => <label className="text-sm" key={name}>{label}
              <input className="input block w-full" name={name} type="number" required min={min} max={max} step={step} defaultValue={value} />
            </label>)}
            {group.title === 'Trip and cargo' && <label className="text-sm">Currency
              <input className="input block w-full" name="currency" defaultValue="INR" required pattern="[A-Z]{3}" maxLength={3} />
            </label>}
          </fieldset>)}
          <button type="submit" className="btn-gold" disabled={!truck || running}>{running ? 'Simulating…' : 'Run comparison'}</button>
        </fieldset>
      </form>}
      {runError && <ErrorAlert message={runError} />}
      {result && <>
        <section className="card space-y-3">
          <h2 className="text-lg font-semibold">{result.truck.plate} · {result.truck.cargoType ?? 'Cargo type unavailable'}</h2>
          <p className="text-sm text-slate-600">Sensor seed {number(result.seed.airC)} °C at {new Date(result.seed.observedAt).toLocaleString()} · Configured setpoint {number(result.seed.targetC)} °C</p>
          <div className="overflow-x-auto"><table className="data-table w-full">
            <thead><tr><th scope="col">At delivery</th><th scope="col">Baseline</th><th scope="col">Emergency</th></tr></thead>
            <tbody>
              <tr><th scope="row">Elapsed time</th><td>{result.baseline.arrival.minute} min</td><td>{result.emergency.arrival.minute} min</td></tr>
              <tr><th scope="row">Cargo temperature</th><td>{number(result.baseline.arrival.cargoC)} °C</td><td>{number(result.emergency.arrival.cargoC)} °C</td></tr>
              <tr><th scope="row">Peak cargo temperature</th><td>{number(result.baseline.peakCargoC)} °C</td><td>{number(result.emergency.peakCargoC)} °C</td></tr>
              <tr><th scope="row">Shelf-life reserve</th><td>{number(result.baseline.arrival.remainingHours)} h</td><td>{number(result.emergency.arrival.remainingHours)} h</td></tr>
              <tr><th scope="row">Quality index</th><td>{number(result.baseline.arrival.qualityPct)}%</td><td>{number(result.emergency.arrival.qualityPct)}%</td></tr>
              <tr><th scope="row">Risk indicator</th>{[result.baseline, result.emergency].map((item, i) => <td key={i} className={item.risk === 'reserve_available' ? 'text-slate-700' : 'font-semibold text-red-800'}>{item.risk.replaceAll('_', ' ')}</td>)}</tr>
              <tr><th scope="row">Modeled value loss</th><td>{money(result.baseline.modeledLoss)}</td><td>{money(result.emergency.modeledLoss)}</td></tr>
            </tbody>
          </table></div>
          <p className="text-sm font-semibold">Incremental modeled loss {money(result.incrementalLoss)}</p>
        </section>
        <label className="text-sm">Chart metric
          <select className="input ml-2" value={metric} onChange={event => setMetric(event.target.value as Metric)}>
            {Object.entries(metrics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <ForecastChart result={result} metric={metric} />
        <section className="card grid gap-4 text-sm md:grid-cols-2">
          <div><h2 className="font-semibold"><Link className="underline" href={`/${role}/maintenance`}>Predictive Maintenance</Link></h2>
            {result.maintenance ? <p>{result.maintenance.severity.replaceAll('_', ' ')} · {result.maintenance.score ?? 'Score unavailable'}{result.maintenance.score !== null && '/100'} · {result.maintenance.stale ? 'Stale' : 'Current'} · {new Date(result.maintenance.observedAt).toLocaleString()}</p> : <p>No matching recorded assessment.</p>}
          </div>
          <div><h2 className="font-semibold"><Link className="underline" href={`/${role}/trips`}>Rescue Engine context</Link></h2>
            {result.rescue ? <>
              <p>{result.rescue.facility} · {result.rescue.status.replaceAll('_', ' ')} · recorded route estimate {result.rescue.routeMinute} min</p>
              <p>Modeled reserve at ETA {result.rescue.remainingHoursAtEta === null ? 'outside forecast' : `${number(result.rescue.remainingHoursAtEta)} h`} · after {result.rescue.bufferMinutes} min buffer {result.rescue.reserveAfterBuffer === null ? 'outside forecast' : `${number(result.rescue.reserveAfterBuffer)} h`}</p>
            </> : <p>No current rescue candidate with a recorded road estimate.</p>}
          </div>
        </section>
      </>}
    </div>
  </DashboardLayout>;
}
