'use client';

import { FormEvent, useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiFetch } from '@/lib/auth';
import { ErrorAlert, formatDateTime } from '@/components/ui/shared';

type Coordinates = [number, number];
type Role = 'admin' | 'owner' | 'truckUser';
type Action = 'APPROVED' | 'REJECTED' | 'STARTED' | 'COMPLETED' | 'CANCELLED';

interface Candidate {
  id: string;
  warehouse_name: string;
  rank_position: number | null;
  district: string;
  state: string;
  road_distance_km: number | null;
  estimated_duration_seconds: number | null;
  estimated_shelf_life_at_arrival: number | null;
  rescue_score: number | null;
  is_time_feasible: boolean | null;
  route_coordinates: Coordinates[] | null;
  explanation: string[];
}

interface RescueEvent {
  id: string;
  status: string;
  severity: string;
  spoilage_risk: string | number;
  original_destination: string;
  cargo_type: string;
  emergency_candidate_id: string | null;
  created_at: string;
  valid_until: string;
  shelf_life_until: string;
  candidates: Candidate[];
  decisions: {
    id: string;
    decision: string;
    actor_id: string;
    reason: string;
    facility_confirmation: string | null;
    created_at: string;
  }[];
}

const activeStatuses = ['PENDING_APPROVAL', 'APPROVED', 'REROUTING'];
const labels: Record<Action, string> = {
  APPROVED: 'Approve diversion',
  REJECTED: 'Reject rescue',
  STARTED: 'Start approved diversion',
  COMPLETED: 'Confirm cargo handoff',
  CANCELLED: 'Record failed diversion',
};

function RoutePreview({ coordinates }: { coordinates: Coordinates[] }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let map: import('leaflet').Map | undefined;
    void import('leaflet').then(({ default: L }) => {
      if (cancelled || !container.current) return;
      map = L.map(container.current, { attributionControl: false });
      const route = L.polyline(coordinates, { color: '#1d4ed8', weight: 4 }).addTo(map);
      L.circleMarker(coordinates[0], { color: '#1d4ed8', radius: 5 }).addTo(map).bindTooltip('Evaluated GPS origin');
      L.circleMarker(coordinates[coordinates.length - 1], { color: '#166534', radius: 5 }).addTo(map).bindTooltip('Road endpoint');
      map.fitBounds(route.getBounds(), { padding: [24, 24], maxZoom: 15 });
    });
    return () => { cancelled = true; map?.remove(); };
  }, [coordinates]);

  return <div className="space-y-1">
    <div ref={container} role="region" aria-label="Estimated emergency route" className="isolate h-44 w-full rounded bg-slate-100" />
    <p className="text-xs text-slate-600">OSRM route preview from the evaluated GPS location. Estimated driving time does not include live traffic or truck restrictions.</p>
  </div>;
}

function metric(value: number | null, suffix: string) {
  return value === null ? 'Unavailable' : `${value.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${suffix}`;
}

