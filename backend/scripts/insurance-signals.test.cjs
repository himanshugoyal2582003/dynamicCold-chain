const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID}=require('node:crypto');
const {readFileSync,readdirSync}=require('node:fs');
const {resolve}=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const {Module}=require('@nestjs/common');
const {NestFactory}=require('@nestjs/core');
const cookieParser=require('cookie-parser');
const jwt=require('jsonwebtoken');
const {assessSignals}=require('../dist/insurance-signals/signal-rules');
const {AppModule}=require('../dist/app.module');
const {AuthService}=require('../dist/auth/auth.service');
const {InsuranceSignalsController}=require('../dist/insurance-signals/insurance-signals.controller');
const {NeonService}=require('../dist/neon/neon.service');

const sensor=(at,temperature=4,humidity=67)=>({at,device:'fixture',temperature,humidity,target:4});
const gps=(at,latitude,accuracy=8)=>({at,latitude,longitude:77,accuracy});

test('rules expose missing evidence and exclude inaccurate or insufficient-duration GPS jumps',()=>{
  assert.equal(assessSignals([],[]).classification,'insufficient_evidence');
  assert.equal(assessSignals([gps(0,28),gps(15000,30,200)],[]).score,0);
  assert.equal(assessSignals([gps(0,28),gps(5000,30)],[]).score,0);
  const result=assessSignals([gps(0,28),gps(15000,30)],[]);
  assert.equal(result.classification,'review_suggested');
  assert.deepEqual(result.signals,[{code:'gps_jump',value:1,points:25}]);
});

test('rules break runs on missing intervals, distinguish duplicates and retain rule weights',()=>{
  const joined=Array.from({length:23},(_,i)=>sensor(i*60000,9));
  const result=assessSignals([],joined);
  assert.deepEqual(result.signals.map(item=>item.points),[20,13]);
  const gapped=[...joined.slice(0,7),...joined.slice(16)];
  assert.equal(assessSignals([],gapped).score,0);
  const repeated=[sensor(1000),sensor(1000,8),sensor(1000)];
  const conflicts=assessSignals([],repeated);
  assert.equal(conflicts.sensorSamples,0);
  assert.deepEqual(conflicts.signals.map(item=>item.code),['conflicting_observation','duplicate_observation']);
});

test('admin evidence review against isolated PostgreSQL, audited concurrent mutation',async t=>{
  const db=new PGlite();
  let app;
  const previous=process.env.JWT_SECRET;
  process.env.JWT_SECRET='isolated-insurance-signal-jwt-test';
  t.after(async()=>{
    try{if(app){app.getHttpServer().closeAllConnections();await app.close();}}finally{await db.close();}
    if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;
  });
  const directory=resolve(__dirname,'../db/migrations');
  for(const name of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort()){
    await db.exec(readFileSync(resolve(directory,name),'utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
  }
  const sql=async(text,params)=>(await db.query(text,params)).rows;
  const admin=randomUUID(), owner=randomUUID(),driver=randomUUID(), truck=randomUUID(),trip=randomUUID();
  await sql("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Test admin','admin@fixture.invalid','unused','admin'),($2,'Test owner','owner@fixture.invalid','unused','owner'),($3,'Test driver','driver@fixture.invalid','unused','truckUser')",[admin,owner,driver]);
  await sql("INSERT INTO trucks(id,owner_id,plate_number,type,capacity_tons) VALUES($1,$2,'SYNTHETIC REVIEW','fixture',5)",[truck,owner]);
  await sql("INSERT INTO trips(id,truck_id,user_id,origin,destination,cargo_type,status,started_at) VALUES($1,$2,$3,'Fixture A','Fixture B','Dairy','IN_PROGRESS',now() AT TIME ZONE 'UTC' - interval '1 hour')",[trip,truck,driver]);
  await sql("INSERT INTO truck_location_history(truck_id,latitude,longitude,accuracy_m,recorded_at) VALUES($1,28,77,9,now() AT TIME ZONE 'UTC'-interval '40 seconds'),($1,29,77,9,now() AT TIME ZONE 'UTC'-interval '20 seconds')",[truck]);
  class Fixture {configure(consumer){AppModule.prototype.configure(consumer);}}
  Module({controllers:[InsuranceSignalsController],providers:[AuthService,{provide:NeonService,useValue:{getSql:()=>sql}}]})(Fixture);
  app=await NestFactory.create(Fixture,{logger:false});
  app.use(cookieParser());
  await app.listen(0,'127.0.0.1');
  const url=(await app.getUrl())+'/api/insurance-signals';
  const call=(actor,role,path='',body,csrf=true)=>{
    const headers={};
    if(actor)headers.Cookie='coldchain_token='+jwt.sign({sub:actor,role},process.env.JWT_SECRET)+'; coldchain_csrf=fixture';
    if(csrf)headers['x-csrf-token']='fixture';
    if(body)headers['content-type']='application/json';
    return fetch(url+path,{headers,method:body?'POST':'GET',body:body?JSON.stringify(body):undefined});
  };
  assert.equal((await call(null)).status,401);
  assert.equal((await call(owner,'owner')).status,403);
  assert.equal((await call(owner,'admin')).status,403);
  assert.equal((await call(admin,'admin','/trips/'+trip+'/case',{},false)).status,403);
  const before=JSON.stringify(await sql('SELECT * FROM trucks'));
  const created=await call(admin,'admin','/trips/'+trip+'/case',{});
  assert.equal(created.status,201,await created.clone().text());
  const {id}=await created.json();
  assert.equal((await call(admin,'admin','/trips/'+trip+'/case',{})).status,409);
  const cases=(await (await call(admin,'admin')).json()).cases;
  assert.equal(cases[0].assessment.score,25);
  const note={status:'insufficient_evidence',note:'Synthetic test; human review only.',revision:0};
  const updates=await Promise.all([call(admin,'admin','/'+id+'/reviews',note),call(admin,'admin','/'+id+'/reviews',note)]);
  assert.deepEqual(updates.map(item=>item.status).sort(),[201,409]);
  const history=await (await call(admin,'admin','/'+id+'/reviews')).json();
  assert.equal(history.reviews.length,1);
  assert.equal(history.reviews[0].actor_id,admin);
  assert.equal(history.reviews[0].note,note.note);
  assert.equal(JSON.stringify(await sql('SELECT * FROM trucks')),before);
  assert.equal((await sql('SELECT status FROM trips'))[0].status,'IN_PROGRESS');
});
