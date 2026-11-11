import {
  Controller, Get, Post, Patch, Body, Param, Req, UseGuards,
  ForbiddenException, UnauthorizedException,
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
  constructor(private readonly adminService: AdminService) {}

  // ─── METRICS ──────────────────────────────────────────────────────────────
  @Get('metrics')
  async getMetrics(@Req() req: Request) {
    assertAdmin(req);
    return this.adminService.getMetrics();
  }

  // ─── OWNERS ───────────────────────────────────────────────────────────────
  @Get('owners')
  async listOwners(@Req() req: Request) {
    assertAdmin(req);
    return this.adminService.listOwners();
  }

  @Post('owners')
  async createOwner(@Req() req: Request, @Body() body: { name: string; email: string; password: string }) {
    assertAdmin(req);
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

  // ─── TRUCKS ───────────────────────────────────────────────────────────────
  @Get('trucks')
  async listTrucks(@Req() req: Request) {
    assertAdmin(req);
    return this.adminService.listTrucks();
  }

  @Post('trucks')
  async createTruck(@Req() req: Request, @Body() body: any) {
    assertAdmin(req);
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

  // ─── TRUCK USERS ──────────────────────────────────────────────────────────
  @Get('users')
  async listUsers(@Req() req: Request) {
    assertAdmin(req);
    return this.adminService.listTruckUsers();
  }

  @Post('users')
  async createUser(@Req() req: Request, @Body() body: { name: string; email: string; password: string; owner_id: string }) {
    assertAdmin(req);
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

  // ─── ACTIVITY LOG ─────────────────────────────────────────────────────────
  @Get('activity-log')
  async getActivityLog(@Req() req: Request) {
    assertAdmin(req);
    return this.adminService.getActivityLog(100);
  }
}
