import { Module } from '@nestjs/common';
import { TruckService } from './truck.service';
import { TruckController } from './truck.controller';
import { NeonModule } from '../neon/neon.module';
import { IotModule } from '../iot/iot.module';

@Module({
  imports: [NeonModule, IotModule],
  providers: [TruckService],
  controllers: [TruckController],
})
export class TruckModule {}
