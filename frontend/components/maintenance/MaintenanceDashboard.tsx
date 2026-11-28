'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { EmptyState, ErrorAlert, Spinner, formatDateTime } from '@/components/ui/shared';
import { apiFetch, useAuth } from '@/lib/auth';

type Role = 'admin' | 'owner';
type Factor = { code: string; points: number; value: number };
type Assessment = {
  window_end: string | null;
  last_observed_at: string | null;
  score: number | null;
  severity: string | null;
  baseline_windows: number | null;
  model_version: string | null;
  target_c: number | null;
  features: {
    samples: number;
    spanMinutes: number;
    doorCoverage: number;
    recoveryRate: number | null;
    closedDeviation: number | null;
    warmingRate: number | null;
    unconditionedDeviation: number | null;
    unconditionedWarmingRate: number | null;
  } | null;
  factors: Factor[] | null;
};
type Truck = Assessment & { id: string; plate_number: string; data_status: 'current' | 'stale' | 'no_data' };
type Fleet = { trucks: Truck[]; hasMore: boolean; collectionEnabled: boolean };
type History = {
  plate_number: string;
  assessments: Assessment[];
  daily: { day: string; average_score: number | null; scored: number; warnings: number }[];
};

const FACTORS: Record<string, [string, string]> = {
  closed_temperature_deviation: ['Closed-door temperature deviation', '°C'],
  closed_warming_trend: ['Closed-door warming trend', '°C/min'],
  temperature_deviation_unknown_door: ['Temperature deviation with unknown door state', '°C'],
  warming_trend_unknown_door: ['Warming trend with unknown door state', '°C/min'],
  slow_post_door_recovery: ['Slow recovery after door closure', '°C/min'],
  temperature_spikes: ['Abrupt temperature reversals', ''],
  humidity_spikes: ['Abrupt humidity reversals', ''],
  temperature_and_humidity_flatline: ['Unchanged temperature and humidity', 'min'],
  historical_closedDeviation: ['Unusual closed-door temperature deviation', 'robust z'],
  historical_warmingRate: ['Unusual warming rate', 'robust z'],
  historical_recoveryRate: ['Unusually slow recovery', 'robust z'],
  historical_temperatureSpikes: ['Unusual temperature spike count', 'robust z'],
  historical_humiditySpikes: ['Unusual humidity spike count', 'robust z'],
  historical_flatlineMinutes: ['Unusually long unchanged readings', 'robust z'],
};

function severityLabel(value: string | null) {
  return value ? value.replaceAll('_', ' ') : 'no assessment';
}

function AssessmentDetails({ assessment }: { assessment: Assessment }) {
  const { features, factors } = assessment;
  const deviation = features?.closedDeviation ?? features?.unconditionedDeviation;
  const trend = features?.warmingRate ?? features?.unconditionedWarmingRate;
  return <div className="space-y-2 text-sm">
    {features && <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <div><dt className="text-slate-600">Samples</dt><dd>{features.samples} over {features.spanMinutes} min</dd></div>
      <div><dt className="text-slate-600">Door-state coverage</dt><dd>{Math.round(features.doorCoverage * 100)}%</dd></div>
      <div><dt className="text-slate-600">Post-door recovery</dt><dd>{features.recoveryRate === null ? 'Unavailable' : `${features.recoveryRate} °C/min`}</dd></div>
      <div><dt className="text-slate-600">Baseline windows</dt><dd>{assessment.baseline_windows ?? 0}</dd></div>
      <div><dt className="text-slate-600">Setpoint</dt><dd>{assessment.target_c === null ? 'Unavailable' : `${assessment.target_c} °C`}</dd></div>
      <div><dt className="text-slate-600">Median temperature deviation</dt><dd>{deviation == null ? 'Unavailable' : `${deviation} °C`}</dd></div>
      <div><dt className="text-slate-600">Temperature trend</dt><dd>{trend == null ? 'Unavailable' : `${trend} °C/min`}</dd></div>
    </dl>}
    {features && features.doorCoverage < 1 && <p className="text-slate-600">Some door readings are unavailable, limiting interpretation of temperature changes.</p>}
    {factors?.length ? <ul className="space-y-1" aria-label="Contributing factors">
      {factors.map(({ code, points, value }) => {
        const [label, unit] = FACTORS[code] ?? [code.replaceAll('_', ' '), ''];
        return <li key={code}>{label} ({value}{unit && ` ${unit}`}) · {points} point deduction</li>;
      })}
    </ul> : <p className="text-slate-600">{assessment.score === null
      ? 'Additional qualifying sensor readings are needed for a score.'
      : 'No scoring deductions in this window.'}</p>}
  </div>;
}

