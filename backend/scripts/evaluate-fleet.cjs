const { performance } = require('node:perf_hooks');
const { optimize, greedy } = require('../dist/fleet-optimization/optimizer');

const seed = 19880217;
let state = seed;
const random = () => {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return state / 2**32;
};
const trials = 600;
const totals = {optimized:{assigned:0,critical:0,high:0},greedy:{assigned:0,critical:0,high:0},
  improvedCoverage:0,matchedPriorityMix:0,optimizedMatchedScore:0,greedyMatchedScore:0};
const elapsed = [];
for (let trial=0;trial<trials;trial++) {
  const size=6+trial%7;
  const shipments=Array.from({length:size},(_,i)=>({id:'S'+i,priority:['critical','high','standard'][i%3],
    deadline:new Date(Date.UTC(2030,0,1,0,i)).toISOString()}));
  const trucks=Array.from({length:size},(_,i)=>'T'+i);
  const density=0.15+0.6*random();
  const choices=shipments.flatMap(ship=>trucks.flatMap(truck=>random()<density ?
    [{shipmentId:ship.id,truckId:truck,score:Math.floor(random()*10001)}] : []));
  const start=performance.now();
  const optimal=optimize(shipments,trucks,choices);
  elapsed.push(performance.now()-start);
  const baseline=greedy(shipments,choices);
  const stats=rows=>({assigned:rows.length,
    critical:rows.filter(row=>shipments.find(ship=>ship.id===row.shipmentId).priority==='critical').length,
    high:rows.filter(row=>shipments.find(ship=>ship.id===row.shipmentId).priority==='high').length});
  const a=stats(optimal), b=stats(baseline);
  for (const key of Object.keys(a)) {totals.optimized[key]+=a[key];totals.greedy[key]+=b[key];}
  if (a.assigned>b.assigned) totals.improvedCoverage++;
  if (a.assigned===b.assigned && a.critical===b.critical && a.high===b.high) {
    totals.matchedPriorityMix++;
    totals.optimizedMatchedScore+=optimal.reduce((sum,row)=>sum+row.score,0);
    totals.greedyMatchedScore+=baseline.reduce((sum,row)=>sum+row.score,0);
  }
}
elapsed.sort((a,b)=>a-b);
console.log(JSON.stringify({
  synthetic:true,seed,trials,...totals,
  matchedScoreReductionPct:Number((100*(1-totals.optimizedMatchedScore/totals.greedyMatchedScore)).toFixed(2)),
  solverP95Milliseconds:Number(elapsed[Math.ceil(elapsed.length*0.95)-1].toFixed(3)),
},null,2));
