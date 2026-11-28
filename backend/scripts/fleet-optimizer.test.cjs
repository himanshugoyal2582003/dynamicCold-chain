const assert = require('node:assert/strict');
const { test } = require('node:test');
const { optimize, greedy } = require('../dist/fleet-optimization/optimizer');
const { planInput, profileInput, shipmentInput } = require('../dist/fleet-optimization/fleet-input');

const input = (ids) => ids.map((id,i) => ({ id, priority:['critical','high','standard'][i%3], deadline:'2030-01-01T00:00:00Z' }));
const edge = (shipmentId,truckId,score) => ({shipmentId,truckId,score});

test('augmenting paths reassign a flexible truck to cover the restricted load', () => {
  const shipments=input(['a','b']);
  const choices=[edge('a','X',1),edge('a','Y',10),edge('b','X',1)];
  assert.deepEqual(greedy(shipments,choices),[choices[0]]);
  assert.deepEqual(optimize(shipments,['X','Y'],choices),choices.slice(1));
});

test('maximizes cardinality before urgency and optimizes critical, then high, then score', () => {
  const shipments=input(['critical','high','standard']);
  const choices=[edge('critical','X',9999),edge('critical','Y',10000),edge('high','X',9999),edge('standard','Y',0)];
  const actual=optimize(shipments,['X','Y'],choices);
  assert.deepEqual(actual,[choices[1],choices[2]]);
  assert.deepEqual(optimize(shipments,['X','Y'],[]),[]);
});

test('matches brute force on 160 seeded sparse and dense assignment graphs', () => {
  let seed=9937;
  const next=max => ((seed=(Math.imul(seed,1664525)+1013904223)>>>0)%max);
  const shipments=input(['a','b','c','d']);
  const trucks=['1','2','3','4'];
  function objective(pairs) {
    return [pairs.length,...['critical','high'].map(priority=>pairs.filter(pair=>shipments.find(item=>item.id===pair.shipmentId).priority===priority).length),
      0-pairs.reduce((sum,pair)=>sum+pair.score,0)];
  }
  function better(a,b) {
    const different=a.findIndex((value,i)=>value!==b[i]);
    return different >= 0 && a[different] > b[different];
  }
  for (let trial=0; trial<160; trial++) {
    const edges=shipments.flatMap(shipment=>trucks.flatMap(truck=>next(11)<trial%11 ? [edge(shipment.id,truck,next(10001))] : []));
    let best=[0,0,0,0];
    function search(index,pairs) {
      if (index===shipments.length) {
        const value=objective(pairs);
        if (better(value,best)) best=value;
        return;
      }
      search(index+1,pairs);
      for (const candidate of edges.filter(item=>item.shipmentId===shipments[index].id && !pairs.some(pair=>pair.truckId===item.truckId))) {
        search(index+1,[...pairs,candidate]);
      }
    }
    search(0,[]);
    const result=optimize(shipments,trucks,edges);
    assert.equal(new Set(result.map(item=>item.truckId)).size,result.length);
    assert.deepEqual(objective(result),best, 'trial '+trial);
  }
});

test('validates attestation, numeric bounds, timezone and duplicate IDs', () => {
  const a='10000000-0000-4000-8000-000000000001';
  const profile={cargoTypes:[' Dairy ','DAIRY'],confirmed:true,usableTons:5,targetC:4,costPerKm:12.5,currency:'INR',latitude:28,longitude:77,synthetic:true};
  assert.deepEqual(profileInput(profile).cargoTypes,['dairy']);
  for (const patch of [{confirmed:false},{usableTons:'5'},{costPerKm:Infinity},{latitude:91},{synthetic:'true'}]) {
    assert.throws(()=>profileInput({...profile,...patch}),{status:400});
  }
  assert.throws(()=>planInput({truckIds:[a,a.toUpperCase()],shipmentIds:[a],currency:'INR'}),{status:400});
  const future=new Date(Date.now()+3600_000).toISOString();
  const shipment={reference:'TEST',cargoType:'Dairy',weightTons:2,origin:'TEST A',destination:'TEST B',originLat:28,originLng:77,
    destinationLat:29,destinationLng:77,deadline:future,shelfLifeUntil:future,priority:'high',handlingMinutes:15,synthetic:true};
  assert.equal(shipmentInput(shipment).deadline,future);
  assert.throws(()=>shipmentInput({...shipment,deadline:future.slice(0,-1)}),{status:400});
  assert.throws(()=>shipmentInput({...shipment,destinationLat:28}),{status:400});
});
