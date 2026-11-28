const {assessSignals}=require('../dist/insurance-signals/signal-rules');
const seed=78301;
let state=seed;
const random=()=>((state=(Math.imul(state,1664525)+1013904223)>>>0)/2**32);
const families=['routine','routine_excursion','gps_jump','flatline_excursion','conflict'];
const metrics={rules:{tp:0,fp:0,tn:0,fn:0},temperatureOnly:{tp:0,fp:0,tn:0,fn:0}};
const results={};
for(const family of families){
  let flagged=0;
  for(let i=0;i<40;i++){
    const at=1_000_000;
    const temperature=family==='routine_excursion'||family==='flatline_excursion' ? 9.2 : 4;
    const sensor=Array.from({length:25},(_,j)=>({
      at:at+j*60000,device:'SYNTHETIC-FIXTURE',temperature:temperature+(family==='flatline_excursion'?0:random()*0.4),
      humidity:family==='flatline_excursion'?68:66+random(),target:4,
    }));
    const gps=Array.from({length:12},(_,j)=>({at:at+j*30000,latitude:28+j*0.0008,longitude:77+random()*0.0001,accuracy:9}));
    if(family==='gps_jump')gps[6].latitude+=0.15+random()*0.1;
    if(family==='conflict')for(const index of [3,8])sensor.push({...sensor[index],temperature:7+random()});
    const positive=!family.startsWith('routine');
    const finding=assessSignals(gps,sensor).score>=25;
    if(finding)flagged++;
    for(const [method,prediction] of [['rules',finding],['temperatureOnly',sensor.some(sample=>Math.abs(sample.temperature-sample.target)>=4)]]){
      metrics[method][positive?(prediction?'tp':'fn'):(prediction?'fp':'tn')]++;
    }
  }
  results[family]=flagged;
}
console.log(JSON.stringify({synthetic:true,seed,windows:families.length*40,metrics,flaggedByFamily:results},null,2));
