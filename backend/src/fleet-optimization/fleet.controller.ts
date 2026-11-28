import { Body, Controller, Get, Header, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { Request } from 'express';
import { approvalInput, planInput, profileInput, shipmentInput, uuid } from './fleet-input';
import { FleetService } from './fleet.service';

@Controller('api/fleet-optimization')
export class FleetController {
  constructor(private readonly fleet: FleetService) {}

  @Get('fleets')
  @Header('Cache-Control','no-store')
  fleets(@Req() req: Request) { return this.fleet.fleets(req.user); }

  @Get('fleets/:ownerId')
  @Header('Cache-Control','no-store')
  resources(@Req() req: Request,@Param('ownerId') ownerId: string) {
    return this.fleet.resources(req.user,uuid(ownerId));
  }

  @Post('fleets/:ownerId/shipments')
  shipment(@Req() req: Request,@Param('ownerId') ownerId: string,@Body() body: unknown) {
    return this.fleet.createShipment(req.user,uuid(ownerId),shipmentInput(body));
  }

  @Put('fleets/:ownerId/trucks/:truckId/profile')
  profile(@Req() req: Request,@Param('ownerId') ownerId: string,@Param('truckId') truckId: string,@Body() body: unknown) {
    return this.fleet.saveProfile(req.user,uuid(ownerId),uuid(truckId),profileInput(body));
  }

  @Post('fleets/:ownerId/plan')
  @HttpCode(200)
  @Header('Cache-Control','no-store')
  plan(@Req() req: Request,@Param('ownerId') ownerId: string,@Body() body: unknown) {
    return this.fleet.plan(req.user,uuid(ownerId),planInput(body));
  }

  @Post('fleets/:ownerId/approve')
  approve(@Req() req: Request,@Param('ownerId') ownerId: string,@Body() body: unknown) {
    return this.fleet.approve(req.user,uuid(ownerId),approvalInput(body));
  }
}
