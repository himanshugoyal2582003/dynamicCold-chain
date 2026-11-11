import { Controller, Get, ForbiddenException } from '@nestjs/common';
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

  private assertDiagnosticsAllowed() {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('Diagnostic test endpoints are disabled in production');
    }
  }

  @Get('test-postgres')
  async testPostgres() {
    this.assertDiagnosticsAllowed();
    return this.neonService.testPostgres();
  }

  @Get('test-storage')
  async testStorage() {
    this.assertDiagnosticsAllowed();
    return this.neonService.testObjectStorage();
  }

  @Get('test-auth')
  async testAuth() {
    this.assertDiagnosticsAllowed();
    return this.neonService.testAuth();
  }

  @Get('test-function')
  async testFunction() {
    this.assertDiagnosticsAllowed();
    return this.neonService.testFunction();
  }

  @Get('test-all')
  async testAll() {
    this.assertDiagnosticsAllowed();
    return this.neonService.testAllServices();
  }
}
