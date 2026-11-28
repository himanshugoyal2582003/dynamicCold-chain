'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { ErrorAlert, Spinner } from '@/components/ui/shared';
import { apiFetch } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';

type Fleet = { id: string; name: string };
type Truck = {
  id: string; plate: string; issue: string | null; capacityTons: number; targetC: number;
  usableTons: number | null; healthScore: number | null; severity: string | null;
  cargoTypes: string[] | null; costPerKm: number | null; currency: string | null;
  latitude: number | null; longitude: number | null; synthetic: boolean | null;
};
type Shipment = {
  id: string; reference: string; cargoType: string; weightTons: number; origin: string; destination: string;
  deadline: string; shelfLifeUntil: string; priority: string; synthetic: boolean;
};
type Resources = { trucks: Truck[]; shipments: Shipment[]; truncated: boolean };
type Choice = {
  shipmentId: string; truckId: string; distanceKm: number; deadheadKm: number; durationSeconds: number;
  deliveryAt: string; cost: number; reserveMinutes: number; reserveConsumed: number; healthScore: number;
  score: number; token?: string | null; components: Record<string, number>;
};
type Summary = {
  assigned: number; distanceKm: number; durationMinutes: number; cost: number; score: number;
  selectedUtilization: number; priorities: Record<string, number>; choices: Choice[];
};
type Plan = {
  synthetic: boolean; currency: string; quoteExpiresAt: string; optimized: Summary; baseline: Summary;
  rankings: { shipmentId: string; options: Choice[]; unassigned: boolean; reasons: string[] }[];
};

const format = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 2 });
const date = (value: string) => new Date(value).toLocaleString();

function coordinateFields(prefix: string, label: string, latitude?: number | null, longitude?: number | null) {
  return <div className="grid grid-cols-2 gap-2">
    <label className="text-sm">{label} latitude
      <input name={`${prefix}Lat`} className="input-field w-full" type="number" min="-90" max="90" step="0.000001" defaultValue={latitude ?? undefined} required />
    </label>
    <label className="text-sm">{label} longitude
      <input name={`${prefix}Lng`} className="input-field w-full" type="number" min="-180" max="180" step="0.000001" defaultValue={longitude ?? undefined} required />
    </label>
  </div>;
}

function ShipmentForm({ busy, submit }: { busy: boolean; submit: (body: unknown) => Promise<boolean> }) {
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const text = (key: string) => String(values.get(key));
    const success = await submit({
      reference:text('reference'),cargoType:text('cargoType'),weightTons:Number(values.get('weightTons')),
      origin:text('origin'),destination:text('destination'),originLat:Number(values.get('originLat')),
      originLng:Number(values.get('originLng')),destinationLat:Number(values.get('destinationLat')),
      destinationLng:Number(values.get('destinationLng')),deadline:new Date(text('deadline')).toISOString(),
      shelfLifeUntil:new Date(text('shelfLifeUntil')).toISOString(),handlingMinutes:Number(values.get('handlingMinutes')),
      priority:text('priority'),synthetic:values.has('synthetic'),
    });
    if (success) form.reset();
  }
  return <form onSubmit={save}>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm">Shipment reference<input name="reference" className="input-field w-full" maxLength={80} required /></label>
      <label className="text-sm">Cargo type<input name="cargoType" className="input-field w-full" maxLength={100} required /></label>
      <label className="text-sm">Shipment weight (t)<input name="weightTons" className="input-field w-full" type="number" min="0.01" max="999.99" step="0.01" required /></label>
      <label className="text-sm">Priority<select name="priority" className="input-field w-full" defaultValue="standard"><option value="standard">Standard</option><option value="high">High</option><option value="critical">Critical</option></select></label>
      <label className="text-sm">Pickup address<input name="origin" className="input-field w-full" maxLength={255} required /></label>
      <label className="text-sm">Delivery address<input name="destination" className="input-field w-full" maxLength={255} required /></label>
      {coordinateFields('origin','Pickup')}
      {coordinateFields('destination','Delivery')}
      <label className="text-sm">Delivery deadline (local time)<input name="deadline" className="input-field w-full" type="datetime-local" required /></label>
      <label className="text-sm">Shelf-life cutoff at nominal conditions (local time)<input name="shelfLifeUntil" className="input-field w-full" type="datetime-local" required /></label>
      <label className="text-sm">Total handling time (min)<input name="handlingMinutes" className="input-field w-full" type="number" min="0" max="240" required /></label>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="synthetic" defaultChecked /> Synthetic shipment</label>
      <button type="submit" className="btn-primary justify-self-start">Add pending shipment</button>
    </fieldset>
  </form>;
}

