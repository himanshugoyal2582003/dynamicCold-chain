'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { ErrorAlert } from '@/components/ui/shared';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

type Truck={id:string;plate_number:string};
type Telemetry={timestamp:string;received_at?:string;source?:string;model_type?:string;temperature:number;target_temp:number;
  humidity:number;door_open:boolean;spoilage_risk:number;shelf_life_remaining_hours:number;alert_message?:string};
type Assessment={severity:string;score:number|null;last_observed_at:string;model_version:string;factors:{code:string;points:number}[]};
type Trip={id:string;plate_number:string;status:string;truck_id:string};
type Rescue={severity:string;status:string;created_at:string;candidates:{id:string;warehouse_name:string;explanation?:string[]}[]};
type Result<T>={value:T|null;error?:string};

async function read<T>(path:string,signal:AbortSignal):Promise<Result<T>> {
  try {return {value:await apiFetch<T>(path,{signal})};}
  catch {return {value:null,error:'Source unavailable'};}
}
const date=(value:string) => new Date(value).toLocaleString();
const words=(value:string) => value.replaceAll('_',' ');

export default function IntelligenceDashboard({role}:{role:'owner'|'admin'}) {
  const {user,loading}=useAuth();
  const allowed=user?.role===role;
  const [trucks,setTrucks]=useState<Truck[]>([]);
  const [truck,setTruck]=useState('');
  const [error,setError]=useState('');
  const [telemetry,setTelemetry]=useState<Result<{telemetry:Telemetry|null}>|null>(null);
  const [maintenance,setMaintenance]=useState<Result<{assessments:Assessment[]}>|null>(null);
  const [rescue,setRescue]=useState<Result<Rescue[]>|null>(null);
  const base='/'+role;

  useEffect(()=>{
    if(!allowed) return;
    const abort=new AbortController();
    apiFetch<{trucks:Truck[]}>('/api/trips/resources',{signal:abort.signal}).then(
      data=>{if(!abort.signal.aborted)setTrucks(data.trucks);},
      error=>{if(!abort.signal.aborted)setError(error.message);});
    return ()=>abort.abort();
  },[allowed,user?.sub]);

  useEffect(()=>{
    setTelemetry(null);setMaintenance(null);setRescue(null);
    if(!allowed || !truck) return;
    const abort=new AbortController();
    const signal=abort.signal;
    void read<{telemetry:Telemetry|null}>('/api/iot/telemetry/'+truck,signal)
      .then(value=>{if(!signal.aborted)setTelemetry(value);});
    void read<{assessments:Assessment[]}>('/api/maintenance/trucks/'+truck+'/history',signal)
      .then(value=>{if(!signal.aborted)setMaintenance(value);});
    void read<{trips:Trip[]}>('/api/trips?'+new URLSearchParams({truckId:truck,status:'IN_PROGRESS'}),signal)
      .then(async ({value,error})=>{
        const active=value?.trips[0];
        if(signal.aborted)return;
        const result=active ? await read<Rescue[]>('/api/trips/'+active.id+'/rescue',signal) : {value:null,error};
        if(!signal.aborted)setRescue(result);
      });
    return ()=>abort.abort();
  },[allowed,truck]);

  if(loading || !allowed)return null;
  const reading=telemetry?.value?.telemetry;
  const assessment=maintenance?.value?.assessments[0];
  const event=rescue?.value?.[0];
  return <DashboardLayout title="Intelligence Explanations" roleLabel={role==='admin'?'Administrator':'Fleet Owner'} navItems={[
    {href:base,label:'Overview',icon:''},{href:base+'/trips',label:'Trips',icon:''},
  ]}>
    <div className="space-y-4">
      <section className="card space-y-2 text-sm">
        <p>Inspect recorded inputs, engineering rules and model assumptions. The spoilage LSTM does not expose feature attribution or confidence intervals.</p>
        <label htmlFor="intelligence-truck" className="block">Truck</label>
        <select id="intelligence-truck" className="input-field" value={truck} onChange={event=>setTruck(event.target.value)}>
          <option value="">Select a truck</option>
          {trucks.map(truck=><option key={truck.id} value={truck.id}>{truck.plate_number}</option>)}
        </select>
        {error && <ErrorAlert message={error}/>}
      </section>
      {truck && <div className="grid gap-4 md:grid-cols-2">
        <section className="card space-y-2 text-sm">
          <h2 className="font-semibold">Spoilage prediction and observed context</h2>
          {reading ? <>
            <p>{reading.model_type??'Model unavailable'} · reported source {reading.source??'unknown'} · observed {date(reading.timestamp)}</p>
            <p>{Date.now()-Date.parse(reading.timestamp)>120000 ? 'Stale observation' : 'Recent observation'} · Risk {Math.round(reading.spoilage_risk*100)}% · estimated shelf life {reading.shelf_life_remaining_hours} h</p>
            <p>Air {reading.temperature} °C · setpoint {reading.target_temp} °C · humidity {reading.humidity}% · presented door state {reading.door_open?'open':'closed'}</p>
            {reading.alert_message && <p>Operational advisory · {reading.alert_message}</p>}
            <p className="text-slate-600">The backend may apply temperature and door guardrails. Input values can include gateway defaults and sensor provenance does not establish physical-device identity.</p>
          </> : <p>{telemetry?.error || (telemetry ? 'No cached observation.' : 'Loading observation…')}</p>}
        </section>
        <section className="card space-y-2 text-sm">
          <h2 className="font-semibold"><Link className="underline" href={base+'/maintenance'}>Maintenance health</Link></h2>
          {assessment ? <>
            <p>{assessment.score ?? 'Unscored'} · {words(assessment.severity)} · {assessment.model_version} · observed {date(assessment.last_observed_at)}</p>
            <p>{Date.now()-Date.parse(assessment.last_observed_at)>900000?'Stale assessment':'Recent assessment'} · deterministic deductions</p>
            <ul className="list-disc pl-5">{assessment.factors.map((factor,i)=><li key={i}>{words(factor.code)} · {factor.points} points</li>)}</ul>
          </> : <p>{maintenance?.error || (maintenance ? 'No assessment recorded.' : 'Loading assessment…')}</p>}
        </section>
        <section className="card space-y-2 text-sm md:col-span-2">
          <h2 className="font-semibold"><Link className="underline" href={base+'/trips'}>Rescue recommendation factors</Link></h2>
          {event ? <>
            <p>{event.severity} · {words(event.status)} · evaluated {date(event.created_at)}</p>
            {event.candidates.map(candidate=><details key={candidate.id}><summary>{candidate.warehouse_name}</summary>
              <ul className="list-disc pl-5">{Array.isArray(candidate.explanation) && candidate.explanation.map((line,i)=><li key={i}>{line}</li>)}</ul>
            </details>)}
          </> : <p>{rescue?.error || (rescue ? 'No recorded recommendation for an open trip.' : 'Loading rescue context…')}</p>}
        </section>
      </div>}
      <section className="card grid gap-4 text-sm md:grid-cols-3">
        <div><h2 className="font-semibold"><Link className="underline" href={base+'/fleet-optimization'}>Fleet allocation</Link></h2><p>In each plan, expand the rankings for cost, distance, duration, shelf-life reserve and equipment deductions. Missing road estimates or unsuitable trucks remove pairings.</p></div>
        <div><h2 className="font-semibold"><Link className="underline" href={base+'/digital-twin'}>Digital Twin</Link></h2><p>What-if temperature and financial comparisons use operator-entered assumptions and a recent sensor seed. Model outputs are hypothetical and lack field calibration.</p></div>
        {role==='admin' && <div><h2 className="font-semibold"><Link className="underline" href="/admin/insurance-signals">Insurance signal review</Link></h2><p>Review case-specific rule contributions, sample coverage and human decisions. Scores do not determine fraud or change insurance outcomes.</p></div>}
      </section>
    </div>
  </DashboardLayout>;
}
