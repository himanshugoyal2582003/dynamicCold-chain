import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import * as path from 'path';
import { NeonModule } from './neon/neon.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { OwnerModule } from './owner/owner.module';
import { TruckModule } from './truck/truck.module';
import { IotModule } from './iot/iot.module';
import { TrackingModule } from './tracking/tracking.module';
import { TripsModule } from './trips/trips.module';
import { AdminController } from './admin/admin.controller';
import { OwnerController } from './owner/owner.controller';
import { TruckController } from './truck/truck.controller';
import { IotController } from './iot/iot.controller';
import { TrackingController } from './tracking/tracking.controller';
import { TripsController, DriverTripsController } from './trips/trips.controller';
import { NeonController } from './neon/neon.controller';
import { AuthGuardMiddleware } from './middlewares/auth.middleware';
import { CsrfMiddleware } from './middlewares/csrf.middleware';
import { RescueModule } from './rescue/rescue.module';
import { RescueController } from './rescue/rescue.controller';
import { MaintenanceModule } from './maintenance/maintenance.module';
import { MaintenanceController } from './maintenance/maintenance.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        path.resolve(__dirname, '../.env'),
        path.resolve(__dirname, '../../.env'),
        path.resolve(__dirname, '../../.env.local'),
      ],
    }),
    NeonModule,
    AuthModule,
    AdminModule,
    OwnerModule,
    TruckModule,
    IotModule,
    TrackingModule,
    TripsModule,
    RescueModule,
    MaintenanceModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply auth guard to all protected routes
    consumer
      .apply(AuthGuardMiddleware, CsrfMiddleware)
      .exclude(
        { path: 'api/auth/login', method: RequestMethod.POST },
        { path: 'api/neon/health', method: RequestMethod.GET },
        { path: 'api/iot/ingest', method: RequestMethod.POST },
        { path: 'api/iot/devices/registry-sync', method: RequestMethod.POST },
      )
      .forRoutes(
        AdminController,
        OwnerController,
        TruckController,
        IotController,
        TrackingController,
        TripsController,
        DriverTripsController,
        RescueController,
        MaintenanceController,
        NeonController,
        { path: 'api/auth/me', method: RequestMethod.GET },
        { path: 'api/auth/logout', method: RequestMethod.POST },
      );
  }
}
