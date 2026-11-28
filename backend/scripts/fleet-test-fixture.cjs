const { randomBytes, randomUUID } = require('node:crypto');
const { readFileSync, readdirSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const { AppModule } = require('../dist/app.module');
const { AuthController } = require('../dist/auth/auth.controller');
const { AuthService } = require('../dist/auth/auth.service');
const { NeonService } = require('../dist/neon/neon.service');
const { TripsService } = require('../dist/trips/trips.service');
const { TripsController } = require('../dist/trips/trips.controller');
const { TrackingGateway } = require('../dist/tracking/tracking.gateway');
const { RoutingService } = require('../dist/rescue/routing.service');
const { FleetController } = require('../dist/fleet-optimization/fleet.controller');
const { FleetService } = require('../dist/fleet-optimization/fleet.service');

async function makeFleetFixture() {
  // Explicit isolated engine. No DATABASE_URL or cloud client is used.
  const db = new PGlite();
  const priorSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = randomBytes(32).toString('hex');
  let app;
  const close = async () => {
    try { if (app) await app.close(); } finally {
      await db.close();
      if (priorSecret === undefined) delete process.env.JWT_SECRET;
      else process.env.JWT_SECRET = priorSecret;
    }
  };
  try {
    const directory=resolve(__dirname,'../db/migrations');
    for (const name of readdirSync(directory).filter(name=>name.endsWith('.sql')).sort()) {
      await db.exec(readFileSync(resolve(directory,name),'utf8').replace('CREATE EXTENSION IF NOT EXISTS pgcrypto;',''));
    }
    const query=async(statement,params=[]) => (await db.query(statement,params)).rows;
    const password=randomBytes(16).toString('hex');
    const hash=await bcrypt.hash(password,4);
    const user=async(role,name)=>{
      const sub=randomUUID(),email=name.toLowerCase().replaceAll(' ','-')+'@fixture.invalid';
      await query('INSERT INTO users(id,name,email,password_hash,role) VALUES($1,$2,$3,$4,$5)',[sub,name,email,hash,role]);
      return {sub,role,email};
    };
    const owner=await user('owner','TEST Fleet'), outsider=await user('owner','TEST Other Fleet'), admin=await user('admin','TEST Admin');
    async function truck(plate,fleet,point,types,rate,synthetic,score=96,severity='normal') {
      const id=randomUUID(),pair='PAIR-'+plate, driver=await user('truckUser',plate+' Driver');
      await query("INSERT INTO trucks(id,owner_id,plate_number,type,capacity_tons,iot_connection_number,target_temp_c) VALUES($1,$2,$3,'TEST synthetic reefer',6,$4,4)",[id,fleet.sub,plate,pair]);
      await query('UPDATE users SET owner_id=$1,truck_id=$2 WHERE id=$3',[fleet.sub,id,driver.sub]);
      await query("INSERT INTO fleet_dispatch_profiles(truck_id,owner_id,cargo_types,usable_tons,target_c,cost_per_km,currency,latitude,longitude,synthetic) VALUES($1,$2,$3,6,4,$4,'INR',$5,77,$6)",[id,fleet.sub,types,rate,point,synthetic]);
      await query("INSERT INTO maintenance_assessments VALUES($1,now(),now(),'TEST-sensor',$2,'fixture',4,$3,$4,null,'[]',0)",[id,pair,score,severity]);
      return {id,plate,driver,pair};
    }
    const versatile=await truck('TEST-VERSATILE',owner,28,['dairy','frozen'],10,true);
    const dairy=await truck('TEST-DAIRY',owner,27.95,['dairy'],20,true);
    const blocked=await truck('TEST-MAINT',owner,28,['dairy','frozen'],1,true,60,'warning');
    const operational=await truck('TEST-APPROVAL',owner,28,['dairy'],12,false);
    const foreign=await truck('TEST-FOREIGN',outsider,28,['dairy'],1,true);
    function body(reference,patch={}) {
      return {reference,cargoType:'Dairy',weightTons:3,origin:'TEST pickup',destination:'TEST delivery',originLat:28,originLng:77,
        destinationLat:28.1,destinationLng:77,deadline:new Date(Date.now()+3*3600_000).toISOString(),
        shelfLifeUntil:new Date(Date.now()+4*3600_000).toISOString(),handlingMinutes:5,priority:'critical',synthetic:true,...patch};
    }
    async function insert(data,fleet=owner) {
      return (await query(`INSERT INTO fleet_shipments(owner_id,reference,cargo_type,weight_tons,origin,destination,origin_lat,origin_lng,
        destination_lat,destination_lng,deadline,shelf_life_until,handling_minutes,priority,synthetic)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [fleet.sub,data.reference,data.cargoType,data.weightTons,data.origin,data.destination,data.originLat,data.originLng,
        data.destinationLat,data.destinationLng,data.deadline,data.shelfLifeUntil,data.handlingMinutes,data.priority,data.synthetic]))[0].id;
    }
    const critical=await insert(body('TEST-DAIRY-LOAD'));
    const frozen=await insert(body('TEST-FROZEN-LOAD',{cargoType:'Frozen',priority:'high'}));
    const oversized=await insert(body('TEST-OVERSIZED',{weightTons:8}));
    const approval=await insert(body('TEST-APPROVAL-LOAD',{synthetic:false}));
    const foreignShipment=await insert(body('TEST-OTHER-LOAD'),outsider);
    const broadcasts=[];
    let routeCalls=0;
    const route={getRoute:async(from,to)=>{
      routeCalls++;
      if (to.latitude===29) throw new Error('Synthetic route unavailable');
      const distanceKm=Math.abs(from.latitude-to.latitude)*100+Math.abs(from.longitude-to.longitude)*90;
      return {distanceKm,durationSeconds:Math.ceil(distanceKm*60)};
    }};
    class TestModule { configure(consumer) { AppModule.prototype.configure(consumer); } }
    Module({controllers:[AuthController,FleetController,TripsController],providers:[AuthService,TripsService,FleetService,
      {provide:RoutingService,useValue:route},
      {provide:TrackingGateway,useValue:{broadcastTripUpdate:(trip,event)=>broadcasts.push({id:trip.id,event})}},
      {provide:NeonService,useValue:{getSql:()=>query,runTransaction:statements=>db.transaction(async tx=>{
        const rows=[];
        for (const {text,values} of statements) rows.push((await tx.query(text,values)).rows);
        return rows;
      })}},
    ]})(TestModule);
    app=await NestFactory.create(TestModule,{logger:['error']});
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({transform:true,whitelist:true,forbidNonWhitelisted:true}));
    await app.listen(0,'127.0.0.1');
    return {app,close,query,password,body,insert,broadcasts,routeCalls:()=>routeCalls,owner,outsider,admin,
      versatile,dairy,blocked,operational,foreign,critical,frozen,oversized,approval,foreignShipment};
  } catch (error) {
    await close();
    throw error;
  }
}
module.exports={makeFleetFixture};
