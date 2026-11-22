import {
  Injectable,
  NestMiddleware,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AuthService, JwtPayload } from '../auth/auth.service';

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
  constructor(private readonly authService: AuthService) {}

  async use(req: Request, _res: Response, next: NextFunction) {
    const token = extractJwtToken(req);
    if (!token) throw new UnauthorizedException('Authentication required. Missing token in cookie or Authorization header.');

    let verifiedUser: JwtPayload;
    try {
      verifiedUser = this.authService.verifyToken(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    // The signed token proves identity, but mutable assignment and role data
    // must come from PostgreSQL so existing sessions see reassignment changes.
    const currentUser = await this.authService.getMe(verifiedUser.sub);
    if (!currentUser) throw new UnauthorizedException('User not found or inactive.');
    req.user = currentUser;
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
