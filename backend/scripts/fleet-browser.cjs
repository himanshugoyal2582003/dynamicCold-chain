const assert=require('node:assert/strict');
const {createServer,request}=require('node:http');
const {resolve}=require('node:path');
const {makeFleetFixture}=require('./fleet-test-fixture.cjs');

async function main() {
  const frontendDir=resolve(process.env.FLEET_BROWSER_FRONTEND || '../frontend');
  const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
  const next=require(require.resolve('next',{paths:[frontendDir]}));
  const origin='http://127.0.0.1:3420';
  const fixture=await makeFleetFixture();
  const sockets=new Set();
  let frontend,web,browser;
  try {
    frontend=next({dev:false,dir:frontendDir,hostname:'127.0.0.1',port:3420});
    await frontend.prepare();
    const handle=frontend.getRequestHandler();
    web=createServer((req,res)=>{
      if(!req.url.startsWith('/api/')) return handle(req,res);
      const proxy=request({host:'127.0.0.1',port:fixture.app.getHttpServer().address().port,path:req.url,method:req.method,headers:req.headers},upstream=>{
        res.writeHead(upstream.statusCode,upstream.headers);
        upstream.pipe(res);
      });
      proxy.on('error',()=>{res.statusCode=502;res.end();});
      req.pipe(proxy);
    });
    web.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
    await new Promise((done,failed)=>web.once('error',failed).listen(3420,'127.0.0.1',done));
    browser=await chromium.launch({headless:true,executablePath:process.env.FLEET_BROWSER_EXECUTABLE || undefined});
    const pageErrors=[];
    console.log('Chrome '+browser.version());
    async function login(actor,role,viewport) {
      const context=await browser.newContext({viewport});
      const page=await context.newPage();
      page.on('pageerror',error=>pageErrors.push(error.message));
      await page.goto(origin+'/login');
      await page.locator('input[type=email]').fill(actor.email);
      await page.locator('input[type=password]').fill(fixture.password);
      await page.getByRole('button',{name:'Sign in',exact:true}).click();
      await page.waitForURL('**/'+role);
      const link=page.getByRole('link',{name:'Fleet Optimization',exact:true});
      await link.click();
      await page.waitForURL('**/'+role+'/fleet-optimization');
      assert.equal(await link.getAttribute('aria-current'),'page');
      return page;
    }
    const owner=await login(fixture.owner,'owner',{width:390,height:844});
    await owner.getByRole('heading',{name:'Pending shipments'}).waitFor();
    assert.equal(await owner.getByText('TEST-OTHER-LOAD',{exact:false}).count(),0);
    assert.equal(await owner.getByText('TEST-FOREIGN',{exact:false}).count(),0);
    await owner.getByRole('row',{name:/TEST-DAIRY \(synthetic\)/}).getByRole('button',{name:'Edit profile'}).click();
    await owner.getByLabel('Transportation rate per km').fill('21');
    await owner.getByLabel('I confirm the position, usable capacity, compatibility and rate for this plan.').check();
    await owner.getByRole('button',{name:'Save dispatch profile'}).click();
    await owner.getByText('Dispatch profile saved.',{exact:true}).waitFor();
    await owner.getByText('Add shipment',{exact:true}).click();
    const form=owner.locator('form').filter({has:owner.getByRole('button',{name:'Add pending shipment'})});
    const local=ms=>new Date(ms-new Date(ms).getTimezoneOffset()*60000).toISOString().slice(0,16);
    const values={reference:'TEST-BROWSER-NEW',cargoType:'Dairy',weightTons:2,origin:'TEST Pickup',destination:'TEST Delivery',
      originLat:28,originLng:77,destinationLat:28.1,destinationLng:77,handlingMinutes:5,
      deadline:local(Date.now()+3*3600_000),shelfLifeUntil:local(Date.now()+4*3600_000)};
    for(const [name,value] of Object.entries(values)) await form.locator('[name='+name+']').fill(String(value));
    await form.getByRole('button',{name:'Add pending shipment'}).click();
    await owner.getByRole('row',{name:/TEST-BROWSER-NEW/}).waitFor();
    console.log('PASS owner mobile navigation, tenant isolation, profile and shipment forms');

    for(const name of ['TEST-DAIRY-LOAD','TEST-FROZEN-LOAD','TEST-OVERSIZED']) await owner.getByLabel('Select shipment '+name).check();
    for(const name of ['TEST-DAIRY','TEST-VERSATILE','TEST-MAINT']) await owner.getByLabel('Select truck '+name).check();
    await owner.getByRole('button',{name:'Compare allocations'}).click();
    await owner.getByRole('heading',{name:'Allocation comparison'}).waitFor();
    const optimized=await owner.getByRole('row',{name:/Optimized/i}).innerText();
    assert.match(optimized,/Optimized\s+2\s+1 \/ 1/i);
    assert.match(optimized,/25 km\s+35\.05 min\s+INR 415/);
    assert.match(await owner.getByRole('row',{name:/Greedy/i}).innerText(),/Greedy\s+1\s+1 \/ 0/i);
    await owner.getByText('Synthetic planning run. Trip approval is disabled.').waitFor();
    assert.equal(await owner.getByRole('button',{name:'Review assignment'}).count(),0);
    assert.ok(await owner.getByLabel('Optimized selected fleet utilization').evaluate(node=>node.value)>60);
    const oversized=owner.getByRole('article').filter({hasText:'TEST-OVERSIZED'});
    await oversized.getByText('Truck ranking and exclusions').click();
    await oversized.getByText('Shipment exceeds verified truck capacity').waitFor();
    await oversized.getByText('Maintenance severity blocks dispatch').waitFor();
    assert.deepEqual(await fixture.query('SELECT id FROM trips'),[]);
    assert.ok(await owner.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'mobile document overflow');
    console.log('PASS optimized versus greedy coverage, utilization chart, explanations and no planning writes');

    const admin=await login(fixture.admin,'admin',{width:1440,height:960});
    await admin.getByLabel('Fleet',{exact:true}).selectOption(fixture.outsider.sub);
    await admin.getByRole('row',{name:/TEST-OTHER-LOAD/}).waitFor();
    assert.equal(await admin.getByText('TEST-DAIRY-LOAD',{exact:false}).count(),0);
    await admin.getByLabel('Fleet',{exact:true}).selectOption(fixture.owner.sub);
    await admin.getByLabel('Select shipment TEST-APPROVAL-LOAD').check();
    await admin.getByLabel('Select truck TEST-APPROVAL').check();
    await admin.getByRole('button',{name:'Compare allocations'}).click();
    await admin.getByRole('button',{name:'Review assignment'}).click();
    const confirm=admin.getByRole('button',{name:'Approve and assign trip'});
    assert.equal(await confirm.isEnabled(),false);
    assert.deepEqual(await fixture.query('SELECT id FROM trips'),[]);
    await admin.getByLabel('I approve creating this trip assignment.').check();
    await confirm.click();
    await admin.getByText('Trip assigned. Open Trips to inspect it.',{exact:true}).waitFor();
    const [trip]=await fixture.query('SELECT status,truck_id FROM trips');
    assert.deepEqual(trip,{status:'ASSIGNED',truck_id:fixture.operational.id});
    assert.equal((await fixture.query('SELECT id FROM trips')).length,1);
    assert.deepEqual(await fixture.query('SELECT id FROM rescue_events'),[]);
    assert.deepEqual(pageErrors,[]);
    console.log('PASS admin fleet selection and explicit approval creates one isolated trip');
  } finally {
    if(browser) await browser.close();
    if(web) await new Promise(done=>{web.close(done);for(const socket of sockets)socket.destroy();});
    if(frontend) await frontend.close();
    await fixture.close();
  }
}

main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
