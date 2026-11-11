import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  BadRequestException,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { IotService, EnrichedIoTTelemetry } from './iot.service';

@Controller('api/iot')
export class IotController {
  constructor(private readonly iotService: IotService) {}

  // 1. Machine-to-machine ingestion from AI/ML service
  @Post('ingest')
  ingest(@Body() body: EnrichedIoTTelemetry) {
    if (!body || !body.connection_number) {
      throw new BadRequestException('Invalid telemetry payload: connection_number required');
    }
    return this.iotService.ingest(body);
  }

  // 2. List active IoT devices (Requires verified JWT)
  @Get('devices')
  getActiveDevices(@Req() req: Request) {
    if (!req.user) throw new UnauthorizedException('Authentication required.');
    return {
      success: true,
      devices: this.iotService.getActiveDevices(),
    };
  }

  // 3. Connect a truck to an IoT device with strict IDOR ownership check
  @Post('connect')
  async connectDevice(
    @Req() req: Request,
    @Body() body: { truckId: string; connectionNumber: string },
  ) {
    if (!req.user) throw new UnauthorizedException('Authentication required.');
    if (!body.truckId || !body.connectionNumber) {
      throw new BadRequestException('truckId and connectionNumber are required');
    }

    // Verify user owns or is assigned to this truck
    const hasAccess = await this.iotService.verifyTruckAccess(req.user, body.truckId);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied: You do not have permission to manage this vehicle.');
    }

    return this.iotService.connectDevice(body.truckId, body.connectionNumber);
  }

  // 4. Disconnect truck from IoT device with strict IDOR ownership check
  @Post('disconnect')
  async disconnectDevice(
    @Req() req: Request,
    @Body() body: { truckId: string },
  ) {
    if (!req.user) throw new UnauthorizedException('Authentication required.');
    if (!body.truckId) {
      throw new BadRequestException('truckId is required');
    }

    const hasAccess = await this.iotService.verifyTruckAccess(req.user, body.truckId);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied: You do not have permission to manage this vehicle.');
    }

    return this.iotService.disconnectDevice(body.truckId);
  }

  // 5. Get latest enriched telemetry with strict IDOR protection
  @Get('telemetry/:truckId')
  async getTelemetry(@Req() req: Request, @Param('truckId') truckId: string) {
    if (!req.user) throw new UnauthorizedException('Authentication required.');

    const hasAccess = await this.iotService.verifyTruckAccess(req.user, truckId);
    if (!hasAccess) {
      throw new ForbiddenException('Access denied: You cannot access telemetry for another vehicle.');
    }

    const telemetry = this.iotService.getTelemetryForTruck(truckId);
    return {
      success: true,
      truckId,
      telemetry: telemetry || null,
      connectionNumber: this.iotService.getConnectionForTruck(truckId),
    };
  }
}
