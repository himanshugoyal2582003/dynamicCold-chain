import { Controller, DefaultValuePipe, Get, Param, ParseIntPipe, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { MaintenanceService } from './maintenance.service';

@Controller('api/maintenance')
export class MaintenanceController {
  constructor(private readonly maintenance: MaintenanceService) {}

  @Get()
  fleet(@Req() req: Request, @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    return this.maintenance.getFleet(req.user, page);
  }

  @Get('trucks/:truckId/history')
  history(@Req() req: Request, @Param('truckId', ParseUUIDPipe) truckId: string) {
    return this.maintenance.getHistory(req.user, truckId);
  }
}
