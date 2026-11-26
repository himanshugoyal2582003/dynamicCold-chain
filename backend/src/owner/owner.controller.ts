import {
  Controller, Get, Patch, Post, Delete, Body, Param, Req,
  BadRequestException, UnauthorizedException, ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { OwnerService } from './owner.service';

function assertOwner(req: Request) {
  if (!req.user) throw new UnauthorizedException('Not authenticated.');
  if (req.user.role !== 'owner') throw new ForbiddenException('Owner only.');
  return req.user.sub;
}

@Controller('api/owner')
export class OwnerController {
  constructor(private readonly ownerService: OwnerService) {}

  @Get('trucks')
  async getMyTrucks(@Req() req: Request) {
    const ownerId = assertOwner(req);
    return this.ownerService.getMyTrucks(ownerId);
  }

  @Get('lstm-logs')
  async getLstmLogs(@Req() req: Request) {
    const ownerId = assertOwner(req);
    return this.ownerService.getLstmLogs(ownerId);
  }

  @Delete('trucks/:id')
  async deleteTruck(@Req() req: Request, @Param('id') id: string) {
    const ownerId = assertOwner(req);
    return this.ownerService.deleteTruck(ownerId, id);
  }

  @Get('trucks/:id')
  async getTruckDetail(@Req() req: Request, @Param('id') id: string) {
    const ownerId = assertOwner(req);
    return this.ownerService.getTruckDetail(ownerId, id);
  }

  @Get('trucks/:id/trips')
  async getTruckTrips(@Req() req: Request, @Param('id') id: string) {
    const ownerId = assertOwner(req);
    return this.ownerService.getTruckTrips(ownerId, id);
  }

  @Patch('trucks/:id/status')
  async updateStatus(@Req() req: Request, @Param('id') id: string, @Body() body: { status: string }) {
    const ownerId = assertOwner(req);
    return this.ownerService.updateTruckStatus(ownerId, id, body.status);
  }

  @Post('trucks/:id/assign-driver')
  async assignDriver(@Req() req: Request, @Param('id') id: string, @Body() body: { driverId: string }) {
    const ownerId = assertOwner(req);
    if (!body?.driverId) throw new BadRequestException('A driver must be selected.');
    return this.ownerService.assignDriver(ownerId, id, body.driverId);
  }

  @Get('trucks/:id/available-drivers')
  async getAvailableDrivers(@Req() req: Request, @Param('id') id: string) {
    const ownerId = assertOwner(req);
    return this.ownerService.getAvailableDrivers(ownerId, id);
  }

  @Get('drivers')
  async getDrivers(@Req() req: Request) {
    const ownerId = assertOwner(req);
    return this.ownerService.getMyDrivers(ownerId);
  }

  @Delete('drivers/:id')
  async deleteDriver(@Req() req: Request, @Param('id') id: string) {
    const ownerId = assertOwner(req);
    return this.ownerService.deleteDriver(ownerId, id);
  }

  @Post('drivers')
  async createDriver(
    @Req() req: Request,
    @Body() body: { name: string; email: string; password?: string; truckId?: string },
  ) {
    const ownerId = assertOwner(req);
    return this.ownerService.createDriver(ownerId, body);
  }

  @Patch('trucks/:id/target-temp')
  async updateTargetTemp(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: { targetTempC: number },
  ) {
    const ownerId = assertOwner(req);
    return this.ownerService.updateTargetTemp(ownerId, id, body.targetTempC);
  }

  @Post('trucks')
  async createTruck(
    @Req() req: Request,
    @Body()
    body: {
      plate_number: string;
      type: string;
      capacity_tons: number;
      target_temp_c?: number;
      iot_connection_number?: string;
    },
  ) {
    const ownerId = assertOwner(req);
    return this.ownerService.createTruck(ownerId, body);
  }
}
