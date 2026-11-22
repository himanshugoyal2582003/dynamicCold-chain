import {
  Controller, Get, Post, Patch, Body, Param, Req,
  UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { TruckService } from './truck.service';

function assertTruckUser(req: Request) {
  if (!req.user) throw new UnauthorizedException('Not authenticated.');
  if (req.user.role !== 'truckUser') throw new ForbiddenException('Truck User only.');
  return { userId: req.user.sub, truckId: req.user.truckId };
}

function assertAssignedTruckUser(req: Request) {
  const user = assertTruckUser(req);
  if (!user.truckId) throw new ForbiddenException('No active truck is assigned to your account.');
  return { ...user, truckId: user.truckId };
}

@Controller('api/truck')
export class TruckController {
  constructor(private readonly truckService: TruckService) {}

  @Get('my-truck')
  async getMyTruck(@Req() req: Request) {
    const { userId } = assertTruckUser(req);
    return this.truckService.getMyTruckForDriver(userId);
  }

  @Get('active-trip')
  async getActiveTrip(@Req() req: Request) {
    const { truckId } = assertTruckUser(req);
    const trip = truckId ? await this.truckService.getActiveTrip(truckId) : null;
    return { success: true, trip };
  }

  @Post('start-trip')
  async startTrip(
    @Req() req: Request,
    @Body() body: { origin: string; destination: string; cargo_type: string; notes?: string },
  ) {
    const { userId, truckId } = assertAssignedTruckUser(req);
    return this.truckService.startTrip(userId, truckId, body);
  }

  @Post('end-trip/:tripId')
  async endTrip(@Req() req: Request, @Param('tripId') tripId: string) {
    const { userId, truckId } = assertAssignedTruckUser(req);
    return this.truckService.endTrip(userId, truckId, tripId);
  }

  @Patch('target-temp')
  async setTargetTemp(@Req() req: Request, @Body() body: { targetTempC: number }) {
    const { truckId } = assertAssignedTruckUser(req);
    return this.truckService.setTargetTemp(truckId, body.targetTempC);
  }

  @Post('report-issue')
  async reportIssue(@Req() req: Request, @Body() body: { description: string }) {
    const { userId, truckId } = assertAssignedTruckUser(req);
    return this.truckService.reportIssue(userId, truckId, body.description);
  }

  @Get('trip-history')
  async getTripHistory(@Req() req: Request) {
    const { truckId } = assertAssignedTruckUser(req);
    return this.truckService.getTripHistory(truckId);
  }

  @Get('issues')
  async getIssues(@Req() req: Request) {
    const { truckId } = assertAssignedTruckUser(req);
    return this.truckService.getMyIssues(truckId);
  }

  @Get('telemetry')
  async getTelemetry(@Req() req: Request) {
    const { truckId } = assertAssignedTruckUser(req);
    return this.truckService.getTelemetry(truckId);
  }

  @Post('connect-iot')
  connectIot(@Req() req: Request) {
    assertAssignedTruckUser(req);
    throw new ForbiddenException('IoT device pairing is managed by an administrator or fleet owner.');
  }

  @Post('disconnect-iot')
  disconnectIot(@Req() req: Request) {
    assertAssignedTruckUser(req);
    throw new ForbiddenException('IoT device pairing is managed by an administrator or fleet owner.');
  }
}
