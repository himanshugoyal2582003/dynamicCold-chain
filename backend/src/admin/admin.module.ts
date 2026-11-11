import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { NeonModule } from '../neon/neon.module';

@Module({
  imports: [NeonModule],
  providers: [AdminService],
  controllers: [AdminController],
})
export class AdminModule {}
