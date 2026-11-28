export type GpsPoint = { at: number; latitude: number; longitude: number; accuracy: number | null };
export type SensorPoint = { at: number; device: string; temperature: number; humidity: number; target: number };
const VERSION = 'advisory-rules-v1';
const radians = (value:number) => value*Math.PI/180;

function distance(a:GpsPoint,b:GpsPoint) {
  const value = Math.sin(radians(b.latitude-a.latitude)/2)**2 +
    Math.cos(radians(a.latitude))*Math.cos(radians(b.latitude))*Math.sin(radians(b.longitude-a.longitude)/2)**2;
  return 6371*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,value))));
}

function longestRun(samples:SensorPoint[], qualifies:(a:SensorPoint,b:SensorPoint)=>boolean) {
  let longest=0;
  let first=samples[0];
  let count=1;
  for (let i=1;i<samples.length;i++) {
    const previous=samples[i-1], current=samples[i];
    const gap=current.at-previous.at;
    if (current.device!==previous.device || gap<=0 || gap>5*60_000 || !qualifies(previous,current)) {
      first=current; count=1; continue;
    }
    count++;
    if (count>=4) longest=Math.max(longest,(current.at-first.at)/60_000);
  }
  return longest;
}

export function assessSignals(locations:GpsPoint[], observations:SensorPoint[]) {
  const gps=locations.filter(p=>p.accuracy!==null && Number.isFinite(p.at) && Number.isFinite(p.latitude) &&
    Number.isFinite(p.longitude) && Math.abs(p.latitude)<=90 && Math.abs(p.longitude)<=180 &&
    (p.latitude!==0 || p.longitude!==0) && p.accuracy>=0 && p.accuracy<=100).sort((a,b)=>a.at-b.at);
  let jumps=0;
  for (let i=1;i<gps.length;i++) {
    const gap=gps[i].at-gps[i-1].at;
    if (gap<10_000 || gap>5*60_000) continue;
    const km=distance(gps[i-1],gps[i]);
    if (km>=2 && km*3600_000/gap>160) jumps++;
  }

  const byDevice=new Map<string,SensorPoint[]>();
  for (const point of observations) {
    if (!point.device || ![point.at,point.temperature,point.humidity,point.target].every(Number.isFinite)) continue;
    const points=byDevice.get(point.device) ?? [];
    points.push(point);
    byDevice.set(point.device,points);
  }
  let duplicates=0, conflicts=0, flatline=0, excursion=0, supported=0;
  for (const points of byDevice.values()) {
    points.sort((a,b)=>a.at-b.at);
    const distinct:SensorPoint[]=[];
    for (let i=0;i<points.length;) {
      const point=points[i];
      let next=i+1;
      let conflicting=false;
      while (next<points.length && points[next].at===point.at) {
        const duplicate=points[next++];
        duplicates++;
        if (duplicate.temperature!==point.temperature || duplicate.humidity!==point.humidity || duplicate.target!==point.target) {
          conflicting=true;
        }
      }
      if (conflicting) conflicts++;
      else distinct.push(point);
      i=next;
    }
    supported+=distinct.length;
    flatline=Math.max(flatline,longestRun(distinct,(a,b)=>a.temperature===b.temperature && a.humidity===b.humidity));
    excursion=Math.max(excursion,longestRun(distinct,(a,b)=>a.target===b.target &&
      Math.abs(a.temperature-a.target)>=4 && Math.abs(b.temperature-b.target)>=4));
  }

  const signals=[
    {code:'gps_jump',value:jumps,points:Math.min(40,jumps*25)},
    {code:'conflicting_observation',value:conflicts,points:Math.min(35,conflicts*20)},
    {code:'duplicate_observation',value:duplicates,points:Math.min(10,duplicates*2)},
    {code:'joint_sensor_flatline_minutes',value:Math.floor(flatline),points:flatline>=20 ? 20 : 0},
    {code:'temperature_excursion_minutes',value:Math.floor(excursion),points:excursion>=10 ? 13 : 0},
  ].filter(item=>item.points>0);
  const score=Math.min(100,signals.reduce((sum,item)=>sum+item.points,0));
  return {version:VERSION,score,signals,gpsSamples:gps.length,sensorSamples:supported,
    classification: score>=25 ? 'review_suggested' : score>0 ? 'weak_indicators' :
      gps.length>=2 || supported>=4 ? 'no_indicators' : 'insufficient_evidence'};
}
