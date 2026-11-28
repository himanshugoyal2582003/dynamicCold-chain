'use client';

import { useCallback, useEffect, useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { ErrorAlert, Spinner } from '@/components/ui/shared';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

const endpoint = '/api/iot/delivery';
type Status = { enabled:false } | {
  enabled:true; capacity:number; counts:Record<string,number>; outcomes:Record<string,number>;
  oldestPendingSeconds:number|null;
  deadLetters:{ id:string; attempts:number; result:string; finished:number }[];
  replays:{ event_id:string; actor:string; at:number }[];
};

const timestamp = (seconds:number) => new Date(seconds*1000).toLocaleString();

export default function TelemetryDeliveryPage() {
  const {user,loading} = useAuth();
  const [status,setStatus] = useState<Status|null>(null);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const [selected,setSelected] = useState('');
  const [busy,setBusy] = useState(false);
  const refresh = useCallback(async (signal?:AbortSignal) => {
    try {
      const snapshot = await apiFetch<Status>(endpoint+'/status',{signal});
      if (!signal?.aborted) { setStatus(snapshot); setError(''); }
    } catch (error) {
      if (!signal?.aborted) { setStatus(null); setError(error instanceof Error ? error.message : 'Delivery monitor unavailable'); }
    }
  },[]);
  useEffect(()=>{
    if (user?.role !== 'admin') return;
    const controller = new AbortController();
    void refresh(controller.signal);
    return ()=>controller.abort();
  },[refresh,user?.role,user?.sub]);

  async function replay() {
    if (!selected || busy) return;
    setBusy(true);
    setNotice('');
    setError('');
    try {
      await apiFetch(endpoint+'/replay',{method:'POST',body:JSON.stringify({eventId:selected})});
      setSelected('');
      setNotice('Dead letter requeued with its original observation time.');
      await refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Replay failed');
    } finally { setBusy(false); }
  }
  if (loading || user?.role !== 'admin') return null;
  return <DashboardLayout title="Telemetry Delivery" roleLabel="Administrator" navItems={[
    {href:'/admin',label:'Overview',icon:''},{href:'/admin/tracking',label:'Tracking',icon:''},
  ]}>
    <div className="space-y-4">
      <section className="card flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">Durable forwarding, retry backlog and dead-letter recovery for the AI/ML gateway.</p>
        <button className="btn-ghost" type="button" disabled={busy} onClick={()=>void refresh()}>Refresh status</button>
      </section>
      {error && <ErrorAlert message={error}/>}
      {notice && <p className="card text-sm" role="status">{notice}</p>}
      {!status && !error && <Spinner/>}
      {status && !status.enabled && <p className="card text-sm">Durable delivery is disabled on this gateway.</p>}
      {status?.enabled && <>
        <section className="card space-y-3">
          <h2 className="font-semibold">Delivery health</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            {[['Pending',status.counts.pending ?? 0],['Sending',status.counts.sending ?? 0],
              ['Delivered',status.counts.delivered ?? 0],['Dead letters',status.counts.dead ?? 0],
              ['Capacity',status.capacity],['Oldest pending',status.oldestPendingSeconds === null ? 'None' : `${status.oldestPendingSeconds} s`]
            ].map(([label,value])=><div key={label}><dt>{label}</dt><dd className="font-semibold">{value}</dd></div>)}
          </dl>
          {Object.keys(status.outcomes).length>0 && <p className="text-sm">
            {Object.entries(status.outcomes).map(([key,count])=>`${key.replaceAll('_',' ')} ${count}`).join(' · ')}
          </p>}
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Recent dead letters</h2>
          {!status.deadLetters.length && <p className="text-sm">No dead letters retained.</p>}
          <ul className="divide-y">
            {status.deadLetters.map(event=><li key={event.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm">
              <div><code className="break-all">{event.id}</code><p>{event.result} · {event.attempts} attempts · {timestamp(event.finished)}</p></div>
              <button type="button" className="btn-ghost" disabled={busy} onClick={()=>setSelected(event.id)}>Review replay</button>
            </li>)}
          </ul>
          {selected && <div className="rounded border p-3 text-sm">
            <p>Requeue event <code className="break-all">{selected}</code>? Expired or out-of-order events will be acknowledged without changing live telemetry.</p>
            <button type="button" className="btn-primary mt-2" disabled={busy} onClick={()=>void replay()}>Confirm replay</button>
            <button type="button" className="btn-ghost ml-2" disabled={busy} onClick={()=>setSelected('')}>Cancel</button>
          </div>}
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Replay audit</h2>
          {!status.replays.length && <p className="text-sm">No replays recorded.</p>}
          <ul className="divide-y">{status.replays.map((event,index)=><li key={`${event.event_id}:${event.at}:${index}`} className="break-all py-2 text-sm">
            <code>{event.event_id}</code> · {timestamp(event.at)} · Operator {event.actor}
          </li>)}</ul>
        </section>
      </>}
    </div>
  </DashboardLayout>;
}
