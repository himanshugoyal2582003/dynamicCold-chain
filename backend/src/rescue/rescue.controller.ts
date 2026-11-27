import {
    Body, Controller, Get, Param, ParseUUIDPipe, Post, Req, UnauthorizedException
} from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { Request } from 'express';
import { RescueService } from './rescue.service';

export const RESCUE_ACTIONS = ['APPROVED', 'REJECTED', 'STARTED', 'COMPLETED', 'CANCELLED'] as const;
export type RescueAction = typeof RESCUE_ACTIONS[number];

export class RescueDecisionInput {
    @IsIn(RESCUE_ACTIONS)
    action: RescueAction;

    @IsOptional()
    @IsUUID()
    candidateId?: string;

    @IsString()
    @MaxLength(1000)
    reason: string;

    @IsOptional()
    @IsString()
    @MaxLength(1000)
    facilityConfirmation?: string;

    @IsOptional()
    @IsBoolean()
    facilityVerified?: boolean;
}

@Controller('api/trips/:tripId/rescue')
export class RescueController {
    constructor(private readonly rescue: RescueService) {}

    private actor(req: Request) {
        if (!req.user) throw new UnauthorizedException();
        return req.user;
    }

    @Get()
    history(@Req() req: Request, @Param('tripId', ParseUUIDPipe) tripId: string) {
        return this.rescue.getHistory(this.actor(req), tripId);
    }

    @Post()
    generate(@Req() req: Request, @Param('tripId', ParseUUIDPipe) tripId: string) {
        return this.rescue.generateRecommendations(this.actor(req), tripId);
    }

    @Post(':eventId/decisions')
    decide(
        @Req() req: Request,
        @Param('tripId', ParseUUIDPipe) tripId: string,
        @Param('eventId', ParseUUIDPipe) eventId: string,
        @Body() input: RescueDecisionInput
    ) {
        return this.rescue.decide(this.actor(req), tripId, eventId, input);
    }
}
