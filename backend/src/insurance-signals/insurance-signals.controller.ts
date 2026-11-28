import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, NotFoundException,
  Param, ParseUUIDPipe, Post, Req, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { NeonService } from '../neon/neon.service';
import { assessSignals } from './signal-rules';

const MAX_SAMPLES=500;
const ADMIN = "EXISTS (SELECT 1 FROM users u WHERE u.id=$1 AND u.active AND u.role='admin')";
const instant = (value: string | Date) => new Date(value).getTime();

@Controller('api/insurance-signals')
export class InsuranceSignalsController {
  constructor(private readonly neon: NeonService) {}

  private async query(statement:string,params:unknown[]) {
    const sql=this.neon.getSql();
    if (!sql) throw new ServiceUnavailableException('Insurance review storage unavailable');
    try { return await sql(statement,params); }
    catch (error) {
      if ((error as {code?:string}).code==='42P01') throw new ServiceUnavailableException('Insurance review schema unavailable');
      throw error;
    }
  }

  private async admin(req:Request) {
    if (!req.user) throw new UnauthorizedException();
    if (req.user.role!=='admin' || !(await this.query(`SELECT 1 WHERE ${ADMIN}`,[req.user.sub])).length) {
      throw new ForbiddenException();
    }
    return req.user.sub;
  }

  @Get()
  @Header('Cache-Control','no-store')
  async list(@Req() req:Request) {
    const actor=await this.admin(req);
    const [trips,cases]=await Promise.all([
      this.query(`SELECT tr.id,tr.status,tr.started_at AT TIME ZONE 'UTC' AS started_at,t.plate_number
        FROM trips tr JOIN trucks t ON t.id=tr.truck_id
        WHERE tr.started_at >= now() AT TIME ZONE 'UTC' - interval '30 days' AND ${ADMIN}
        ORDER BY tr.started_at DESC,tr.id LIMIT 50`,[actor]),
      this.query(`SELECT c.id,c.trip_id,c.assessed_at,c.status,c.revision,c.assessment,t.plate_number
        FROM insurance_signal_cases c JOIN trips tr ON tr.id=c.trip_id JOIN trucks t ON t.id=tr.truck_id
        WHERE ${ADMIN} ORDER BY c.assessed_at DESC,c.id DESC LIMIT 50`,[actor]),
    ]);
    return {trips,cases};
  }

  @Post('trips/:id/case')
  async create(@Req() req:Request,@Param('id',ParseUUIDPipe) id:string) {
    const actor=await this.admin(req);
    const [trip]=await this.query(`SELECT truck_id,started_at AT TIME ZONE 'UTC' AS started,
      COALESCE(ended_at AT TIME ZONE 'UTC',now()) AS ended FROM trips WHERE id=$2 AND started_at IS NOT NULL AND ${ADMIN}`,[actor,id]);
    if (!trip) throw new NotFoundException('Started trip not found');
    const [gpsRows,sensorRows]=await Promise.all([
      this.query(`SELECT recorded_at AT TIME ZONE 'UTC' AS observed,latitude,longitude,accuracy_m
        FROM truck_location_history WHERE truck_id=$2 AND recorded_at >= ($3::timestamptz AT TIME ZONE 'UTC')
        AND recorded_at <= ($4::timestamptz AT TIME ZONE 'UTC') AND ${ADMIN}
        ORDER BY recorded_at DESC,id DESC LIMIT ${MAX_SAMPLES+1}`,[actor,trip.truck_id,trip.started,trip.ended]),
      this.query(`SELECT recorded_at AT TIME ZONE 'UTC' AS observed,device_id,temperature,humidity,target_temp
        FROM trip_telemetry_history WHERE trip_id=$2 AND recorded_at >= ($3::timestamptz AT TIME ZONE 'UTC')
        AND recorded_at <= ($4::timestamptz AT TIME ZONE 'UTC') AND ${ADMIN}
        AND model_type='PyTorch-SpoilageLSTM' AND device_id IS NOT NULL
        AND device_id !~* '^(SIM-|DEV-ESP32-|DEMO-|TEST-)'
        ORDER BY recorded_at DESC,id DESC LIMIT ${MAX_SAMPLES+1}`,[actor,id,trip.started,trip.ended]),
    ]);
    const assessment={
      ...assessSignals(gpsRows.slice(0,MAX_SAMPLES).map(row=>({at:instant(row.observed),latitude:Number(row.latitude),
        longitude:Number(row.longitude),accuracy:row.accuracy_m==null ? null : Number(row.accuracy_m)})),
        sensorRows.slice(0,MAX_SAMPLES).map(row=>({at:instant(row.observed),device:row.device_id,
          temperature:Number(row.temperature),humidity:Number(row.humidity),target:Number(row.target_temp)}))),
      truncated:gpsRows.length>MAX_SAMPLES || sensorRows.length>MAX_SAMPLES,
      interval:{start:new Date(trip.started).toISOString(),end:new Date(trip.ended).toISOString()},
    };
    const [item]=await this.query(`INSERT INTO insurance_signal_cases(trip_id,created_by,assessment)
      SELECT $2,$1,$3::jsonb WHERE ${ADMIN}
      ON CONFLICT(trip_id) DO NOTHING RETURNING id`,[actor,id,JSON.stringify(assessment)]);
    if(!item) throw new ConflictException('A case already exists or administrator access changed');
    return item;
  }

  @Get(':id/reviews')
  @Header('Cache-Control','no-store')
  async history(@Req() req:Request,@Param('id',ParseUUIDPipe) id:string) {
    const actor=await this.admin(req);
    return {reviews:await this.query(`SELECT revision,actor_id,status,note,reviewed_at FROM insurance_signal_review_log
      WHERE case_id=$2 AND ${ADMIN} ORDER BY revision DESC LIMIT 50`,[actor,id])};
  }

  @Post(':id/reviews')
  async review(@Req() req:Request,@Param('id',ParseUUIDPipe) id:string,
    @Body() body:{status?:string;note?:string;revision?:number}) {
    const actor=await this.admin(req);
    if (!body?.status || !['follow_up','explained','insufficient_evidence'].includes(body.status) ||
        typeof body.note!=='string' || body.note.trim().length<3 || body.note.trim().length>1000 ||
        typeof body.revision!=='number' || !Number.isSafeInteger(body.revision) || body.revision<0 ||
        Object.keys(body).some(key=>!['status','note','revision'].includes(key))) {
      throw new BadRequestException('Specify a review status, note and current revision');
    }
    const [updated]=await this.query(`WITH changed AS (
      UPDATE insurance_signal_cases SET status=$3,revision=revision+1 WHERE id=$2 AND revision=$5 AND ${ADMIN}
      RETURNING id,revision,status
    ) INSERT INTO insurance_signal_review_log(case_id,revision,actor_id,status,note)
      SELECT id,revision,$1,status,$4 FROM changed RETURNING revision`,[actor,id,body.status,body.note.trim(),body.revision]);
    if (!updated) throw new ConflictException('Case changed or is unavailable. Refresh and retry');
    return updated;
  }
}
