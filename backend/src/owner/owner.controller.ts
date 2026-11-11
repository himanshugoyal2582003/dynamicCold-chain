import {
  Controller, Get, Patch, Post, Body, Param, Req, UnauthorizedException, ForbiddenException,
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
    return this.ownerService.assignDriver(ownerId, id, body.driverId);
  }

  @Get('drivers')
  async getDrivers(@Req() req: Request) {
    const ownerId = assertOwner(req);
    return this.ownerService.getMyDrivers(ownerId);
  }
}
