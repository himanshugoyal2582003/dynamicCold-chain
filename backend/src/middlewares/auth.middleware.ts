import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../auth/auth.service';
import { NeonService } from '../neon/neon.service';

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
  // Authentication is intentionally cookie-only. Do not reintroduce bearer-token
  // fallbacks here: browser-readable tokens defeat the httpOnly session boundary.
  if (req.cookies?.coldchain_token) {
    return req.cookies.coldchain_token;
  }

  return null;
}

@Injectable()
export class AuthGuardMiddleware implements NestMiddleware {
  constructor(
    private readonly authService: AuthService,
    private readonly neonService: NeonService,
  ) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const token = extractJwtToken(req);
    if (!token) throw new UnauthorizedException('Authentication required. Missing coldchain_token cookie.');

    let payload: any;
    try {
      payload = this.authService.verifyToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired session.');
    }
    req.user = payload;

    // For truckUser: always refresh truckId from DB so that
    // truck assignments made after login take effect immediately
    // without requiring the driver to re-login, and fail closed if inactive/unavailable.
    if (payload.role === 'truckUser') {
      const sql = this.neonService.getSql();
      if (!sql) {
        throw new ServiceUnavailableException('Unable to verify driver session.');
      }
      let rows: any[];
      try {
        rows = await sql(
          `SELECT truck_id, owner_id FROM users WHERE id = $1 AND active = true LIMIT 1`,
          [payload.sub],
        );
      } catch {
        throw new ServiceUnavailableException('Unable to verify driver session.');
      }
      if (!rows || rows.length === 0) {
        throw new UnauthorizedException('Account is inactive or unavailable.');
      }
      req.user.truckId = rows[0].truck_id || null;
      req.user.ownerId = rows[0].owner_id || null;
    }

    next();
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
