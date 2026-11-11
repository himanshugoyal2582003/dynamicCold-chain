import { Module } from '@nestjs/common';
import { OwnerService } from './owner.service';
import { OwnerController } from './owner.controller';
import { NeonModule } from '../neon/neon.module';

@Module({
  imports: [NeonModule],
  providers: [OwnerService],
  controllers: [OwnerController],
})
export class OwnerModule {}
