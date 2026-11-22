import { Module } from '@nestjs/common';
import { NeonModule } from '../neon/neon.module';
import { TrackingModule } from '../tracking/tracking.module';
import { DriverTripsController, TripsController } from './trips.controller';
import { TripsService } from './trips.service';

@Module({
  imports: [NeonModule, TrackingModule],
  controllers: [TripsController, DriverTripsController],
  providers: [TripsService],
  exports: [TripsService],
})
export class TripsModule {}
