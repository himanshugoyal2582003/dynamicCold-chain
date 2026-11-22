import {
  BadRequestException, Body, Controller, Get, Param, Patch, Post, Query,
  Req, UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { TripsService } from './trips.service';

function userFrom(req: Request) {
  if (!req.user) throw new UnauthorizedException('Not authenticated.');
  return req.user;
}

function validUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '');
}

@Controller('api/trips')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get('resources')
  async resources(@Req() req: Request) {
    const user = userFrom(req);
    return this.trips.getResources(user.role, user.sub);
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('ownerId') ownerId?: string,
    @Query('truckId') truckId?: string,
    @Query('driverId') driverId?: string,
    @Query('status') status?: string,
  ) {
    const user = userFrom(req);
    for (const [label, value] of [['Owner', ownerId], ['Truck', truckId], ['Driver', driverId]] as const) {
      if (value && !validUuid(value)) throw new BadRequestException(`${label} filter must be a valid UUID.`);
    }
    return this.trips.listTrips(user.role, user.sub, { ownerId, truckId, driverId, status });
  }

  @Post()
  async assign(@Req() req: Request, @Body() body: any) {
    const user = userFrom(req);
    if (!['admin', 'owner'].includes(user.role)) throw new ForbiddenException('Only administrators and fleet owners can assign trips.');
    if (!body || !validUuid(body.truck_id) || !validUuid(body.user_id)) {
      throw new BadRequestException('Valid truck_id and user_id UUIDs are required.');
    }
    if (typeof body.origin !== 'string' || typeof body.destination !== 'string' || typeof body.cargo_type !== 'string') {
      throw new BadRequestException('Origin, destination, and cargo_type are required.');
    }
    if (body.notes !== undefined && body.notes !== null && typeof body.notes !== 'string') {
      throw new BadRequestException('Shipment notes must be text.');
    }
    return this.trips.createTrip(user, body);
  }

  @Get(':id')
  async detail(@Req() req: Request, @Param('id') id: string) {
    if (!validUuid(id)) throw new BadRequestException('Trip ID must be a valid UUID.');
    const user = userFrom(req);
    return this.trips.getTripById(id, user.role, user.sub);
  }

  @Patch(':id/reopen')
  async reopen(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    const user = userFrom(req);
    if (user.role !== 'admin') throw new ForbiddenException('Only an administrator can reopen a completed trip.');
    if (!validUuid(id)) throw new BadRequestException('Trip ID must be a valid UUID.');
    if (typeof body?.reason !== 'string' || body.reason.trim().length < 10 || body.reason.trim().length > 1000) {
      throw new BadRequestException('A correction reason between 10 and 1000 characters is required.');
    }
    return this.trips.reopenCompletedTrip(user.sub, id, body.reason.trim());
  }
}

@Controller('api/truck')
export class DriverTripsController {
  constructor(private readonly trips: TripsService) {}

  private assertDriver(req: Request) {
    const user = userFrom(req);
    if (user.role !== 'truckUser') throw new ForbiddenException('Truck User only.');
    return user;
  }

  @Get('assigned-trip')
  async assigned(@Req() req: Request) {
    const user = this.assertDriver(req);
    return { success: true, trip: await this.trips.getDriverTrip(user.sub, user.truckId) };
  }

  @Post('start-trip')
  async start(@Req() req: Request) {
    const user = this.assertDriver(req);
    return this.trips.startTrip(user.sub, user.truckId);
  }

  @Patch('trips/:tripId/complete')
  async complete(@Req() req: Request, @Param('tripId') tripId: string) {
    const user = this.assertDriver(req);
    if (!validUuid(tripId)) throw new BadRequestException('Trip ID must be a valid UUID.');
    return this.trips.completeTrip(user.sub, user.truckId, tripId);
  }
}
