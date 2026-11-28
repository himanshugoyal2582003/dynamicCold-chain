'use client';

import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { ErrorAlert, Spinner } from '@/components/ui/shared';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

const endpoint='/api/insurance-signals';
type Trip={id:string;plate_number:string;started_at:string;status:string};
type Case={id:string;trip_id:string;assessed_at:string;status:string;revision:number;plate_number:string;assessment:{
  version:string;score:number;classification:string;gpsSamples:number;sensorSamples:number;truncated:boolean;
  signals:{code:string;value:number;points:number}[];
}};
type Review={revision:number;actor_id:string;status:string;note:string;reviewed_at:string};
const statuses:Record<string,string>={pending:'Pending review',follow_up:'Needs follow-up',explained:'Explained',
  insufficient_evidence:'Insufficient evidence'};
const names:Record<string,string>={gps_jump:'Implausible GPS jumps',conflicting_observation:'Conflicting readings at the same timestamp',
  duplicate_observation:'Repeated snapshot timestamps',joint_sensor_flatline_minutes:'Joint temperature and humidity flatline (min)',
  temperature_excursion_minutes:'Temperature excursion (min)'};

export default function InsuranceSignalsPage() {
  const {user,loading}=useAuth();
  const [data,setData]=useState<{trips:Trip[];cases:Case[]}|null>(null);
  const [trip,setTrip]=useState('');
  const [selection,setSelection]=useState('');
  const [status,setStatus]=useState('follow_up');
  const [note,setNote]=useState('');
  const [reviews,setReviews]=useState<Review[]|null>(null);
  const [error,setError]=useState('');
  const [notice,setNotice]=useState('');
  const [busy,setBusy]=useState(false);
  const selected=data?.cases.find(item=>item.id===selection);

  useEffect(()=>{
    if (user?.role!=='admin') return;
    const abort=new AbortController();
    apiFetch<{trips:Trip[];cases:Case[]}>(endpoint,{signal:abort.signal}).then(
      rows=>{if(!abort.signal.aborted)setData(rows);},
      err=>{if(!abort.signal.aborted)setError(err.message);});
    return ()=>abort.abort();
  },[user?.role,user?.sub]);

  useEffect(()=>{
    setReviews(null);
    setNote('');
    if (!selected || user?.role!=='admin') return;
    const abort=new AbortController();
    apiFetch<{reviews:Review[]}>(`${endpoint}/${selected.id}/reviews`,{signal:abort.signal}).then(
      data=>{if(!abort.signal.aborted)setReviews(data.reviews);},
      err=>{if(!abort.signal.aborted)setError(err.message);});
    return ()=>abort.abort();
  },[selected?.id,selected?.revision,user?.role]);

  async function submit(path:string,body:unknown,message:string) {
    setBusy(true);setError('');setNotice('');
    try {
      const created=await apiFetch<{id?:string}>(endpoint+path,{method:'POST',body:JSON.stringify(body)});
      setData(await apiFetch(endpoint));
      if(created.id) setSelection(created.id);
      setNotice(message);
    } catch(err) {setError(err instanceof Error ? err.message:'Request failed');}
    finally {setBusy(false);}
  }

  if(loading || user?.role!=='admin') return null;
  return <DashboardLayout title="Insurance Signal Review" roleLabel="Administrator" navItems={[
    {href:'/admin',label:'Overview',icon:''},{href:'/admin/insurance',label:'Insurance',icon:''},
  ]}>
    <div className="space-y-4">
      <p className="card text-sm">These rules flag patterns for investigation. Sensor faults, GPS errors and routine operations can produce flags. Scores are advisory and have no effect on claims or premiums.</p>
      {error && <ErrorAlert message={error}/>}
      {notice && <p role="status" className="card text-sm">{notice}</p>}
      {!data && !error && <Spinner/>}
      {data && <>
        <section className="card space-y-3">
          <h2 className="font-semibold">Assess recent trip evidence</h2>
          <label htmlFor="signal-trip" className="block text-sm">Started trip</label>
          <select id="signal-trip" className="input-field w-full" disabled={busy} value={trip} onChange={event=>setTrip(event.target.value)}>
            <option value="">Select a trip</option>
            {data.trips.filter(tr=>!data.cases.some(item=>item.trip_id===tr.id)).map(tr=><option key={tr.id} value={tr.id}>
              {tr.plate_number} · {new Date(tr.started_at).toLocaleString()} · {tr.status}
            </option>)}
          </select>
          <button type="button" className="btn-primary" disabled={!trip || busy} onClick={()=>void submit('/trips/'+trip+'/case',{},'Assessment stored for review.')}>Assess trip</button>
        </section>
        <section className="card space-y-3">
          <h2 className="font-semibold">Recent cases</h2>
          {!data.cases.length && <p className="text-sm">No cases recorded.</p>}
          <ul className="divide-y">{data.cases.map(item=><li key={item.id} className="py-2 text-sm">
            <button type="button" className="text-blue-800 underline" disabled={busy} onClick={()=>setSelection(item.id)}>
              {item.plate_number} · {new Date(item.assessed_at).toLocaleString()} · {statuses[item.status]}
            </button>
          </li>)}</ul>
        </section>
      </>}
      {selected && <section className="card space-y-3 text-sm">
        <h2 className="font-semibold">{selected.plate_number} review</h2>
        <p>Advisory score {selected.assessment.score}/100 · {selected.assessment.classification.replaceAll('_',' ')} · {selected.assessment.version}</p>
        <p>{selected.assessment.gpsSamples} usable GPS readings · {selected.assessment.sensorSamples} usable sensor samples{selected.assessment.truncated && ' · Sample window truncated'}</p>
        {selected.assessment.signals.length ? <ul className="list-disc pl-5">{selected.assessment.signals.map(signal=><li key={signal.code}>
          {names[signal.code] ?? signal.code} · {signal.value} · {signal.points} points
        </li>)}</ul> : <p>No rules contributed points in this sample.</p>}
        <form className="space-y-2" onSubmit={event=>{event.preventDefault();
          void submit('/'+selected.id+'/reviews',{status,note,revision:selected.revision},'Review decision recorded.');}}>
          <label className="block">Review status
            <select value={status} className="input-field block" onChange={event=>setStatus(event.target.value)}>
              {Object.entries(statuses).filter(([key])=>key!=='pending').map(([key,label])=><option key={key} value={key}>{label}</option>)}
            </select>
          </label>
          <label className="block">Evidence and review notes
            <textarea className="input-field block w-full" required minLength={3} maxLength={1000} value={note} onChange={event=>setNote(event.target.value)}/>
          </label>
          <button className="btn-primary" type="submit" disabled={busy}>Record review</button>
        </form>
        <h3 className="font-semibold">Review audit</h3>
        {reviews?.length ? <ul className="divide-y">{reviews.map(review=><li key={review.revision} className="py-2">
          <p>{statuses[review.status]} · {new Date(review.reviewed_at).toLocaleString()} · Reviewer {review.actor_id}</p>
          <p className="whitespace-pre-wrap break-words">{review.note}</p>
        </li>)}</ul> : <p>{reviews ? 'No human decisions yet.' : 'Loading review history…'}</p>}
      </section>}
    </div>
  </DashboardLayout>;
}
