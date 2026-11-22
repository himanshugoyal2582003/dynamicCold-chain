import {
  WebSocketGateway,
  WebSocketServer,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { AuthService, JwtPayload } from '../auth/auth.service';

function allowedOrigins(): string[] {
  return (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function validateOrigin(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) {
  if (!origin || allowedOrigins().includes(origin)) return callback(null, true);
  return callback(new Error('Origin not allowed by CORS'));
}

@WebSocketGateway({
  namespace: '/tracking',
  cors: {
    origin: validateOrigin,
    credentials: true,
  },
})
export class TrackingGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(TrackingGateway.name);

  constructor(private readonly authService: AuthService) {}

  afterInit(_server: Server) {
    this.logger.log('TrackingGateway initialized');
  }

  /**
   * Extract the httpOnly session cookie from the Socket.IO handshake.
   */
  private extractToken(client: Socket): string | null {
    const cookieHeader = client.handshake.headers.cookie || '';
    const match = cookieHeader.match(/(?:^|;\s*)coldchain_token=([^;]+)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  async handleConnection(client: Socket) {
    const origin = client.handshake.headers.origin;
    if (origin && !allowedOrigins().includes(origin)) {
      client.disconnect(true);
      return;
    }
    const token = this.extractToken(client);

    if (!token) {
      this.logger.warn(`Client ${client.id} rejected: no token`);
      client.emit('error', { message: 'Authentication required' });
      client.disconnect(true);
      return;
    }

    let user: JwtPayload;
    try {
      user = this.authService.verifyToken(token);
    } catch {
      this.logger.warn(`Client ${client.id} rejected: invalid token`);
      client.emit('error', { message: 'Invalid or expired token' });
      client.disconnect(true);
      return;
    }

    // Attach user payload to socket data for later reference
    (client as any).data = { ...((client as any).data || {}), user };

    // Join role-based rooms
    if (user.role === 'admin') {
      await client.join('admin:fleet');
      this.logger.log(`Admin ${user.sub} (${client.id}) joined admin:fleet`);
    } else if (user.role === 'owner') {
      const ownerId = user.sub; // owner's own id is the owner id
      await client.join(`owner:${ownerId}`);
      this.logger.log(`Owner ${ownerId} (${client.id}) joined owner:${ownerId}`);
    } else if (user.role === 'truckUser') {
      if (user.truckId) {
        await client.join(`truck:${user.truckId}`);
        this.logger.log(
          `Driver ${user.sub} (${client.id}) joined truck:${user.truckId}`,
        );
      } else {
        this.logger.warn(
          `Driver ${user.sub} has no truckId — disconnecting ${client.id}`,
        );
        client.emit('error', { message: 'No truck assigned to this account' });
        client.disconnect(true);
        return;
      }
    } else {
      this.logger.warn(`Unknown role for ${client.id}: ${user.role}`);
      client.emit('error', { message: 'Unknown role' });
      client.disconnect(true);
      return;
    }

    client.emit('connected', {
      message: 'Connected to tracking namespace',
      role: user.role,
    });
  }

  handleDisconnect(client: Socket) {
    const user: JwtPayload | undefined = (client as any).data?.user;
    if (user) {
      this.logger.log(`Client ${client.id} (user ${user.sub}) disconnected`);
    } else {
      this.logger.log(`Client ${client.id} disconnected (unauthenticated)`);
    }
    // Socket.IO automatically removes clients from rooms on disconnect
  }

  /**
   * Broadcast a location update to all relevant rooms:
   *   - admin:fleet          (all admins)
   *   - owner:{ownerId}      (the fleet owner)
   *   - truck:{truckId}      (the truck driver / IoT display)
   */
  broadcastLocationUpdate(
    truckId: string,
    ownerId: string,
    payload: LocationUpdatePayload,
  ): void {
    if (!this.server) return;
    const event = 'location:update';
    this.server.to('admin:fleet').emit(event, payload);
    this.server.to(`owner:${ownerId}`).emit(event, payload);
    this.server.to(`truck:${truckId}`).emit(event, payload);
  }

  /**
   * Broadcast an alert to relevant rooms.
   */
  broadcastAlert(
    type: string,
    truckId: string,
    ownerId: string,
    payload: AlertPayload,
  ): void {
    if (!this.server) return;
    const event = `alert:${type}`;
    this.server.to('admin:fleet').emit(event, payload);
    this.server.to(`owner:${ownerId}`).emit(event, payload);
    this.server.to(`truck:${truckId}`).emit(event, payload);
  }
}

// ─── Shared payload types ────────────────────────────────────────────────────

export interface LocationUpdatePayload {
  truckId: string;
  ownerId: string;
  plateNumber?: string;
  latitude: number;
  longitude: number;
  speed_kmh?: number;
  heading?: number;
  accuracy_m?: number;
  recorded_at: string;
  received_at?: string;
  status?: string;
}

export interface AlertPayload {
  truckId: string;
  ownerId: string;
  type: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: string;
  [key: string]: unknown;
}
