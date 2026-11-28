import {
  BadRequestException, Body, Controller, DefaultValuePipe, Get, Header, HttpCode, Param,
  ParseIntPipe, ParseUUIDPipe, Post, Query, Req,
} from '@nestjs/common';
import { Request } from 'express';
import { DigitalTwinService } from './digital-twin.service';
import { parseSimulationInput } from './simulation-input';

@Controller('api/digital-twin')
export class DigitalTwinController {
  constructor(private readonly twin: DigitalTwinService) {}

  @Get('trucks')
  @Header('Cache-Control', 'no-store')
  list(@Req() req: Request, @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {
    if (page < 1 || page > 10000) throw new BadRequestException('Page must be between 1 and 10000');
    return this.twin.list(req.user, page);
  }

  @Post('trucks/:id/simulate')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  run(@Req() req: Request, @Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.twin.simulate(req.user, id, parseSimulationInput(body));
  }
}
