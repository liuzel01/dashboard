import {
  OnGatewayConnection,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { BytebaseService } from './bytebase.service';

type AuthenticatedSocket = Socket & {
  data: { userId?: number; username?: string };
};

@WebSocketGateway({ namespace: '/bytebase', cors: { origin: true } })
export class BytebaseEventsGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Server;

  constructor(private readonly bytebase: BytebaseService) {}

  async handleConnection(client: AuthenticatedSocket) {
    const token = String(client.handshake.auth?.token || '').trim();
    try {
      const actor = await this.bytebase.actor(
        token ? `Bearer ${token}` : undefined,
        'menu:bytebase',
      );
      client.data.userId = actor.userId;
      client.data.username = actor.username;
      await client.join(`bytebase:user:${actor.userId}`);
      if (actor.permissions.includes('bytebase:rollout:execute'))
        await client.join('bytebase:admins');
      client.emit('bytebase-ready', { connected: true });
    } catch {
      client.emit('bytebase-error', 'Bytebase 实时连接鉴权失败');
      client.disconnect(true);
    }
  }

  emitRequestUpdated(row: Record<string, unknown>) {
    const event = {
      request_id: row.request_id,
      environment_id: row.environment_id,
      title: row.title,
      status: row.status,
      actor_username: row.actor_username,
      updated_at: row.updated_at,
    };
    this.server
      .to(`bytebase:user:${Number(row.actor_user_id)}`)
      .to('bytebase:admins')
      .emit('bytebase-request-updated', event);
  }
}
