import {
  Controller, Get, Post, Patch, Body, Param, Req,
  UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { TruckService } from './truck.service';

function assertTruckUser(req: Request) {
  if (!req.user) throw new UnauthorizedException('Not authenticated.');
  if (req.user.role !== 'truckUser') throw new ForbiddenException('Truck User only.');
  if (!req.user.truckId) throw new ForbiddenException('No truck assigned to your account.');
  return { userId: req.user.sub, truckId: req.user.truckId };
}

@Controller('api/truck')
export class TruckController {
  constructor(private readonly truckService: TruckService) {}

  @Get('my-truck')
  async getMyTruck(@Req() req: Request) {
    const { truckId } = assertTruckUser(req);
    return this.truckService.getMyTruck(truckId);
  }

  @Get('active-trip')
  async getActiveTrip(@Req() req: Request) {
    const { truckId } = assertTruckUser(req);
    return this.truckService.getActiveTrip(truckId);
  }

  @Post('start-trip')
  async startTrip(
    @Req() req: Request,
    @Body() body: { origin: string; destination: string; cargo_type: string; notes?: string },
  ) {
    const { userId, truckId } = assertTruckUser(req);
    return this.truckService.startTrip(userId, truckId, body);
  }

  @Post('end-trip/:tripId')
  async endTrip(@Req() req: Request, @Param('tripId') tripId: string) {
    const { userId, truckId } = assertTruckUser(req);
    return this.truckService.endTrip(userId, truckId, tripId);
  }

  @Patch('target-temp')
  async setTargetTemp(@Req() req: Request, @Body() body: { targetTempC: number }) {
    const { truckId } = assertTruckUser(req);
    return this.truckService.setTargetTemp(truckId, body.targetTempC);
  }

  @Post('report-issue')
  async reportIssue(@Req() req: Request, @Body() body: { description: string }) {
    const { userId, truckId } = assertTruckUser(req);
    return this.truckService.reportIssue(userId, truckId, body.description);
  }

  @Get('trip-history')
  async getTripHistory(@Req() req: Request) {
    const { truckId } = assertTruckUser(req);
    return this.truckService.getTripHistory(truckId);
  }

  @Get('issues')
  async getIssues(@Req() req: Request) {
    const { truckId } = assertTruckUser(req);
    return this.truckService.getMyIssues(truckId);
  }

  @Get('telemetry')
  async getTelemetry(@Req() req: Request) {
    const { truckId } = assertTruckUser(req);
    return this.truckService.getTelemetry(truckId);
  }

  @Post('connect-iot')
  async connectIot(@Req() req: Request, @Body() body: { connectionNumber: string }) {
    const { truckId } = assertTruckUser(req);
    return this.truckService.connectIot(truckId, body.connectionNumber);
  }

  @Post('disconnect-iot')
  async disconnectIot(@Req() req: Request) {
    const { truckId } = assertTruckUser(req);
    return this.truckService.disconnectIot(truckId);
  }
}
