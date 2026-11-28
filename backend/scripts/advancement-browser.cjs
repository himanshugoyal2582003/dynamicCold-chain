const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomUUID,randomBytes}=require('node:crypto');
const {readFileSync,readdirSync,mkdtempSync}=require('node:fs');
const {createServer,request}=require('node:http');
const {tmpdir}=require('node:os');
const {resolve,join}=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const bcrypt=require('bcryptjs');
const {Module}=require('@nestjs/common');
const {NestFactory}=require('@nestjs/core');
const cookieParser=require('cookie-parser');
const {AppModule}=require('../dist/app.module');
const {AuthController}=require('../dist/auth/auth.controller');
const {AuthService}=require('../dist/auth/auth.service');
const {IotService}=require('../dist/iot/iot.service');
const {NeonService}=require('../dist/neon/neon.service');
const {InsuranceSignalsController}=require('../dist/insurance-signals/insurance-signals.controller');
const {TelemetryDeliveryController}=require('../dist/iot/telemetry-delivery.controller');

const listen=(server,port=0)=>new Promise((done,fail)=>server.once('error',fail).listen(port,'127.0.0.1',done));
const close=server=>server && new Promise(done=>{server.close(done);server.closeAllConnections();});
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
async function until(predicate,label) {
  for(let attempt=0;attempt<60;attempt++){
    try{const result=await predicate();if(result)return result;}catch{}
    await sleep(350);
  }
  throw new Error('Timed out waiting for '+label);
}
function proxy(req,res,port) {
  const downstream=request({host:'127.0.0.1',port,path:req.url,method:req.method,headers:req.headers},reply=>{
    res.writeHead(reply.statusCode,reply.headers);
    reply.pipe(res);
  });
  downstream.on('error',()=>{res.statusCode=502;res.end();});
  req.pipe(downstream);
}