function ProfileForm({ truck, busy, submit }: { truck: Truck; busy: boolean; submit: (body: unknown) => Promise<boolean> }) {
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    void submit({
      cargoTypes:String(values.get('cargoTypes')).split(',').map(value=>value.trim()).filter(Boolean),
      usableTons:Number(values.get('usableTons')),targetC:truck.targetC,costPerKm:Number(values.get('costPerKm')),currency:values.get('currency'),
      latitude:Number(values.get('dispatchLat')),longitude:Number(values.get('dispatchLng')),
      synthetic:values.has('synthetic'),confirmed:values.has('confirmed'),
    });
  }
  return <form className="space-y-3" onSubmit={save}>
    <p className="text-sm text-slate-600">Confirm the dispatch position, rates and compatible cargo for {truck.plate} at its current setpoint of {truck.targetC} °C. Reconfirm after 30 minutes or a setpoint change.</p>
    <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-2">
      <label className="text-sm sm:col-span-2">Compatible cargo types (comma-separated)
        <input name="cargoTypes" className="input-field w-full" defaultValue={truck.cargoTypes?.join(', ')} required />
      </label>
      <label className="text-sm">Verified usable capacity (t)
        <input name="usableTons" className="input-field w-full" type="number" min="0.01" max={truck.capacityTons} step="0.01" defaultValue={truck.usableTons ?? undefined} required />
      </label>
      <label className="text-sm">Transportation rate per km
        <input name="costPerKm" className="input-field w-full" type="number" min="0.0001" max="100000" step="0.0001" defaultValue={truck.costPerKm ?? undefined} required />
      </label>
      <label className="text-sm">Profile currency
        <input name="currency" className="input-field w-full" pattern="[A-Z]{3}" defaultValue={truck.currency ?? 'INR'} required />
      </label>
      {coordinateFields('dispatch','Dispatch',truck.latitude,truck.longitude)}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="synthetic" defaultChecked={truck.synthetic ?? true} /> Synthetic truck profile</label>
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" name="confirmed" required /> I confirm the position, usable capacity, compatibility and rate for this plan.</label>
      <button type="submit" className="btn-primary justify-self-start">Save dispatch profile</button>
    </fieldset>
  </form>;
}

