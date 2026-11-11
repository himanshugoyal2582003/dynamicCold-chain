import { Module, Global } from '@nestjs/common';
import { NeonService } from './neon.service';
import { NeonController } from './neon.controller';

@Global()
@Module({
  controllers: [NeonController],
  providers: [NeonService],
  exports: [NeonService],
})
export class NeonModule {}