async function main(){
  const frontendDir=resolve(process.env.FLEET_BROWSER_FRONTEND || '../frontend');
  const python=process.env.AI_ML_TEST_PYTHON;
  if(!python)throw new Error('Set AI_ML_TEST_PYTHON to an isolated Python executable with AI/ML dependencies');
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
  const next=require(require.resolve('next',{paths:[frontendDir]}));
  const db=new PGlite();
  const port=3420,origin='http://127.0.0.1:'+port;
  const ai='http://127.0.0.1:8420';
  const producer=randomBytes(24).toString('hex');
  process.env.JWT_SECRET=randomBytes(32).toString('hex');
  process.env.IOT_INGEST_SECRET=randomBytes(24).toString('hex');
  process.env.TELEMETRY_MONITOR_TOKEN=randomBytes(24).toString('hex');
  process.env.AI_ML_API_URL=ai;
  const sockets=new Set();
  let app,frontend,web,broker,browser,pythonProcess;
  try{
    const migrationDir=resolve(__dirname,'../db/migrations');
    for(const file of readdirSync(migrationDir).filter(name=>name.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(join(migrationDir,file),'utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
    }
    const sql=async(statement,params)=>(await db.query(statement,params)).rows;
    const admin=randomUUID(),owner=randomUUID(),driver=randomUUID(),truck=randomUUID(),trip=randomUUID();
    const password=randomBytes(16).toString('hex');
    const hash=await bcrypt.hash(password,4);
    await sql("INSERT INTO users(id,name,email,password_hash,role) VALUES($1,'Admin','admin@synthetic.fixture.invalid',$4,'admin'),($2,'Owner','owner@synthetic.fixture.invalid',$4,'owner'),($3,'Driver','driver@synthetic.fixture.invalid',$4,'truckUser')",[admin,owner,driver,hash]);
    await sql("INSERT INTO trucks(id,owner_id,plate_number,type,capacity_tons) VALUES($1,$2,'SYNTHETIC QA','demo',4)",[truck,owner]);
    await sql("INSERT INTO trips(id,truck_id,user_id,origin,destination,cargo_type,status,started_at) VALUES($1,$2,$3,'Synthetic A','Synthetic B','Dairy','IN_PROGRESS',now() AT TIME ZONE 'UTC'-interval '1 hour')",[trip,truck,driver]);
    await sql("INSERT INTO truck_location_history(truck_id,latitude,longitude,accuracy_m,recorded_at) VALUES($1,28,77,8,now() AT TIME ZONE 'UTC'-interval '45 seconds'),($1,29,77,8,now() AT TIME ZONE 'UTC'-interval '25 seconds')",[truck]);
    const projected=[];
    class Fixture {configure(consumer){AppModule.prototype.configure(consumer);}}
    Module({controllers:[AuthController,TelemetryDeliveryController,InsuranceSignalsController],providers:[AuthService,
      {provide:NeonService,useValue:{getSql:()=>sql}},
      {provide:IotService,useValue:{ingest:async payload=>{projected.push(payload);return {success:true};}}},
    ]})(Fixture);
    app=await NestFactory.create(Fixture,{logger:false});
    app.use(cookieParser());
    await app.listen(0,'127.0.0.1');
    let brokerMode='offline';
    let failedDeliveries=0;
    broker=createServer((req,res)=>{
      if(brokerMode==='online')return proxy(req,res,app.getHttpServer().address().port);
      if(brokerMode==='offline')failedDeliveries++;
      res.writeHead(brokerMode==='offline'?503:422);res.end();
    });
    await listen(broker);
    const runtime=mkdtempSync(join(tmpdir(),'coldchain-advancement-'));
    pythonProcess=spawn(python,['-B','-m','uvicorn','main:app','--host','127.0.0.1','--port','8420'],
      {cwd:resolve(__dirname,'../../ai-ml'),windowsHide:true,stdio:'ignore',env:{
        ...process.env,ENV:'test',NODE_ENV:'test',OMP_NUM_THREADS:'1',MKL_NUM_THREADS:'1',
        AIML_SERVICE_TOKEN:producer,TELEMETRY_OUTBOX_PATH:join(runtime,'outbox.sqlite'),
        BACKEND_API_URL:'http://127.0.0.1:'+broker.address().port,
      }});
    await until(async()=> (await fetch(ai+'/health')).ok,'FastAPI fixture');
    const submit=async()=>{
      const timestamp=new Date().toISOString();
      const response=await fetch(ai+'/api/iot/process',{method:'POST',
        headers:{'content-type':'application/json','x-service-token':producer},
        body:JSON.stringify({device_id:'SYNTHETIC-PROBE',connection_number:'SYNTHETIC-PAIR',timestamp,temperature:4,humidity:67})});
      assert.equal(response.status,200,await response.clone().text());
      assert.equal(response.headers.get('x-telemetry-delivery'),'queued');
      return timestamp;
    };
    const health=()=>fetch(ai+'/internal/telemetry-outbox',{headers:{'x-service-token':process.env.TELEMETRY_MONITOR_TOKEN}}).then(r=>r.json());
    const first=await submit();
    await until(async()=> failedDeliveries>0 && (await health()).counts.pending===1,'durable backlog after failed delivery');
    brokerMode='online';
    await until(()=>projected.some(payload=>payload.timestamp===first),'retry projection');
    assert.deepEqual(projected[0].gps,{lat:null,lng:null,speed_kmh:null});
    brokerMode='reject';
    const rejected=await submit();
    await until(async()=> (await health()).counts.dead===1,'dead letter');
    console.log('PASS actual FastAPI outbox to Nest ingress through a transient outage and a permanent rejection');

    frontend=next({dev:false,dir:frontendDir,hostname:'127.0.0.1',port});
    await frontend.prepare();
    const handle=frontend.getRequestHandler();
    web=createServer((req,res)=>{
      if(!req.url.startsWith('/api/'))return handle(req,res);
      const time=new Date().toISOString();
      const context={
        '/api/trips/resources':{trucks:[{id:truck,plate_number:'SYNTHETIC QA'}]},
        ['/api/iot/telemetry/'+truck]:{telemetry:{timestamp:time,source:'sensor',model_type:'PyTorch-SpoilageLSTM',
          temperature:4,target_temp:4,humidity:67,door_open:false,spoilage_risk:0.04,shelf_life_remaining_hours:22}},
        ['/api/maintenance/trucks/'+truck+'/history']:{assessments:[{severity:'watch',score:80,last_observed_at:time,
          model_version:'fixture-only',factors:[{code:'temperature_drift',points:20}]}]},
        ['/api/trips?truckId='+truck+'&status=IN_PROGRESS']:{trips:[{id:trip}]},
        ['/api/trips/'+trip+'/rescue']:[{severity:'HIGH',status:'PENDING_APPROVAL',created_at:time,
          candidates:[{id:trip,warehouse_name:'Synthetic Cold Hub',explanation:['Estimated travel time: 12 minutes']}]}],
      };
      if(req.method==='GET' && Object.hasOwn(context,req.url)){
        res.setHeader('content-type','application/json');return res.end(JSON.stringify(context[req.url]));
      }
      proxy(req,res,app.getHttpServer().address().port);
    });
    web.on('connection',sock=>{sockets.add(sock);sock.on('close',()=>sockets.delete(sock));});
    await listen(web,port);
    browser=await chromium.launch({headless:true,executablePath:process.env.FLEET_BROWSER_EXECUTABLE || undefined});
    const errors=[];
    async function signIn(role){
      const page=await browser.newPage();
      page.on('pageerror',error=>errors.push(error.message));
      await page.goto(origin+'/login');
      await page.locator('input[type=email]').fill(role+'@synthetic.fixture.invalid');
      await page.locator('input[type=password]').fill(password);
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await page.waitForURL(origin+'/'+role);
      return page;
    }
    const adminPage=await signIn('admin');
    await adminPage.goto(origin+'/admin/telemetry-delivery');
    await adminPage.getByRole('button',{name:'Review replay'}).click();
    brokerMode='online';
    await adminPage.getByRole('button',{name:'Confirm replay'}).click();
    await adminPage.getByText('Dead letter requeued with its original observation time.').waitFor();
    await until(()=>projected.some(payload=>payload.timestamp===rejected),'replayed projection');
    assert.equal((await health()).replays[0].actor,admin);
    console.log('PASS Chrome admin telemetry metrics, confirmation, replay and authenticated audit');

    await adminPage.goto(origin+'/admin/insurance-signals');
    await adminPage.getByLabel('Started trip').selectOption(trip);
    await adminPage.getByRole('button',{name:'Assess trip'}).click();
    await adminPage.getByText(/Advisory score 25\/100/).waitFor();
    await adminPage.getByLabel('Evidence and review notes').fill('Synthetic browser review only.');
    await adminPage.getByRole('button',{name:'Record review'}).click();
    await adminPage.getByText('Review decision recorded.').waitFor();
    await adminPage.getByText('Synthetic browser review only.',{exact:true}).waitFor();
    console.log('PASS Chrome admin insurance signal assessment and human review');

    const ownerPage=await signIn('owner');
    await ownerPage.goto(origin+'/admin/insurance-signals');
    await ownerPage.waitForURL(origin+'/owner');
    await ownerPage.goto(origin+'/admin/telemetry-delivery');
    await ownerPage.waitForURL(origin+'/owner');
    assert.equal(await ownerPage.getByRole('link',{name:'Insurance Review',exact:true}).count(),0);
    assert.equal(await ownerPage.getByRole('link',{name:'Telemetry Delivery',exact:true}).count(),0);
    const intelligenceLink=ownerPage.getByRole('link',{name:'Intelligence',exact:true});
    await intelligenceLink.click();
    await ownerPage.waitForURL(origin+'/owner/intelligence');
    assert.equal(await intelligenceLink.getAttribute('aria-current'),'page');
    await ownerPage.getByLabel('Truck',{exact:true}).selectOption(truck);
    await ownerPage.getByText(/Risk 4%/).waitFor();
    await ownerPage.getByText(/temperature drift · 20 points/).waitFor();
    await ownerPage.getByText('Synthetic Cold Hub',{exact:true}).click();
    await ownerPage.getByText('Estimated travel time: 12 minutes',{exact:true}).waitFor();
    assert.equal(await ownerPage.getByRole('link',{name:'Insurance signal review'}).count(),0);
    assert.deepEqual(errors,[]);
    console.log('PASS Chrome owner explanation display, recorded factors and role navigation');
    assert.equal((await sql('SELECT status FROM trips'))[0].status,'IN_PROGRESS');
    assert.equal((await sql('SELECT current_insurance_price::float8 AS price FROM trucks'))[0].price,450);
  } finally {
    if(browser)await browser.close();
    if(web)await new Promise(done=>{web.close(done);for(const sock of sockets)sock.destroy();});
    if(frontend)await frontend.close();
    if(pythonProcess)pythonProcess.kill();
    if(app){app.getHttpServer().closeAllConnections();await app.close();}
    await close(broker);
    await db.close();
  }
}

main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