function AllocationResults({ plan, resources, busy, approve }: {
  plan: Plan; resources: Resources; busy: boolean; approve: (token: string) => void;
}) {
  const [review, setReview] = useState<Choice | null>(null);
  const [checked, setChecked] = useState(false);
  const truckName = (id: string) => resources.trucks.find(item=>item.id===id)?.plate ?? id;
  const shipmentName = (id: string) => resources.shipments.find(item=>item.id===id)?.reference ?? id;
  const money = (amount: number) => `${plan.currency} ${format(amount)}`;
  const comparison = [{label:'Optimized',run:plan.optimized},{label:'Greedy',run:plan.baseline}];
  return <>
    <section className="card space-y-4">
      <h2 className="text-lg font-semibold">Allocation comparison</h2>
      {plan.synthetic && <p className="rounded bg-amber-50 p-2 text-sm text-amber-900">Synthetic planning run. Trip approval is disabled.</p>}
      <div className="overflow-x-auto"><table className="data-table w-full">
        <thead><tr><th>Plan</th><th>Assigned</th><th>Critical / high</th><th>Distance</th><th>Aggregate time</th><th>Transport cost</th><th>Objective score</th></tr></thead>
        <tbody>{comparison.map(({label,run})=><tr key={label}><th scope="row">{label}</th><td>{run.assigned}</td><td>{run.priorities.critical} / {run.priorities.high}</td><td>{format(run.distanceKm)} km</td><td>{format(run.durationMinutes)} min</td><td>{money(run.cost)}</td><td>{run.score}</td></tr>)}</tbody>
      </table></div>
      <p className="text-sm text-slate-600">Compare costs and scores together with shipment coverage and priority.</p>
      <div className="space-y-2" aria-label="Selected fleet utilization">
        {comparison.map(({label,run})=><div key={label} className="grid grid-cols-[6rem_1fr_4rem] items-center gap-2 text-sm">
          <span>{label}</span><meter className="w-full" aria-label={`${label} selected fleet utilization`} min={0} max={100} value={run.selectedUtilization} />
          <span>{run.selectedUtilization}%</span>
        </div>)}
      </div>
      <details><summary className="cursor-pointer text-sm font-semibold">Greedy assignments</summary>
        <ul className="mt-2 text-sm">{plan.baseline.choices.map(choice=><li key={choice.shipmentId}>{shipmentName(choice.shipmentId)} → {truckName(choice.truckId)}</li>)}</ul>
      </details>
    </section>
    <section className="card space-y-3">
      <h2 className="text-lg font-semibold">Recommendations</h2>
      {!plan.synthetic && <p className="text-sm text-slate-600">Approval quotes expire at {date(plan.quoteExpiresAt)}. Estimates assume immediate dispatch.</p>}
      {plan.rankings.map(ranking=>{
        const recommendation = plan.optimized.choices.find(item=>item.shipmentId===ranking.shipmentId);
        const first = ranking.options[0];
        return <article key={ranking.shipmentId} className="space-y-2 rounded border border-slate-200 p-3">
          <h3 className="font-semibold">{shipmentName(ranking.shipmentId)}</h3>
          {recommendation ? <>
            <p className="text-sm"><strong>{truckName(recommendation.truckId)}</strong> · ETA {date(recommendation.deliveryAt)} · {format(recommendation.durationSeconds/60)} min · {format(recommendation.distanceKm)} km · {money(recommendation.cost)}</p>
            <p className="text-sm">Shelf-life reserve {format(recommendation.reserveMinutes)} min ({format(recommendation.reserveConsumed*100)}% used) · equipment health {recommendation.healthScore}/100</p>
            {first?.truckId !== recommendation.truckId && <p className="text-sm text-slate-600">The fleet-wide solution assigned a different truck than the lowest individual pair score.</p>}
            {recommendation.token && <button type="button" className="btn-primary" disabled={busy} onClick={()=>{setReview(recommendation);setChecked(false);}}>Review assignment</button>}
          </> : <p className="text-sm font-semibold text-red-800">{ranking.options.length ? 'Unassigned after competing for the same eligible trucks.' : 'Infeasible in this plan.'}</p>}
          <details className="text-sm"><summary className="cursor-pointer font-semibold">Truck ranking and exclusions</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5">{ranking.options.map(option=><li key={option.truckId}>
              {truckName(option.truckId)} · score {option.score} · {money(option.cost)} · {format(option.deadheadKm)} km to pickup · {format(option.reserveMinutes)} min reserve · health {option.healthScore}/100
              <span className="block text-slate-600">{Object.entries(option.components).map(([key,value])=>`${key} ${value}`).join(' · ')}</span>
            </li>)}</ol>
            {ranking.reasons.length > 0 && <ul className="mt-2 list-disc pl-5">{ranking.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul>}
          </details>
        </article>;
      })}
      {review?.token && <form onSubmit={event=>{event.preventDefault();if(checked && review.token) approve(review.token);}} className="space-y-2 rounded border border-amber-300 bg-amber-50 p-3">
        <p className="font-semibold">Assign {shipmentName(review.shipmentId)} to {truckName(review.truckId)}</p>
        <label className="block text-sm"><input type="checkbox" checked={checked} onChange={event=>setChecked(event.target.checked)} required /> I approve creating this trip assignment.</label>
        <div className="flex gap-2"><button type="submit" className="btn-primary" disabled={busy || !checked}>Approve and assign trip</button>
          <button type="button" className="btn-ghost" onClick={()=>setReview(null)} disabled={busy}>Cancel review</button></div>
      </form>}
    </section>
  </>;
}

