import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../auth/auth.service';

// Extend Express Request to carry user payload
declare global {
  namespace Express {
    interface Request {
      user?: {
        sub: string;
        email: string;
        role: 'admin' | 'owner' | 'truckUser';
        name: string;
        truckId?: string | null;
        ownerId?: string | null;
      };
    }
  }
}

export function extractJwtToken(req: Request): string | null {
  // 1. Check Authorization header (Bearer <token>)
  const authHeader = req.headers.authorization || (req.headers as any)?.Authorization;
  if (authHeader && typeof authHeader === 'string') {
    if (authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7).trim();
    }
    return authHeader.trim();
  }

  // 2. Check custom x-auth-token / x-access-token header
  const customHeader = req.headers['x-auth-token'] || req.headers['x-access-token'];
  if (customHeader && typeof customHeader === 'string') {
    return customHeader.trim();
  }

  // 3. Check httpOnly cookie
  if (req.cookies?.coldchain_token) {
    return req.cookies.coldchain_token;
  }

  return null;
}

@Injectable()
export class AuthGuardMiddleware implements NestMiddleware {
  constructor(private readonly authService: AuthService) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const token = extractJwtToken(req);
    if (!token) throw new UnauthorizedException('Authentication required. Missing token in cookie or Authorization header.');

    try {
      req.user = this.authService.verifyToken(token);
      next();
    } catch {
      throw new UnauthorizedException('Invalid or expired session.');
    }
  }
}

export function requireRoles(...roles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) throw new UnauthorizedException('Not authenticated.');
    if (!roles.includes(req.user.role)) {
      throw new ForbiddenException('You do not have permission to access this resource.');
    }
    next();
  };
}
