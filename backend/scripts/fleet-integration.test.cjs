const assert = require('node:assert/strict');
const { test } = require('node:test');
const jwt = require('jsonwebtoken');
const { makeFleetFixture } = require('./fleet-test-fixture.cjs');

test('fleet planning and guarded approval through Nest HTTP and isolated PostgreSQL',async t=>{
  const f=await makeFleetFixture();
  t.after(f.close);
  const host=await f.app.getUrl();
  const root='/api/fleet-optimization/fleets';
  async function call(actor,path='',body,options={}) {
    const headers={};
    if (actor) headers.Cookie='coldchain_token='+jwt.sign(actor,process.env.JWT_SECRET)+'; coldchain_csrf=fixture';
    if (actor && !options.noCsrf) headers['X-CSRF-Token']='fixture';
    if (body!==undefined) headers['Content-Type']='application/json';
    const response=await fetch(host+root+path,{headers,method:options.method ?? (body===undefined?'GET':'POST'),
      body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  }
  const ownerPath='/'+f.owner.sub;
  const syntheticPlan={shipmentIds:[f.critical,f.frozen,f.oversized],truckIds:[f.versatile.id,f.dairy.id,f.blocked.id],currency:'INR'};
  const approvalPlan={shipmentIds:[f.approval],truckIds:[f.operational.id],currency:'INR'};
  async function operationalQuote() {
    const result=await call(f.owner,ownerPath+'/plan',approvalPlan);
    assert.equal(result.status,200,JSON.stringify(result.data));
    const quote=result.data.optimized.choices[0]?.token;
    assert.ok(quote);
    return quote;
  }

  await t.test('cookie auth, CSRF, live role, tenant boundaries and strict request shapes',async()=>{
    assert.equal((await call(null)).status,401);
    assert.equal((await call(f.operational.driver)).status,403);
    assert.equal((await call(f.outsider,ownerPath)).status,404);
    assert.deepEqual((await call(f.owner)).data.fleets.map(row=>row.id),[f.owner.sub]);
    assert.equal((await call(f.admin)).data.fleets.length,2);
    await f.query("UPDATE users SET role='owner' WHERE id=$1",[f.admin.sub]);
    assert.equal((await call(f.admin,ownerPath)).status,404);
    await f.query("UPDATE users SET role='admin' WHERE id=$1",[f.admin.sub]);
    assert.equal((await call(f.owner,ownerPath+'/plan',syntheticPlan,{noCsrf:true})).status,403);
    assert.equal((await call(f.owner,ownerPath+'/plan',{...syntheticPlan,truckIds:[f.foreign.id]})).status,404);
    assert.equal((await call(f.owner,ownerPath+'/plan',{...syntheticPlan,shipmentIds:[f.foreignShipment]})).status,404);
    assert.equal((await call(f.owner,ownerPath+'/plan',{...syntheticPlan,force:true})).status,400);
    assert.equal((await call(f.owner,ownerPath+'/plan',{...syntheticPlan,shipmentIds:[f.critical,f.approval]})).status,400);
    assert.equal(f.routeCalls(),0);
  });

  await t.test('persistent verified inputs, duplicate references and profiles follow their owning fleet',async()=>{
    const created=await call(f.owner,ownerPath+'/shipments',f.body('TEST-CREATED'));
    assert.equal(created.status,201);
    assert.equal((await call(f.owner,ownerPath+'/shipments',f.body('TEST-CREATED'))).status,409);
    const profile={cargoTypes:['Dairy'],usableTons:5,targetC:4,costPerKm:21,currency:'INR',latitude:27.95,longitude:77,synthetic:true,confirmed:true};
    const path=ownerPath+'/trucks/'+f.dairy.id+'/profile';
    assert.equal((await call(f.owner,path,{...profile,usableTons:7},{method:'PUT'})).status,409);
    assert.equal((await call(f.owner,path,{...profile,targetC:5},{method:'PUT'})).status,409);
    assert.equal((await call(f.owner,path,profile,{method:'PUT'})).status,200);
    assert.equal((await call(f.owner,ownerPath+'/trucks/'+f.foreign.id+'/profile',profile,{method:'PUT'})).status,409);
    await f.query('UPDATE trucks SET owner_id=$1 WHERE id=$2',[f.outsider.sub,f.dairy.id]);
    const other=await call(f.outsider,'/'+f.outsider.sub);
    assert.equal(other.data.trucks.find(truck=>truck.id===f.dairy.id).cargoTypes,null);
    await f.query('UPDATE trucks SET owner_id=$1 WHERE id=$2',[f.owner.sub,f.dairy.id]);
  });

  await t.test('optimized coverage, health and weight exclusions, missing routes and no planning writes',async()=>{
    const planned=await call(f.owner,ownerPath+'/plan',syntheticPlan);
    assert.equal(planned.status,200,JSON.stringify(planned.data));
    assert.equal(planned.data.synthetic,true);
    assert.equal(planned.data.optimized.assigned,2);
    assert.equal(planned.data.baseline.assigned,1);
    assert.equal(planned.data.optimized.choices.find(edge=>edge.shipmentId===f.frozen).truckId,f.versatile.id);
    assert.ok(planned.data.optimized.choices.every(edge=>edge.token===null));
    assert.ok(planned.data.rankings.find(row=>row.shipmentId===f.oversized).reasons.includes('Shipment exceeds verified truck capacity'));
    assert.ok(planned.data.rankings[0].reasons.includes('Maintenance severity blocks dispatch'));
    const missing=await f.insert(f.body('TEST-NO-ROUTE',{destinationLat:29}));
    const noRoute=await call(f.owner,ownerPath+'/plan',{...syntheticPlan,shipmentIds:[missing]});
    assert.ok(noRoute.data.rankings[0].reasons.includes('Road route unavailable'));
    const cutoff=await f.insert(f.body('TEST-CUTOFF',{shelfLifeUntil:new Date(Date.now()+120_000).toISOString()}));
    const timed=await call(f.owner,ownerPath+'/plan',{...syntheticPlan,shipmentIds:[cutoff]});
    assert.ok(timed.data.rankings[0].reasons.includes('Estimated delivery exhausts shelf-life reserve'));
    assert.deepEqual(await f.query('SELECT id FROM trips'),[]);
    assert.deepEqual(await f.query('SELECT id FROM rescue_events'),[]);
    assert.deepEqual(await f.query('SELECT truck_id FROM trip_telemetry_history'),[]);
  });

  await t.test('quote binding, explicit approval, changed health and one trip on concurrent retries',async()=>{
    const path=ownerPath+'/approve';
    let quote=await operationalQuote();
    assert.equal((await call(f.owner,path,{quote,confirmed:false})).status,400);
    assert.equal((await call(f.admin,path,{quote,confirmed:true})).status,409);
    assert.equal((await call(f.owner,path,{quote:quote+'x',confirmed:true})).status,409);
    await f.query('UPDATE trucks SET target_temp_c=5 WHERE id=$1',[f.operational.id]);
    assert.equal((await call(f.owner,path,{quote,confirmed:true})).status,409);
    const wrongSetpoint=await call(f.owner,ownerPath+'/plan',approvalPlan);
    assert.ok(wrongSetpoint.data.rankings[0].reasons.includes('Truck setpoint changed since confirmation'));
    await f.query('UPDATE trucks SET target_temp_c=4 WHERE id=$1',[f.operational.id]);
    await f.query("INSERT INTO maintenance_assessments VALUES($1,now(),now(),'TEST-sensor',$2,'fixture',4,40,'critical',null,'[]',0)",[f.operational.id,f.operational.pair]);
    assert.equal((await call(f.owner,path,{quote,confirmed:true})).status,409);
    await f.query("DELETE FROM maintenance_assessments WHERE truck_id=$1 AND severity='critical'",[f.operational.id]);
    quote=await operationalQuote();
    await f.query('UPDATE fleet_dispatch_profiles SET revision=revision+1 WHERE truck_id=$1',[f.operational.id]);
    assert.equal((await call(f.owner,path,{quote,confirmed:true})).status,409);
    quote=await operationalQuote();
    const results=await Promise.all([call(f.owner,path,{quote,confirmed:true}),call(f.owner,path,{quote,confirmed:true})]);
    assert.deepEqual(results.map(result=>result.status).sort(),[201,409],JSON.stringify(results));
    const trip=results.find(result=>result.status===201).data.trip;
    assert.equal(trip.status,'ASSIGNED');
    assert.equal(trip.truck_id,f.operational.id);
    assert.equal((await f.query('SELECT trip_id FROM fleet_shipments WHERE id=$1',[f.approval]))[0].trip_id,trip.id);
    assert.equal((await f.query("SELECT count(*)::int AS n FROM activity_log WHERE action='TRIP_ASSIGNED'"))[0].n,1);
    assert.deepEqual(f.broadcasts,[{id:trip.id,event:'trip:assigned'}]);
  });

  await t.test('existing manual trip assignment keeps its independent workflow',async()=>{
    const actor=f.outsider;
    const response=await fetch(host+'/api/trips',{
      method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':'fixture',
        Cookie:'coldchain_token='+jwt.sign(actor,process.env.JWT_SECRET)+'; coldchain_csrf=fixture'},
      body:JSON.stringify({truck_id:f.foreign.id,user_id:f.foreign.driver.sub,
        origin:'TEST manual pickup',destination:'TEST manual delivery',cargo_type:'Dairy'}),
    });
    assert.equal(response.status,201,await response.clone().text());
    const {trip}=await response.json();
    assert.equal(trip.status,'ASSIGNED');
    assert.equal((await f.query('SELECT trip_id FROM fleet_shipments WHERE id=$1',[f.foreignShipment]))[0].trip_id,null);
  });
});
