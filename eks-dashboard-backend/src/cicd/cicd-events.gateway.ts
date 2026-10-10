import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { CicdRunsService } from './cicd-runs.service';

type AuthenticatedSocket = Socket & {
  data: { authorization?: string; userId?: number; username?: string };
};

@WebSocketGateway({ namespace: '/cicd', cors: { origin: true } })
export class CicdEventsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Server;
  private readonly logger = new Logger(CicdEventsGateway.name);
  private readonly tails = new Map<string, NodeJS.Timeout>();
  private readonly subscriptions = new Map<string, Set<string>>();

  constructor(private readonly runs: CicdRunsService) {}

  async handleConnection(client: AuthenticatedSocket) {
    const token = String(client.handshake.auth?.token || '').trim();
    try {
      const actor = await this.runs.actor(token ? `Bearer ${token}` : undefined);
      client.data.authorization = `Bearer ${token}`;
      client.data.userId = actor.userId;
      client.data.username = actor.username;
      client.emit('cicd-ready', { connected: true });
    } catch {
      client.emit('cicd-error', 'CI/CD 实时连接鉴权失败');
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.stopAll(client.id);
  }

  emitRunUpdated(run: Record<string, unknown>) {
    this.server.emit('cicd-run-updated', run);
  }

  @SubscribeMessage('cicd-log-subscribe')
  async subscribeLog(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { runId?: string; start?: number },
  ) {
    const runId = String(payload?.runId || '').trim();
    if (!/^[0-9a-f-]{36}$/i.test(runId) || !client.data.authorization) {
      client.emit('cicd-log-error', { runId, message: '日志订阅参数无效' });
      return;
    }
    this.stopTail(client.id, runId);
    const key = `${client.id}:${runId}`;
    const clientRuns = this.subscriptions.get(client.id) || new Set<string>();
    if (clientRuns.size >= 3) {
      client.emit('cicd-log-error', { runId, message: '同时最多追踪 3 个任务日志' });
      return;
    }
    clientRuns.add(runId);
    this.subscriptions.set(client.id, clientRuns);
    let offset = Math.max(0, Math.min(10_000_000, Number(payload.start) || 0));

    const poll = async () => {
      if (!this.subscriptions.get(client.id)?.has(runId)) return;
      try {
        const result = await this.runs.log(client.data.authorization, runId, offset);
        if (result.text) client.emit('cicd-log-chunk', { runId, text: result.text, start: offset, nextStart: result.nextStart });
        offset = Math.max(offset, Number(result.nextStart) || offset);
        if (!result.hasMore) {
          client.emit('cicd-log-end', { runId, nextStart: offset });
          this.stopTail(client.id, runId);
          return;
        }
        if (this.subscriptions.get(client.id)?.has(runId)) {
          this.tails.set(key, setTimeout(poll, 1_500));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Jenkins 日志追踪失败';
        this.logger.warn(`CI/CD log tail failed run=${runId}: ${message}`);
        client.emit('cicd-log-error', { runId, message });
        this.stopTail(client.id, runId);
      }
    };
    await poll();
  }

  @SubscribeMessage('cicd-log-unsubscribe')
  unsubscribeLog(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() payload: { runId?: string },
  ) {
    this.stopTail(client.id, String(payload?.runId || ''));
  }

  private stopTail(clientId: string, runId: string) {
    const key = `${clientId}:${runId}`;
    const timer = this.tails.get(key);
    if (timer) clearTimeout(timer);
    this.tails.delete(key);
    const runs = this.subscriptions.get(clientId);
    runs?.delete(runId);
    if (runs && runs.size === 0) this.subscriptions.delete(clientId);
  }

  private stopAll(clientId: string) {
    for (const runId of this.subscriptions.get(clientId) || []) this.stopTail(clientId, runId);
    this.subscriptions.delete(clientId);
  }
}
