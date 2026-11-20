import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  Req,
  UnauthorizedException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Request } from 'express';
import { TrackingService } from './tracking.service';
import { UpdateLocationDto } from './dto/update-location.dto';

function assertAuth(req: Request) {
  if (!req.user) throw new UnauthorizedException('Not authenticated.');
  return req.user;
}

@Controller('api/tracking')
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) { }

  /**
   * POST /api/tracking/location — driver (truckUser) only
   * truck_id is ALWAYS resolved from req.user.truckId — never from body
   */
  @Post('location')
  async updateLocation(@Req() req: Request, @Body() body: any) {
    const user = assertAuth(req);
    if (user.role !== 'truckUser') {
      throw new ForbiddenException('Only truck drivers can post location updates.');
    }
    if (!user.truckId) {
      throw new ForbiddenException('No truck assigned to your account.');
    }

    const { dto, error } = UpdateLocationDto.validate(body);
    if (error) throw new BadRequestException(error);

    return this.trackingService.updateLocation(user.truckId, user.sub, dto);
  }

  /**
   * GET /api/tracking/live
   * admin: all trucks; owner: their trucks; driver: their truck
   */
  @Get('live')
  async getLive(@Req() req: Request) {
    const user = assertAuth(req);
    return this.trackingService.getLiveLocations(user.role, user.sub, user.truckId);
  }

  /**
   * GET /api/tracking/summary
   * Fleet tracking overview & intelligence metrics
   */
  @Get('summary')
  async getSummary(@Req() req: Request) {
    const user = assertAuth(req);
    return this.trackingService.getFleetSummary(user.role, user.sub);
  }

  /**
   * GET /api/tracking/status
   * All authenticated roles — returns GPS status of authorized trucks
   */
  @Get('status')
  async getStatus(@Req() req: Request) {
    const user = assertAuth(req);
    return this.trackingService.getGpsStatus(user.role, user.sub, user.truckId);
  }

  /**
   * GET /api/tracking/trucks/:truckId
   * admin: any; owner: must own it; driver: must be assigned
   */
  @Get('trucks/:truckId')
  async getTruckLocation(
    @Req() req: Request,
    @Param('truckId') truckId: string,
  ) {
    const user = assertAuth(req);
    return this.trackingService.getTruckLocation(
      truckId,
      user.role,
      user.sub,
      user.truckId,
    );
  }

  /**
   * GET /api/tracking/trucks/:truckId/route
   * Live navigation, remaining distance, ETA, route waypoints, geofencing
   */
  @Get('trucks/:truckId/route')
  async getTruckRoute(
    @Req() req: Request,
    @Param('truckId') truckId: string,
  ) {
    const user = assertAuth(req);
    return this.trackingService.getTruckRoute(
      truckId,
      user.role,
      user.sub,
      user.truckId,
    );
  }

  /**
   * GET /api/tracking/trucks/:truckId/history?limit=100&offset=0
   * admin: any; owner: must own it; driver: must be assigned
   */
  @Get('trucks/:truckId/history')
  async getTruckHistory(
    @Req() req: Request,
    @Param('truckId') truckId: string,
    @Query('limit') limitStr?: string,
    @Query('offset') offsetStr?: string,
  ) {
    const user = assertAuth(req);
    const limit = Math.min(parseInt(limitStr ?? '100', 10) || 100, 500);
    const offset = parseInt(offsetStr ?? '0', 10) || 0;
    return this.trackingService.getTruckLocationHistory(
      truckId,
      user.role,
      user.sub,
      user.truckId,
      limit,
      offset,
    );
  }
}
