const assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const {readFileSync,readdirSync}=require('node:fs');
const {resolve}=require('node:path');
const {test}=require('node:test');
const {createServer}=require('node:http');
const {PGlite}=require('@electric-sql/pglite');
const {Module}=require('@nestjs/common');
const {NestFactory}=require('@nestjs/core');
const cookieParser=require('cookie-parser');
const jwt=require('jsonwebtoken');
const {AppModule}=require('../dist/app.module');
const {AuthService}=require('../dist/auth/auth.service');
const {NeonService}=require('../dist/neon/neon.service');
const {IotService}=require('../dist/iot/iot.service');
const {IotController}=require('../dist/iot/iot.controller');
const {TelemetryDeliveryController}=require('../dist/iot/telemetry-delivery.controller');

test('durable telemetry HTTP ordering, admin scope and replay proxy against isolated PostgreSQL', async t=>{
  const db=new PGlite();
  let app,monitor;
  const environment={JWT_SECRET:'isolated-telemetry-jwt-test-fixture',IOT_INGEST_SECRET:'fixture-ingest',
    TELEMETRY_MONITOR_TOKEN:'fixture-monitor',TELEMETRY_REQUIRE_DURABLE:'true',AI_ML_API_URL:''};
  const old=Object.fromEntries(Object.keys(environment).map(key=>[key,process.env[key]]));
  Object.assign(process.env,environment);
  t.after(async()=>{
    if (app) {app.getHttpServer().closeAllConnections();await app.close();}
    if (monitor) await new Promise(done=>{monitor.close(done);monitor.closeAllConnections();});
    await db.close();
    for(const [key,value] of Object.entries(old)) {
      if(value===undefined) delete process.env[key]; else process.env[key]=value;
    }
  });
  for(const file of readdirSync(resolve(__dirname,'../db/migrations')).filter(name=>name.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(resolve(__dirname,'../db/migrations',file),'utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
  }
  const sql=async(statement,params)=> (await db.query(statement,params)).rows;
  const admin=randomUUID(), owner=randomUUID();
  await sql("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Admin','admin@fixture.invalid','unused','admin'),($2,'Owner','owner@fixture.invalid','unused','owner')",[admin,owner]);
  const projected=[];
  let hold,unblock,started;
  class TestModule { configure(consumer) { AppModule.prototype.configure(consumer); } }
  Module({controllers:[TelemetryDeliveryController,IotController],providers:[AuthService,
    {provide:NeonService,useValue:{getSql:()=>sql}},
    {provide:IotService,useValue:{ingest:async body=>{projected.push(body.timestamp);if(hold){started();await hold;}return {success:true};}}},
  ]})(TestModule);
  app=await NestFactory.create(TestModule,{logger:false});
  app.use(cookieParser());
  await app.listen(0,'127.0.0.1');
  const base=(await app.getUrl())+'/api/iot/delivery';
  const point=offset=>new Date(Date.now()+offset).toISOString();
  const id=time=>createHash('sha256').update(JSON.stringify(['TEST-DEVICE','TEST-PAIR',time])).digest('hex');
  const send=(time,event=id(time),secret='fixture-ingest')=>fetch(base+'/accept',{
    method:'POST',headers:{'content-type':'application/json','x-iot-ingest-secret':secret,'x-telemetry-event-id':event},
    body:JSON.stringify({device_id:'TEST-DEVICE',connection_number:' test-pair ',timestamp:time,temperature:4,target_temp:4,
      humidity:65,spoilage_risk:0.1,shelf_life_remaining_hours:12}),
  });
  await t.test('authenticated watermark handles duplicate, late, stale and invalid envelopes',async()=>{
    const legacy=await fetch(base.replace('/delivery','/ingest'),{method:'POST',
      headers:{'content-type':'application/json','x-iot-ingest-secret':'fixture-ingest'},
      body:JSON.stringify({connection_number:'TEST-PAIR'})});
    assert.equal(legacy.status,409);
    const time=point(-1000);
    assert.equal((await send(time,id(time),'wrong')).status,401);
    assert.equal((await send(time,'a'.repeat(64))).status,400);
    assert.equal((await send(point(60000))).status,400);
    assert.equal((await (await send(time)).json()).disposition,'applied');
    assert.equal((await (await send(time)).json()).disposition,'duplicate');
    assert.equal((await (await send(point(-5000))).json()).disposition,'out_of_order');
    assert.equal((await (await send(point(-180000))).json()).disposition,'expired');
    assert.deepEqual(projected,[time]);
  });
  await t.test('overlapping projection is throttled and can then be retried',async()=>{
    const gate=new Promise(done=>{started=done;});
    hold=new Promise(done=>{unblock=done;});
    const first=send(point(1000));
    await gate;
    const more=point(2000);
    try { assert.equal((await send(more)).status,429); } finally { unblock(); }
    assert.equal((await first).status,200);
    hold=null;
    assert.equal((await (await send(more)).json()).disposition,'applied');
  });
  await t.test('admin routes enforce live role and CSRF, and proxy actor without exposing payloads',async()=>{
    monitor=createServer(async(req,res)=>{
      assert.equal(req.headers['x-service-token'],'fixture-monitor');
      if(req.method==='POST') {
        let body='';for await(const chunk of req) body+=chunk;
        assert.deepEqual(JSON.parse(body),{actor:admin});
      }
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({enabled:true}));
    });
    await new Promise(done=>monitor.listen(0,'127.0.0.1',done));
    process.env.AI_ML_API_URL='http://127.0.0.1:'+monitor.address().port;
    const request=(actor,role,path='status',csrf=false)=>{
      const headers={};
      if(actor) headers.Cookie='coldchain_token='+jwt.sign({sub:actor,role},process.env.JWT_SECRET)+'; coldchain_csrf=fixture';
      if(csrf) headers['x-csrf-token']='fixture';
      if(path==='replay') headers['content-type']='application/json';
      return fetch(base+'/'+path,{method:path==='replay'?'POST':'GET',headers,
        body:path==='replay'?JSON.stringify({eventId:'a'.repeat(64),actor:owner}):undefined});
    };
    assert.equal((await request(null)).status,401);
    assert.equal((await request(owner,'owner')).status,403);
    assert.equal((await request(owner,'admin')).status,403);
    assert.deepEqual(await (await request(admin,'admin')).json(),{enabled:true});
    assert.equal((await request(admin,'admin','replay')).status,403);
    assert.equal((await request(admin,'admin','replay',true)).status,200);
  });
});
