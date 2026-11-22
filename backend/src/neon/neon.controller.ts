import { Controller, Get, ForbiddenException, Req } from '@nestjs/common';
import { Request } from 'express';
import { NeonService } from './neon.service';

@Controller('api/neon')
export class NeonController {
  constructor(private readonly neonService: NeonService) {}

  @Get('health')
  getHealth() {
    return {
      status: 'ok',
      service: 'coldchain-backend',
      timestamp: new Date().toISOString(),
    };
  }

  private assertDiagnosticsAllowed(req: Request) {
    if (process.env.ENABLE_DIAGNOSTICS !== 'true' || req.user?.role !== 'admin') {
      throw new ForbiddenException('Diagnostic test endpoints are disabled.');
    }
  }

  @Get('test-postgres')
  async testPostgres(@Req() req: Request) {
    this.assertDiagnosticsAllowed(req);
    return this.neonService.testPostgres();
  }

  @Get('test-storage')
  async testStorage(@Req() req: Request) {
    this.assertDiagnosticsAllowed(req);
    return this.neonService.testObjectStorage();
  }

  @Get('test-auth')
  async testAuth(@Req() req: Request) {
    this.assertDiagnosticsAllowed(req);
    return this.neonService.testAuth();
  }

  @Get('test-function')
  async testFunction(@Req() req: Request) {
    this.assertDiagnosticsAllowed(req);
    return this.neonService.testFunction();
  }

  @Get('test-all')
  async testAll(@Req() req: Request) {
    this.assertDiagnosticsAllowed(req);
    return this.neonService.testAllServices();
  }
}
