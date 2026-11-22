import { Controller, Get, ForbiddenException, Req, Res } from '@nestjs/common';
import { Request, Response } from 'express';
import { NeonService } from './neon.service';

@Controller('api/neon')
export class NeonController {
  constructor(private readonly neonService: NeonService) {}

  @Get('health')
  async getHealth(@Res({ passthrough: true }) response: Response) {
    const database = await this.neonService.getDatabaseHealth();
    if (!database.querySucceeded) response.status(503);
    return {
      status: database.querySucceeded ? database.status : 'degraded',
      service: 'coldchain-backend',
      timestamp: new Date().toISOString(),
      database,
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