export default function RescuePanel({ tripId, role, tripStatus, gpsSynced = true }: {
  tripId: string;
  role: Role;
  tripStatus: string;
  gpsSynced?: boolean;
}) {
  const path = `/api/trips/${tripId}/rescue`;
  const heading = useId();
  const [events, setEvents] = useState<RescueEvent[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [previewId, setPreviewId] = useState('');
  const [pending, setPending] = useState<{ eventId: string; action: Action; candidate?: Candidate } | null>(null);
  const [reason, setReason] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [verified, setVerified] = useState(false);
  const sequence = useRef(0);

  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const rows = await apiFetch<RescueEvent[]>(path);
      if (request !== sequence.current) return;
      setEvents(previous => previous && JSON.stringify(previous) === JSON.stringify(rows) ? previous : rows);
    } catch (e) {
      if (request === sequence.current) setError(e instanceof Error ? e.message : 'Could not load rescue history.');
    }
  }, [path]);

  const isInProgress = tripStatus === 'IN_PROGRESS';
  useEffect(() => {
    void refresh();
    const timer = isInProgress ? setInterval(refresh, 10000) : undefined;
    return () => { clearInterval(timer); sequence.current++; };
  }, [refresh, isInProgress]);

  async function mutate(action: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update rescue.');
    } finally {
      await refresh();
      setBusy(false);
    }
  }

  function openDecision(action: Action, candidate?: Candidate) {
    if (!active) return;
    setPending({ eventId: active.id, action, candidate });
    setReason('');
    setConfirmation('');
    setVerified(false);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!active || !pending || active.id !== pending.eventId || busy || (pending.action === 'STARTED' && !gpsSynced)) return;
    void mutate(async () => {
      await apiFetch(`${path}/${active.id}/decisions`, {
        method: 'POST',
        body: JSON.stringify({
          action: pending.action,
          reason,
          ...(pending.candidate && {
            candidateId: pending.candidate.id,
            facilityConfirmation: confirmation,
            facilityVerified: verified,
          }),
        }),
      });
      setPending(null);
    });
  }

  const active = events?.find(event => activeStatuses.includes(event.status));
  const manager = role === 'admin' || role === 'owner';
  const now = Date.now();
  const expired = !!active && Date.parse(active.valid_until) <= now;
  const destination = active?.candidates.find(candidate => candidate.id === active.emergency_candidate_id);
  const preview = active?.candidates.find(candidate => candidate.id === previewId) ?? destination;
  const approvalOpen = isInProgress && !expired && manager && active?.status === 'PENDING_APPROVAL';

  return <section id="cargo-rescue" aria-labelledby={heading} className="space-y-3 rounded border border-slate-200 bg-white p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 id={heading} className="font-semibold">Cargo rescue</h3>
      <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => { setError(''); void refresh(); }}>Refresh</button>
    </div>
    {error && <ErrorAlert message={error} />}
    {notice && <p role="status" className="text-sm text-slate-700">{notice}</p>}
    {events === null && !error && <p role="status" className="text-sm text-slate-600">Loading rescue history…</p>}
    {!gpsSynced && isInProgress && (!active || active.status === 'APPROVED') &&
      <p role="status" className="text-sm text-slate-600">Start GPS location sharing and wait for the server to receive a fix.</p>}
    {events !== null && !active && isInProgress && <button type="button" className="btn-primary text-sm" disabled={busy || !gpsSynced} onClick={() => {
      void mutate(async () => {
        const result = await apiFetch<{ requiresRescue: boolean }>(path, { method: 'POST' });
        if (!result.requiresRescue) setNotice('Current sensor and LSTM readings are below the rescue threshold.');
      });
    }}>{busy ? 'Evaluating…' : 'Evaluate emergency routes'}</button>}
    {active && <>
      <div className="rounded bg-amber-50 p-3 text-sm space-y-1">
        <p className="font-semibold">{active.severity} · {active.status.replaceAll('_', ' ')}</p>
        <p>LSTM spoilage risk {Math.round(Number(active.spoilage_risk) * 100)}%</p>
        <p>Original destination · {active.original_destination}</p>
        {destination && <p className="font-semibold">Emergency destination · {destination.warehouse_name}</p>}
        <p className="text-xs">Shelf-life estimates are advisory and have not been validated on real-world trips.</p>
        {expired && active.status !== 'REROUTING' && <p className="font-semibold">This route estimate expired. A manager can reject it so a new evaluation can be requested.</p>}
      </div>
      <ul className="space-y-2" aria-label="Warehouse candidates">
        {active.candidates.map(candidate => {
          const enoughTime = candidate.estimated_duration_seconds !== null &&
            Date.parse(active.shelf_life_until) > now + (candidate.estimated_duration_seconds + 900) * 1000;
          return <li key={candidate.id} className="space-y-2 rounded border border-slate-200 p-2 text-sm">
            <div>
              <strong>{candidate.rank_position !== null && `#${candidate.rank_position} · `}{candidate.warehouse_name}</strong>
              <p className="text-xs text-slate-600">{[candidate.district, candidate.state].filter(Boolean).join(', ')}</p>
              <p className="text-xs text-slate-600">{destination?.id === candidate.id ? 'Facility confirmation recorded for this rescue' : 'Availability and cargo compatibility unverified'}</p>
            </div>
            <dl className="grid grid-cols-2 gap-2 text-xs">
              <div><dt className="text-slate-600">Road distance</dt><dd>{metric(candidate.road_distance_km, 'km')}</dd></div>
              <div><dt className="text-slate-600">Estimated travel time</dt><dd>{metric(candidate.estimated_duration_seconds === null ? null : candidate.estimated_duration_seconds / 60, 'min')}</dd></div>
              <div><dt className="text-slate-600">ETA from evaluation</dt><dd>{candidate.estimated_duration_seconds === null ? 'Unavailable' : formatDateTime(new Date(Date.parse(active.created_at) + candidate.estimated_duration_seconds * 1000).toISOString())}</dd></div>
              <div><dt className="text-slate-600">Shelf life at arrival</dt><dd>{metric(candidate.estimated_shelf_life_at_arrival, 'min')}</dd></div>
              <div><dt className="text-slate-600">Rescue score</dt><dd>{metric(candidate.rescue_score, '/ 100')}</dd></div>
            </dl>
            {candidate.route_coordinates ? <button type="button" className="btn-ghost text-xs" onClick={() => setPreviewId(candidate.id)}>View route</button>
              : <p className="text-xs text-slate-600">{candidate.explanation[0]}</p>}
            {approvalOpen && enoughTime && candidate.is_time_feasible && <button type="button" className="btn-ghost text-xs" disabled={busy} onClick={() => openDecision('APPROVED', candidate)}>Verify and approve</button>}
          </li>;
        })}
      </ul>
      {!active.candidates.length && <p className="text-sm text-slate-600">No listed facilities found within the search area.</p>}
      {preview?.route_coordinates && <div className="space-y-1">
        <p className="text-sm font-medium">Route to {preview.warehouse_name}</p>
        <RoutePreview coordinates={preview.route_coordinates} />
      </div>}
      <div className="flex flex-wrap gap-2">
        {manager && ['PENDING_APPROVAL', 'APPROVED'].includes(active.status) && <button type="button" className="btn-ghost" disabled={busy} onClick={() => openDecision('REJECTED')}>Reject rescue</button>}
        {role === 'truckUser' && active.status === 'APPROVED' && isInProgress && !expired && <button type="button" className="btn-primary" disabled={busy || !gpsSynced} onClick={() => openDecision('STARTED')}>Start approved diversion</button>}
        {active.status === 'REROUTING' && <button type="button" className="btn-primary" disabled={busy} onClick={() => openDecision('COMPLETED')}>Confirm cargo handoff</button>}
        {manager && active.status === 'REROUTING' && <button type="button" className="btn-ghost" disabled={busy} onClick={() => openDecision('CANCELLED')}>Record failed diversion</button>}
      </div>
      {pending?.eventId === active.id && <form className="space-y-2 rounded bg-slate-50 p-3 text-sm" onSubmit={submit}>
        <p className="font-semibold">{labels[pending.action]}{pending.candidate && ` · ${pending.candidate.warehouse_name}`}</p>
        {pending.candidate && <>
          <label className="block">Facility confirmation details
            <textarea className="input-field w-full" required maxLength={1000} value={confirmation} onChange={e => setConfirmation(e.target.value)} placeholder="Facility contact, confirmation time, available space, temperature and cargo acceptance" />
          </label>
          <label className="flex items-start gap-2"><input type="checkbox" required checked={verified} onChange={e => setVerified(e.target.checked)} /> I independently confirmed this facility can receive the shipment and meet its capacity and temperature requirements.</label>
        </>}
        <label className="block">Decision notes
          <textarea className="input-field w-full" required maxLength={1000} value={reason} onChange={e => setReason(e.target.value)} />
        </label>
        <button type="submit" className="btn-primary" disabled={busy || (pending.action === 'STARTED' && !gpsSynced)}>Record decision</button>
        <button type="button" className="btn-ghost" disabled={busy} onClick={() => setPending(null)}>Close</button>
      </form>}
    </>}
    {events !== null && <details>
      <summary className="cursor-pointer text-sm font-semibold">Rescue history ({events.length})</summary>
      {!events.length && <p className="mt-2 text-sm text-slate-600">No rescue events recorded.</p>}
      {events.map(event => <article key={event.id} className="mt-2 rounded border border-slate-200 p-2 text-sm">
        <p className="font-semibold">{event.status.replaceAll('_', ' ')} · {formatDateTime(event.created_at)}</p>
        <p>Original destination · {event.original_destination}</p>
        {event.emergency_candidate_id && <p>Emergency destination · {event.candidates.find(candidate => candidate.id === event.emergency_candidate_id)?.warehouse_name}</p>}
        <ul aria-label="Decision audit" className="mt-1 space-y-1 text-xs">
          {event.decisions.map(decision => <li key={decision.id} className="border-t border-slate-100 pt-1">
            <p>{decision.decision} · {formatDateTime(decision.created_at)}</p>
            <p>Actor {decision.actor_id}</p>
            <p className="whitespace-pre-wrap break-words">{decision.reason}</p>
            {decision.facility_confirmation && <p className="whitespace-pre-wrap break-words">{decision.facility_confirmation}</p>}
          </li>)}
        </ul>
      </article>)}
    </details>}
  </section>;
}
