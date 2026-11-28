import { Module } from '@nestjs/common';
import { RescueModule } from '../rescue/rescue.module';
import { TripsModule } from '../trips/trips.module';
import { FleetController } from './fleet.controller';
import { FleetService } from './fleet.service';

@Module({ imports:[RescueModule,TripsModule], controllers:[FleetController], providers:[FleetService] })
export class FleetModule {}