export default function MaintenanceDashboard({ role }: { role: Role }) {
  const { user, loading } = useAuth();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [fleet, setFleet] = useState<Fleet | null>(null);
  const [selected, setSelected] = useState('');
  const [history, setHistory] = useState<History | null>(null);
  const [fleetError, setFleetError] = useState('');
  const [historyError, setHistoryError] = useState('');
  const allowed = user?.role === role;

  useEffect(() => {
    if (!allowed) return;
    const controller = new AbortController();
    setFleet(null);
    setFleetError('');
    void apiFetch<Fleet>(`/api/maintenance?page=${page}`, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setFleet(data); },
      error => { if (!controller.signal.aborted) setFleetError(error.message); },
    );
    return () => controller.abort();
  }, [allowed, page, revision]);

  useEffect(() => {
    setHistory(null);
    setHistoryError('');
    if (!allowed || !selected) return;
    const controller = new AbortController();
    void apiFetch<History>(`/api/maintenance/trucks/${selected}/history`, { signal: controller.signal }).then(
      data => { if (!controller.signal.aborted) setHistory(data); },
      error => { if (!controller.signal.aborted) setHistoryError(error.message); },
    );
    return () => controller.abort();
  }, [allowed, selected, revision]);

  if (loading || !allowed) return null;
  const truck = fleet?.trucks.find(row => row.id === selected);

  return <DashboardLayout title="Predictive Maintenance" roleLabel={role === 'admin' ? 'Administrator' : 'Fleet Owner'} navItems={[
    { href: `/${role}`, label: 'Overview', icon: '' },
    { href: `/${role}/trips`, label: 'Trips', icon: '' },
    { href: `/${role}/tracking`, label: 'Tracking', icon: '' },
  ]}>
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-slate-600">Temperature and sensor behavior can help prioritize an inspection. These assessments do not estimate the probability of equipment failure.</p>
        <button type="button" className="btn-ghost" onClick={() => setRevision(value => value + 1)}>Refresh</button>
      </div>
      {fleetError && <ErrorAlert message={fleetError} />}
      {!fleet && !fleetError && <Spinner />}
      {fleet && <>
        {!fleet.collectionEnabled && <p className="card text-sm text-slate-600">Maintenance collection is disabled. The deployment needs an ingest secret and approved sensor IDs.</p>}
        {fleet.trucks.length === 0 ? <EmptyState message="No active trucks on this page." icon="🚚" /> :
          <div className="card overflow-x-auto">
            <table className="data-table w-full">
              <caption className="sr-only">Fleet equipment assessments</caption>
              <thead><tr><th>Truck</th><th>Health score</th><th>Severity</th><th>Last reading</th><th>Data status</th></tr></thead>
              <tbody>{fleet.trucks.map(row => <tr key={row.id}>
                <td><button type="button" className="font-semibold text-blue-800 underline" aria-pressed={selected === row.id} onClick={() => setSelected(row.id)}>{row.plate_number}</button></td>
                <td>{row.score === null ? 'Unavailable' : `${row.score} / 100`}</td>
                <td className="capitalize">{severityLabel(row.severity)}</td>
                <td>{row.last_observed_at ? formatDateTime(row.last_observed_at) : 'Unavailable'}</td>
                <td>{row.data_status === 'stale' ? 'Stale' : row.data_status === 'no_data' ? 'No current assessment' : 'Current'}</td>
              </tr>)}</tbody>
            </table>
          </div>}
        {(page > 1 || fleet.hasMore) && <div className="flex items-center gap-3">
          <button type="button" className="btn-ghost" disabled={page === 1} onClick={() => { setSelected(''); setPage(page - 1); }}>Previous</button>
          <span>Page {page}</span>
          <button type="button" className="btn-ghost" disabled={!fleet.hasMore} onClick={() => { setSelected(''); setPage(page + 1); }}>Next</button>
        </div>}
      </>}
      {truck && <section className="card space-y-4" aria-label={`Maintenance history for ${truck.plate_number}`}>
        <h2 className="text-lg font-semibold">{truck.plate_number}</h2>
        {truck.window_end && <AssessmentDetails assessment={truck} />}
        {historyError && <ErrorAlert message={historyError} />}
        {!history && !historyError && <Spinner />}
        {history && <>
          <h3 className="font-semibold">Daily history · last 30 days (UTC)</h3>
          {history.daily.length ? <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead><tr><th>Day</th><th>Average score</th><th>Scored windows</th><th>Warning or critical windows</th></tr></thead>
              <tbody>{history.daily.map(day => <tr key={day.day}><td>{day.day}</td><td>{day.average_score ?? 'Unavailable'}</td><td>{day.scored}</td><td>{day.warnings}</td></tr>)}</tbody>
            </table>
          </div> : <p className="text-sm text-slate-600">No assessments recorded in this period.</p>}
          {history.assessments.length > 0 && <div className="space-y-2">
            <h3 className="font-semibold">Recent assessments</h3>
            {history.assessments.map(item => <details key={item.window_end} className="rounded border border-slate-200 p-2">
              <summary className="cursor-pointer text-sm">{formatDateTime(item.window_end)} · {severityLabel(item.severity)}{item.score !== null && ` · ${item.score}/100`}</summary>
              <AssessmentDetails assessment={item} />
            </details>)}
          </div>}
        </>}
      </section>}
    </div>
  </DashboardLayout>;
}
