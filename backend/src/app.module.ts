import { Module, MiddlewareConsumer, NestModule, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NeonModule } from './neon/neon.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { OwnerModule } from './owner/owner.module';
import { TruckModule } from './truck/truck.module';
import { IotModule } from './iot/iot.module';
import { AdminController } from './admin/admin.controller';
import { OwnerController } from './owner/owner.controller';
import { TruckController } from './truck/truck.controller';
import { IotController } from './iot/iot.controller';
import { AuthGuardMiddleware } from './middlewares/auth.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../.env.local'],
    }),
    NeonModule,
    AuthModule,
    AdminModule,
    OwnerModule,
    TruckModule,
    IotModule,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Apply auth guard to all protected routes
    consumer
      .apply(AuthGuardMiddleware)
      .exclude(
        { path: 'api/auth/login', method: RequestMethod.POST },
        { path: 'api/neon/health', method: RequestMethod.GET },
        { path: 'api/iot/ingest', method: RequestMethod.POST },
      )
      .forRoutes(
        AdminController,
        OwnerController,
        TruckController,
        IotController,
        { path: 'api/auth/me', method: RequestMethod.GET },
        { path: 'api/auth/logout', method: RequestMethod.POST },
      );
  }
}
