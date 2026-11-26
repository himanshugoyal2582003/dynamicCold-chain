import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, Req, UseGuards,
  BadRequestException, ForbiddenException, UnauthorizedException, Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { AdminService } from './admin.service';
import { AuthGuardMiddleware } from '../middlewares/auth.middleware';

// Simple decorator-based role check helper
function assertAdmin(req: Request) {
  if (!req.user) throw new UnauthorizedException('Not authenticated.');
  if (req.user.role !== 'admin') throw new ForbiddenException('Admin only.');
}

@Controller('api/admin')
export class AdminController {
  private readonly logger = new Logger(AdminController.name);
  constructor(private readonly adminService: AdminService) {}

  // ─── METRICS ──────────────────────────────────────────────────────────────
  @Get('metrics')
  async getMetrics(@Req() req: Request) {
    assertAdmin(req);
    return this.adminService.getMetrics();
  }

  // ─── OWNERS ───────────────────────────────────────────────────────────────
  @Get('owners')
  async listOwners(@Req() req: Request, @Query('active') activeOnly?: string) {
    assertAdmin(req);
    return this.adminService.listOwners(activeOnly === 'true');
  }

  @Post('owners')
  async createOwner(@Req() req: Request, @Body() body: { name: string; email: string; password: string }) {
    assertAdmin(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Owner details are required.');
    }
    const owner = await this.adminService.createOwner(body.name, body.email, body.password);
    await this.adminService.logActivity(req.user!.sub, 'CREATE_OWNER', 'USER', owner.id, { name: owner.name });
    return owner;
  }

  @Patch('owners/:id/deactivate')
  async deactivateOwner(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);
    const result = await this.adminService.deactivateOwner(id);
    await this.adminService.logActivity(req.user!.sub, 'DEACTIVATE_OWNER', 'USER', id, {});
    return result;
  }

  @Delete('owners/:id')
  async deleteOwner(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);
    const result = await this.adminService.deleteOwner(id);
    await this.adminService.logActivity(req.user!.sub, 'DELETE_OWNER', 'USER', id, {});
    return result;
  }

  // ─── TRUCKS ───────────────────────────────────────────────────────────────
  @Get('trucks')
  async listTrucks(@Req() req: Request) {
    assertAdmin(req);
    if (process.env.NODE_ENV !== 'production') {
      this.logger.log('[TRUCK DEBUG] Fetching trucks');
      this.logger.log(`[TRUCK DEBUG] Authenticated user id=${req.user!.sub} role=${req.user!.role}`);
    }
    return this.adminService.listTrucks();
  }

  @Get('trucks/:id/available-drivers')
  async getAvailableDrivers(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);
    return this.adminService.getAvailableDrivers(id);
  }

  @Post('trucks/:id/assign-driver')
  async assignDriver(@Req() req: Request, @Param('id') id: string, @Body() body: { driverId: string }) {
    assertAdmin(req);
    if (!body?.driverId) throw new BadRequestException('A driver must be selected.');
    const result = await this.adminService.assignDriver(id, body.driverId);
    await this.adminService.logActivity(req.user!.sub, 'ASSIGN_TRUCK_DRIVER', 'TRUCK', id, { driverId: body.driverId });
    return result;
  }

  @Post('trucks')
  async createTruck(@Req() req: Request, @Body() body: any) {
    assertAdmin(req);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new BadRequestException('Truck details are required.');
    }
    const truck = await this.adminService.createTruck(body);
    await this.adminService.logActivity(req.user!.sub, 'CREATE_TRUCK', 'TRUCK', truck.id, { plateNumber: truck.plate_number });
    return truck;
  }

  @Patch('trucks/:id')
  async updateTruck(@Req() req: Request, @Param('id') id: string, @Body() body: any) {
    assertAdmin(req);
    const truck = await this.adminService.updateTruck(id, body);
    await this.adminService.logActivity(req.user!.sub, 'UPDATE_TRUCK', 'TRUCK', id, {});
    return truck;
  }

  @Patch('trucks/:id/deactivate')
  async deactivateTruck(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);
    const result = await this.adminService.deactivateTruck(id);
    await this.adminService.logActivity(req.user!.sub, 'DEACTIVATE_TRUCK', 'TRUCK', id, {});
    return result;
  }

  @Delete('trucks/:id')
  async deleteTruck(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);
    const result = await this.adminService.deleteTruck(id);
    await this.adminService.logActivity(req.user!.sub, 'DELETE_TRUCK', 'TRUCK', id, {});
    return result;
  }

  // ─── TRUCK USERS ──────────────────────────────────────────────────────────
  @Get('users')
  async listUsers(@Req() req: Request) {
    assertAdmin(req);
    return this.adminService.listTruckUsers();
  }

  @Post('users')
  async createUser(@Req() req: Request, @Body() body: { name: string; email: string; password: string; owner_id: string }) {
    assertAdmin(req);
    if (!body || typeof body !== 'object') throw new BadRequestException('Driver details are required.');
    const user = await this.adminService.createTruckUser(body.name, body.email, body.password, body.owner_id);
    await this.adminService.logActivity(req.user!.sub, 'CREATE_TRUCK_USER', 'USER', user.id, { name: user.name });
    return user;
  }

  @Patch('users/:id/deactivate')
  async deactivateUser(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);
    const result = await this.adminService.deactivateUser(id);
    await this.adminService.logActivity(req.user!.sub, 'DEACTIVATE_USER', 'USER', id, {});
    return result;
  }

  @Delete('users/:id')
  async deleteUser(@Req() req: Request, @Param('id') id: string) {
    assertAdmin(req);
    const result = await this.adminService.deleteTruckUser(id);
    await this.adminService.logActivity(req.user!.sub, 'DELETE_DRIVER', 'USER', id, {});
    return result;
  }

  // ─── ACTIVITY LOG ─────────────────────────────────────────────────────────
  @Get('activity-log')
  async getActivityLog(@Req() req: Request) {
    assertAdmin(req);
    return this.adminService.getActivityLog(100);
  }

  // ─── LSTM SPOILAGE & INSURANCE LOGS ───────────────────────────────────────
  @Get('lstm-logs')
  async getLstmLogs(@Req() req: Request) {
    assertAdmin(req);
    return this.adminService.getLstmLogs(200);
  }
}
