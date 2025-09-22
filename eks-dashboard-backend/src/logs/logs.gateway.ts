import {
  SubscribeMessage,
  WebSocketGateway,
  OnGatewayInit,
  OnGatewayConnection,
  OnGatewayDisconnect,
  WebSocketServer,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { Server, Socket } from 'socket.io';
import { KubernetesService } from '../kubernetes/kubernetes.service';
import { PassThrough } from 'node:stream';
import { Request } from 'request';

interface GetLogsPayload {
  deploymentName: string;
  environmentId: string;
}

@WebSocketGateway({
  cors: {
    origin: '*', // 在生产环境中，请将其限制为您的前端 URL
  },
})
export class LogsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(LogsGateway.name);
  private logRequests = new Map<string, Request>();

  constructor(private readonly k8sService: KubernetesService) {}

  afterInit() {
    // Gateway initialized. Keep log concise; avoid inspecting internal server
    // structures (previous code attempted to read internals for debugging
    // but introduced unsafe casts). If you need deeper introspection, add
    // targeted debug logs behind a debug flag.
    this.logger.log('WebSocket Gateway Initialized');
  }

  handleConnection(client: Socket) {
    const handshakeQuery =
      client.handshake && client.handshake.query
        ? JSON.stringify(client.handshake.query)
        : '{}';
    this.logger.log(
      `Client connected: ${client.id} (handshake query: ${handshakeQuery})`,
    );
  }

  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
    const request = this.logRequests.get(client.id);
    if (request) {
      request.abort();
      this.logRequests.delete(client.id);
      this.logger.log(`Aborted log stream for client: ${client.id}`);
    }
  }

  @SubscribeMessage('get-logs')
  async handleGetLogs(client: Socket, payload: GetLogsPayload): Promise<void> {
    const { deploymentName, environmentId } = payload;
    if (!deploymentName || !environmentId) {
      this.logger.error('Invalid payload for get-logs:', payload);
      client.emit(
        'log-error',
        'Invalid payload: deploymentName and environmentId are required.',
      );
      return;
    }

    this.logger.log(
      `Received get-logs for ${deploymentName} in env ${environmentId} from ${client.id}`,
    );

    // 如果此客户端已有日志请求，先中止旧的
    const oldRequest = this.logRequests.get(client.id);
    if (oldRequest) {
      oldRequest.abort();
    }

    try {
      const pods = await this.k8sService.getPodsForDeployment(
        environmentId,
        deploymentName,
        'default',
      );
      if (pods.length === 0) {
        client.emit(
          'log-error',
          `No pods found for deployment ${deploymentName}`,
        );
        return;
      }

      // 按创建时间排序以获取最新的 Pod
      pods.sort((a, b) => {
        const timeA = a.metadata?.creationTimestamp
          ? new Date(a.metadata.creationTimestamp).getTime()
          : 0;
        const timeB = b.metadata?.creationTimestamp
          ? new Date(b.metadata.creationTimestamp).getTime()
          : 0;
        return timeB - timeA;
      });

      const pod = pods[0];
      const podName = pod.metadata?.name;
      const containerName = pod.spec?.containers?.[0]?.name;

      if (!podName || !containerName) {
        this.logger.error(
          `Could not determine pod name or container name for deployment ${deploymentName}`,
        );
        client.emit('log-error', `Invalid pod data for ${deploymentName}.`);
        return;
      }

      const logStream = new PassThrough();

      // Normalize chunk (Buffer or string) safely before emitting
      logStream.on('data', (chunk) => {
        try {
          const text = Buffer.isBuffer(chunk)
            ? chunk.toString('utf8')
            : String(chunk);
          client.emit('log-chunk', text);
        } catch (e) {
          this.logger.warn('Failed to process log chunk', String(e));
        }
      });

      const req = await this.k8sService.streamPodLogs(
        environmentId,
        podName,
        containerName,
        'default',
        logStream,
        (err) => {
          if (err) {
            this.logger.error(`Log stream error for ${podName}: ${err}`);
            client.emit('log-error', `Error streaming logs for ${podName}.`);
          }
          client.emit('log-end', `Log stream for ${podName} ended.`);
          this.logRequests.delete(client.id);
        },
        { follow: true, tailLines: 100, pretty: false, timestamps: false },
      );

      this.logRequests.set(client.id, req);
    } catch (error) {
      this.logger.error(
        `Error getting logs for ${deploymentName}: ${String(error)}`,
      );
      // Safely log error.body if present on an object
      if (error && typeof error === 'object' && 'body' in error) {
        try {
          this.logger.error('Error details: ' + JSON.stringify(error));
        } catch {
          // ignore stringify errors
        }
      }
      client.emit('log-error', `Failed to get logs for ${deploymentName}.`);
    }
  }
}
