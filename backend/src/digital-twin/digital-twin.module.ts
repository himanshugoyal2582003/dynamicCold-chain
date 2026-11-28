import { Module } from '@nestjs/common';
import { IotModule } from '../iot/iot.module';
import { DigitalTwinController } from './digital-twin.controller';
import { DigitalTwinService } from './digital-twin.service';

@Module({
  imports: [IotModule],
  providers: [DigitalTwinService],
  controllers: [DigitalTwinController],
})
export class DigitalTwinModule {}
