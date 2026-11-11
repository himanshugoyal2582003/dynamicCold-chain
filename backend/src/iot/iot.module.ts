import { Module } from '@nestjs/common';
import { IotController } from './iot.controller';
import { IotService } from './iot.service';
import { NeonModule } from '../neon/neon.module';

@Module({
  imports: [NeonModule],
  controllers: [IotController],
  providers: [IotService],
  exports: [IotService],
})
export class IotModule {}

