import {
  BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, Header, Headers,
  HttpCode, HttpException, HttpStatus, Post, Req, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { createHash } from 'crypto';
import { NeonService } from '../neon/neon.service';
import { verifyIngestSecret } from './iot.controller';
import { EnrichedIoTTelemetry, IotService } from './iot.service';

@Controller('api/iot/delivery')
export class TelemetryDeliveryController {
  private readonly writing = new Set<string>();

  constructor(private readonly neon: NeonService, private readonly iot: IotService) {}

  private get sql() {
    const sql = this.neon.getSql();
    if (!sql) throw new ServiceUnavailableException('Telemetry database unavailable');
    return sql;
  }

  @Post('accept')
  @HttpCode(200)
  async accept(@Body() body: EnrichedIoTTelemetry, @Headers('x-iot-ingest-secret') secret?: string,
    @Headers('x-telemetry-event-id') id?: string) {
    if (!process.env.IOT_INGEST_SECRET?.trim()) throw new UnauthorizedException('Durable ingress requires a configured ingest secret');
    verifyIngestSecret(secret);
    const connection = typeof body?.connection_number === 'string' ? body.connection_number.trim().toUpperCase() : '';
    const device = typeof body?.device_id === 'string' ? body.device_id.trim() : '';
    const timestamp = body?.timestamp;
    const observed = typeof timestamp === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(timestamp) ? Date.parse(timestamp) : NaN;
    if (!id || !/^[a-f0-9]{64}$/.test(id) || !connection || connection.length > 50 || !device || device.length > 100 ||
        !Number.isFinite(observed) || observed > Date.now()+5000 || !Number.isFinite(body.temperature) ||
        !Number.isFinite(body.target_temp) || !Number.isFinite(body.humidity) || !Number.isFinite(body.spoilage_risk) ||
        !Number.isFinite(body.shelf_life_remaining_hours)) {
      throw new BadRequestException('Invalid durable telemetry envelope');
    }
    if (Date.now()-observed > 120_000) return {success:true,disposition:'expired'};
    const identity = createHash('sha256').update(JSON.stringify([device,connection,new Date(observed).toISOString()])).digest('hex');
    if (identity !== id) throw new BadRequestException('Telemetry event identifier does not match the envelope');
    if (this.writing.has(connection) || this.writing.size >= 64) throw new HttpException('Telemetry delivery busy',HttpStatus.TOO_MANY_REQUESTS);
    this.writing.add(connection);
    try {
      const [head] = await this.sql(
        `INSERT INTO telemetry_delivery_heads(connection_number,observed_at,event_id)
         VALUES($1,$2,$3) ON CONFLICT(connection_number) DO UPDATE
         SET observed_at=excluded.observed_at,event_id=excluded.event_id,projected=false
         WHERE telemetry_delivery_heads.observed_at < excluded.observed_at
         RETURNING event_id`, [connection,new Date(observed).toISOString(),id]);
      if (!head) {
        const [existing] = await this.sql(
          'SELECT event_id,projected FROM telemetry_delivery_heads WHERE connection_number=$1',[connection]);
        if (existing?.event_id !== id) return {success:true,disposition:'out_of_order'};
        if (existing.projected) return {success:true,disposition:'duplicate'};
      }
      if (Date.now()-observed > 120_000) return {success:true,disposition:'expired'};
      const outcome = await this.iot.ingest({...body,connection_number:connection,device_id:device},'sensor',true);
      if (!outcome.success) throw new ConflictException('Telemetry rejected by pairing validation');
      await this.sql('UPDATE telemetry_delivery_heads SET projected=true WHERE connection_number=$1 AND event_id=$2',[connection,id]);
      return {success:true,disposition:outcome.ignored ? 'out_of_order' : 'applied'};
    } catch (error) {
      if ((error as {code?:string}).code === '42P01') throw new ServiceUnavailableException('Telemetry delivery schema unavailable');
      throw error;
    } finally {
      this.writing.delete(connection);
    }
  }

  private async administrator(req: Request) {
    if (!req.user) throw new UnauthorizedException();
    if (req.user.role !== 'admin') throw new ForbiddenException();
    const [row] = await this.sql("SELECT 1 FROM users WHERE id=$1 AND active AND role='admin'",[req.user.sub]);
    if (!row) throw new ForbiddenException();
    return req.user.sub;
  }

  private async outbox(path: string, body?: {actor:string}) {
    const token = process.env.TELEMETRY_MONITOR_TOKEN?.trim();
    if (!token) throw new ServiceUnavailableException('AI/ML service authentication unavailable');
    const base = (process.env.AI_ML_API_URL || 'http://localhost:8000').replace(/\/+$/,'');
    try {
      return await fetch(base+'/internal/telemetry-outbox'+path,{
        method:body ? 'POST' : 'GET', headers:{'x-service-token':token,'Content-Type':'application/json'},
        body:body ? JSON.stringify(body) : undefined, signal:AbortSignal.timeout(5000), redirect:'error',
      });
    } catch {
      throw new ServiceUnavailableException('AI/ML delivery monitor unavailable');
    }
  }

  @Get('status')
  @Header('Cache-Control','no-store')
  async status(@Req() req: Request) {
    await this.administrator(req);
    const response = await this.outbox('');
    if (!response.ok) throw new ServiceUnavailableException('AI/ML delivery monitor unavailable');
    return response.json();
  }

  @Post('replay')
  @HttpCode(200)
  async replay(@Req() req: Request,@Body() body: {eventId?: string}) {
    const actor = await this.administrator(req);
    if (typeof body?.eventId !== 'string' || !/^[a-f0-9]{64}$/.test(body.eventId)) {
      throw new BadRequestException('Invalid telemetry event identifier');
    }
    const response = await this.outbox('/'+body.eventId+'/replay',{actor});
    if (response.status === 409) throw new ConflictException('Event is not queued as a dead letter');
    if (!response.ok) throw new ServiceUnavailableException('AI/ML replay service unavailable');
    return {queued:true};
  }
}
