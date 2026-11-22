import {
  Controller,
  Post,
  Get,
  Body,
  Res,
  Req,
  HttpCode,
  UnauthorizedException,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { randomBytes } from 'crypto';
import { AuthService } from './auth.service';
import { extractJwtToken } from '../middlewares/auth.middleware';

@Controller('api/auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: { email: string; password: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const { token, user } = await this.authService.login(body.email, body.password);

    // 1. Secure httpOnly Cookie
    res.cookie('coldchain_token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
      path: '/',
    });
    res.cookie('coldchain_csrf', randomBytes(32).toString('hex'), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });

    return { success: true, user };
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie('coldchain_token', { path: '/' });
    res.clearCookie('coldchain_csrf', { path: '/' });
    return { success: true, message: 'Logged out.' };
  }

  @Get('me')
  async getMe(@Req() req: Request) {
    const token = extractJwtToken(req);
    if (!token) throw new UnauthorizedException('Not authenticated. No token found in cookies or headers.');

    try {
      const payload = this.authService.verifyToken(token);
      const user = await this.authService.getMe(payload.sub);
      if (!user) throw new UnauthorizedException('User not found or inactive.');
      return { success: true, user };
    } catch {
      throw new UnauthorizedException('Invalid or expired session.');
    }
  }
}
