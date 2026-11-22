import { ForbiddenException, Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();

    const csrfCookie = req.cookies?.coldchain_csrf;
    const csrfHeader = req.headers['x-csrf-token'];
    if (!csrfCookie || typeof csrfHeader !== 'string' || csrfHeader !== csrfCookie) {
      throw new ForbiddenException('Invalid CSRF token.');
    }
    next();
  }
}
