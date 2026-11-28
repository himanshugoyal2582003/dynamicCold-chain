import { Module } from '@nestjs/common';
import { IotController } from './iot.controller';
import { IotService } from './iot.service';
import { NeonModule } from '../neon/neon.module';
import { MaintenanceModule } from '../maintenance/maintenance.module';
import { TelemetryDeliveryController } from './telemetry-delivery.controller';

@Module({
  imports: [NeonModule, MaintenanceModule],
  controllers: [IotController, TelemetryDeliveryController],
  providers: [IotService],
  exports: [IotService],
})
export class IotModule {}