export default function FleetDashboard({ role }: { role: 'admin' | 'owner' }) {
  const {user,loading} = useAuth();
  const allowed = user?.role===role;
  const userId = user?.sub;
  const [fleets,setFleets] = useState<Fleet[] | null>(null);
  const [owner,setOwner] = useState('');
  const [resources,setResources] = useState<Resources | null>(null);
  const [truckIds,setTruckIds] = useState<string[]>([]);
  const [shipmentIds,setShipmentIds] = useState<string[]>([]);
  const [editTruck,setEditTruck] = useState('');
  const [currency,setCurrency] = useState('INR');
  const [plan,setPlan] = useState<Plan | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [notice,setNotice] = useState('');
  const endpoint = `/api/fleet-optimization/fleets/${owner}`;

  useEffect(()=>{
    if (!allowed) return;
    const controller = new AbortController();
    apiFetch<{ fleets: Fleet[] }>('/api/fleet-optimization/fleets',{signal:controller.signal}).then(({fleets:rows})=>{
      if (controller.signal.aborted) return;
      setFleets(rows);
      setOwner(rows.length===1 ? rows[0].id : '');
    },error=>{if(!controller.signal.aborted) setError(error.message);});
    return ()=>controller.abort();
  },[allowed,userId]);

  useEffect(()=>{
    setResources(null);
    setTruckIds([]);
    setShipmentIds([]);
    setEditTruck('');
    setPlan(null);
    setError('');
    setNotice('');
    if (!allowed || !owner) return;
    const controller = new AbortController();
    apiFetch<Resources>(endpoint,{signal:controller.signal}).then(data=>{
      if(!controller.signal.aborted) setResources(data);
    },error=>{if(!controller.signal.aborted) setError(error.message);});
    return ()=>controller.abort();
  },[allowed,endpoint,owner]);

  async function perform(action: () => Promise<void>) {
    if (busy) return false;
    setBusy(true);
    setError('');
    setNotice('');
    try { await action(); return true; }
    catch (error) { setError(error instanceof Error ? error.message : 'Request failed'); return false; }
    finally { setBusy(false); }
  }

  async function refreshResources() {
    const data = await apiFetch<Resources>(endpoint);
    setResources(data);
    setTruckIds(ids=>ids.filter(id=>data.trucks.some(item=>item.id===id)));
    setShipmentIds(ids=>ids.filter(id=>data.shipments.some(item=>item.id===id)));
  }

  function save(path: string, method: string, body: unknown, message: string) {
    return perform(async ()=>{
      await apiFetch(endpoint+path,{method,body:JSON.stringify(body)});
      setPlan(null);
      setNotice(message);
      await refreshResources();
    });
  }

  function toggle(id: string, values: string[], setValues: (ids: string[])=>void) {
    setPlan(null);
    setValues(values.includes(id) ? values.filter(value=>value!==id) : [...values,id]);
  }

  if (loading || !allowed) return null;
  const profileTruck = resources?.trucks.find(truck=>truck.id===editTruck);
  return <DashboardLayout title="Fleet Optimization" roleLabel={role==='admin' ? 'Administrator' : 'Fleet Owner'} navItems={[
    {href:`/${role}`,label:'Overview',icon:''},{href:`/${role}/trips`,label:'Trips',icon:''},
    {href:`/${role}/tracking`,label:'Tracking',icon:''},
  ]}>
    <div className="space-y-4">
      <p className="card text-sm">Plan one shipment per truck. Use verified dispatch inputs and review the allocation before creating a trip. Shelf-life reserve is a planning estimate at nominal conditions.</p>
      {error && <ErrorAlert message={error} />}
      {notice && <p className="card text-sm text-emerald-800" role="status">{notice}</p>}
      {!fleets && !error && <Spinner />}
      {fleets && <div className="text-sm">
        <label htmlFor="optimization-fleet">Fleet</label>
        <select id="optimization-fleet" className="input-field ml-2" value={owner} disabled={busy || fleets.length===1} onChange={event=>setOwner(event.target.value)}>
          <option value="">{fleets.length ? 'Select a fleet' : 'No accessible fleets'}</option>
          {fleets.map(fleet=><option key={fleet.id} value={fleet.id}>{fleet.name}</option>)}
        </select>
      </div>}
      {owner && !resources && !error && <Spinner />}
      {resources && <>
        <details className="card"><summary className="cursor-pointer font-semibold">Add shipment</summary>
          <div className="mt-3"><ShipmentForm busy={busy} submit={body=>save('/shipments','POST',body,'Shipment added.')} /></div>
        </details>
        <section className="card space-y-3">
          <h2 className="text-lg font-semibold">Pending shipments</h2>
          <div className="overflow-x-auto"><table className="data-table w-full">
            <thead><tr><th>Use</th><th>Shipment</th><th>Cargo</th><th>Route</th><th>Priority</th><th>Deadline</th></tr></thead>
            <tbody>{resources.shipments.map(shipment=><tr key={shipment.id}>
              <td><input type="checkbox" aria-label={`Select shipment ${shipment.reference}`} checked={shipmentIds.includes(shipment.id)} disabled={busy || (shipmentIds.length>=12 && !shipmentIds.includes(shipment.id))} onChange={()=>toggle(shipment.id,shipmentIds,setShipmentIds)} /></td>
              <td>{shipment.reference}{shipment.synthetic && ' (synthetic)'}</td><td>{shipment.cargoType} · {shipment.weightTons} t</td>
              <td>{shipment.origin} → {shipment.destination}</td><td>{shipment.priority}</td><td>{date(shipment.deadline)}</td>
            </tr>)}</tbody>
          </table></div>
          {!resources.shipments.length && <p className="text-sm">No pending shipments.</p>}
        </section>
        <section className="card space-y-3">
          <h2 className="text-lg font-semibold">Fleet trucks</h2>
          <div className="overflow-x-auto"><table className="data-table w-full">
            <thead><tr><th>Use</th><th>Truck</th><th>Usable capacity</th><th>Health</th><th>Readiness</th><th>Profile</th></tr></thead>
            <tbody>{resources.trucks.map(truck=><tr key={truck.id}>
              <td><input type="checkbox" aria-label={`Select truck ${truck.plate}`} checked={truckIds.includes(truck.id)} disabled={busy || (truckIds.length>=12 && !truckIds.includes(truck.id))} onChange={()=>toggle(truck.id,truckIds,setTruckIds)} /></td>
              <td>{truck.plate}{truck.synthetic && ' (synthetic)'}</td><td>{truck.usableTons===null ? 'Unverified' : `${truck.usableTons} t`}</td>
              <td>{truck.healthScore===null ? 'Unavailable' : `${truck.healthScore}/100 · ${truck.severity}`}</td>
              <td>{truck.issue ?? 'Available'}</td><td><button type="button" className="btn-ghost" disabled={busy} onClick={()=>setEditTruck(truck.id)}>Edit profile</button></td>
            </tr>)}</tbody>
          </table></div>
          {!resources.trucks.length && <p className="text-sm">No active trucks.</p>}
          {profileTruck && <ProfileForm key={profileTruck.id} truck={profileTruck} busy={busy} submit={body=>save(`/trucks/${profileTruck.id}/profile`,'PUT',body,'Dispatch profile saved.').then(ok=>{if(ok)setEditTruck('');return ok;})} />}
          {resources.truncated && <p className="text-sm">Showing up to the first 100 trucks and pending shipments.</p>}
        </section>
        <section className="card flex flex-wrap items-end gap-3">
          <label className="text-sm">Plan currency<input className="input-field block" value={currency} maxLength={3} disabled={busy} onChange={event=>{setCurrency(event.target.value.toUpperCase());setPlan(null);}} /></label>
          <button type="button" className="btn-primary" disabled={busy || !truckIds.length || !shipmentIds.length || !/^[A-Z]{3}$/.test(currency)} onClick={()=>void perform(async()=>{
            setPlan(null);
            setPlan(await apiFetch<Plan>(endpoint+'/plan',{method:'POST',body:JSON.stringify({truckIds,shipmentIds,currency})}));
          })}>{busy ? 'Working…' : 'Compare allocations'}</button>
          <span className="text-sm">{shipmentIds.length}/12 shipments · {truckIds.length}/12 trucks</span>
        </section>
        {plan && <AllocationResults plan={plan} resources={resources} busy={busy} approve={token=>void save('/approve','POST',{quote:token,confirmed:true},'Trip assigned. Open Trips to inspect it.')} />}
      </>}
      <p className="flex flex-wrap gap-4 text-sm"><Link className="underline" href={`/${role}/maintenance`}>Equipment assessments</Link>
        <Link className="underline" href={`/${role}/digital-twin`}>Thermal what-if scenarios</Link>
        <Link className="underline" href={`/${role}/trips`}>Trips and cargo rescue</Link></p>
    </div>
  </DashboardLayout>;
}
