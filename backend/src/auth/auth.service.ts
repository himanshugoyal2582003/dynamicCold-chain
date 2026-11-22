import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { NeonService } from '../neon/neon.service';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

export interface JwtPayload {
  sub: string;
  email: string;
  role: 'admin' | 'owner' | 'truckUser';
  name: string;
  truckId?: string | null;
  ownerId?: string | null;
}

@Injectable()
export class AuthService {
  constructor(private readonly neonService: NeonService) {}

  private getJwtSecret(): string {
    const secret = process.env.JWT_SECRET;
    if (!secret || secret.length < 32 || secret.includes('your_jwt_secret')) {
      throw new Error('JWT_SECRET must be configured with at least 32 random characters.');
    }
    return secret;
  }

  async login(email: string, password: string) {
    if (!email || !password) {
      throw new BadRequestException('Email and password are required.');
    }

    const sql = this.neonService.getSql();
    if (!sql) throw new Error('Database not available');

    const rows = await sql(
      `SELECT id, name, email, password_hash, role, truck_id, owner_id, active
       FROM users WHERE email = $1 LIMIT 1`,
      [email.toLowerCase().trim()],
    );

    if (!rows || rows.length === 0) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const user = rows[0];

    if (!user.active) {
      throw new UnauthorizedException('Your account has been deactivated.');
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
      truckId: user.truck_id || null,
      ownerId: user.owner_id || null,
    };

    const token = jwt.sign(payload, this.getJwtSecret(), { expiresIn: '8h' });

    return { token, user: payload };
  }

  async getMe(userId: string): Promise<JwtPayload | null> {
    const sql = this.neonService.getSql();
    if (!sql) return null;

    const rows = await sql(
      `SELECT id, name, email, role, truck_id, owner_id FROM users WHERE id = $1 AND active = true LIMIT 1`,
      [userId],
    );

    if (!rows || rows.length === 0) return null;
    const u = rows[0];

    return {
      sub: u.id,
      email: u.email,
      role: u.role,
      name: u.name,
      truckId: u.truck_id || null,
      ownerId: u.owner_id || null,
    };
  }

  verifyToken(token: string): JwtPayload {
    return jwt.verify(token, this.getJwtSecret()) as JwtPayload;
  }
}
