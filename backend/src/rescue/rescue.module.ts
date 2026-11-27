import { Module } from '@nestjs/common';
import { IotModule } from '../iot/iot.module';
import { RescueController } from './rescue.controller';
import { RescueLocationService } from './rescue-location.service';
import { RescueRankingService } from './rescue-ranking.service';
import { RescueTelemetryService } from './rescue-telemetry.service';
import { RescueService } from './rescue.service';
import { RoutingService } from './routing.service';
import { WarehouseService } from './warehouse.service';

@Module({
    imports: [IotModule],
    controllers: [RescueController],
    providers: [
        RescueService, RescueLocationService, RescueRankingService,
        RescueTelemetryService, RoutingService, WarehouseService
    ]
})
export class RescueModule {}
