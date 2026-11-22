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
      `SELECT u.id, u.name, u.email, u.password_hash, u.role, u.owner_id, u.active,
              assigned_truck.id AS valid_truck_id
       FROM users u
       LEFT JOIN trucks assigned_truck
         ON assigned_truck.id = u.truck_id
        AND assigned_truck.owner_id = u.owner_id
        AND assigned_truck.active = true
       WHERE u.email = $1 LIMIT 1`,
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
      truckId: user.valid_truck_id || null,
      ownerId: user.owner_id || null,
    };

    const token = jwt.sign(payload, this.getJwtSecret(), { expiresIn: '8h' });

    return { token, user: payload };
  }

  async getMe(userId: string): Promise<JwtPayload | null> {
    const sql = this.neonService.getSql();
    if (!sql) return null;

    const rows = await sql(
      `SELECT u.id, u.name, u.email, u.role, u.owner_id,
              assigned_truck.id AS valid_truck_id
       FROM users u
       LEFT JOIN trucks assigned_truck
         ON assigned_truck.id = u.truck_id
        AND assigned_truck.owner_id = u.owner_id
        AND assigned_truck.active = true
       WHERE u.id = $1 AND u.active = true LIMIT 1`,
      [userId],
    );

    if (!rows || rows.length === 0) return null;
    const u = rows[0];

    return {
      sub: u.id,
      email: u.email,
      role: u.role,
      name: u.name,
      truckId: u.valid_truck_id || null,
      ownerId: u.owner_id || null,
    };
  }

  verifyToken(token: string): JwtPayload {
    return jwt.verify(token, this.getJwtSecret()) as JwtPayload;
  }
}
