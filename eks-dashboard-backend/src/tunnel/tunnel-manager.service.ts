import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Client, ConnectConfig } from 'ssh2';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { EnvironmentsService } from '../environments/environments.service';
import type { Environment } from '../environments/environment.types';

export interface ForwardSpec {
  name: string; // e.g. 'mysql' | 'redis'
  dstHost: string;
  dstPort: number;
  localPort?: number; // optional requested local port
}

export interface TunnelHandle {
  client: Client;
  localHost: string;
  localPorts: Record<string, number>; // map name -> port
  close: () => Promise<void>;
}

@Injectable()
export class TunnelManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(TunnelManagerService.name);
  private tunnels = new Map<string, Promise<TunnelHandle>>();
  private nextPort = 33000;

  constructor(private readonly environmentsService: EnvironmentsService) {}

  onModuleDestroy() {
    this.logger.log('Shutting down TunnelManager...');
    for (const p of this.tunnels.values()) {
      p.then((t) => t.close()).catch(() => {});
    }
    this.tunnels.clear();
    this.logger.log('TunnelManager shut down.');
  }

  private getNextPort() {
    return this.nextPort++;
  }

  private async waitForPortOpen(host: string, port: number, timeoutMs = 3000) {
    return new Promise<void>((resolve, reject) => {
      const socket = new net.Socket();
      let done = false;
      const timer = setTimeout(() => {
        if (done) return;
        done = true;
        socket.destroy();
        reject(new Error('timeout'));
      }, timeoutMs);

      socket.once('error', (err) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.destroy();
        reject(err);
      });

      socket.connect(port, host, () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        socket.end();
        resolve();
      });
    });
  }

  // Build ssh connect config from environment.jumpServer
  private buildConnectConfig(env: Environment): ConnectConfig {
    if (!env.jumpServer) throw new Error('No jump server');
    const pkPath = path.resolve(process.cwd(), env.jumpServer.privateKeyPath);
    const privateKey = fs.readFileSync(pkPath);
    return {
      host: env.jumpServer.host,
      port: env.jumpServer.port || 22,
      username: env.jumpServer.username,
      privateKey,
      keepaliveInterval: 20000,
      keepaliveCountMax: 3,
    } as ConnectConfig;
  }

  // Create a persistent SSH client and one local server per forward spec.
  public async getTunnel(
    environmentId: string,
    forwards: ForwardSpec[],
  ): Promise<TunnelHandle> {
    if (this.tunnels.has(environmentId))
      return this.tunnels.get(environmentId)!;

    const buildPromise = (async () => {
      const env = this.environmentsService.getEnvironmentById(environmentId);
      if (!env) throw new Error(`Environment ${environmentId} not found`);
      if (!env.jumpServer)
        throw new Error(`No jump server for ${environmentId}`);

      const connectConfig = this.buildConnectConfig(env);
      const client = new Client();

      await new Promise<void>((resolve, reject) => {
        const onErr = (e: Error) => {
          cleanupListeners();
          reject(e);
        };
        const onReady = () => {
          cleanupListeners();
          resolve();
        };
        const cleanupListeners = () => {
          client.removeListener('ready', onReady);
          client.removeListener('error', onErr);
        };
        client.once('ready', onReady);
        client.once('error', onErr);
        client.connect(connectConfig);
      });

      // For each forward, create a local net.Server listening on 127.0.0.1:port
      const servers: Array<{
        name: string;
        server: net.Server;
        port: number;
      }> = [];

      for (const f of forwards) {
        const port = f.localPort ?? this.getNextPort();
        const server = net.createServer((socket) => {
          // when a connection comes in, open an SSH forwardOut channel
          client.forwardOut(
            '127.0.0.1',
            0,
            f.dstHost,
            f.dstPort,
            (err, stream) => {
              if (err) {
                socket.destroy();
                this.logger.warn('forwardOut error', err.message);
                return;
              }
              socket.pipe(stream).pipe(socket);
            },
          );
        });

        // Always bind to 127.0.0.1 for predictability
        await new Promise<void>((resolve, reject) => {
          server.once('error', (e) => reject(e));
          server.listen(port, '127.0.0.1', () => resolve());
        });

        // verify the local port is open
        await this.waitForPortOpen('127.0.0.1', port, 3000);
        servers.push({ name: f.name, server, port });
        this.logger.log(
          `Forward ${f.name} established at 127.0.0.1:${port} -> ${f.dstHost}:${f.dstPort}`,
        );
      }

      const handle: TunnelHandle = {
        client,
        localHost: '127.0.0.1',
        localPorts: servers.reduce(
          (acc, s) => ({ ...acc, [s.name]: s.port }),
          {} as Record<string, number>,
        ),
        close: async () => {
          for (const s of servers) {
            try {
              await new Promise<void>((res) => s.server.close(() => res()));
            } catch {}
          }
          try {
            client.end();
          } catch {}
        },
      };

      // attach auto-reconnect/close handling
      client.on('close', () => {
        this.logger.warn(`SSH client for env ${environmentId} closed`);
        // drop cache so next request can recreate
        this.tunnels.delete(environmentId);
      });
      client.on('error', (e) => {
        this.logger.warn(
          `SSH client error for env ${environmentId}: ${e.message}`,
        );
      });

      return handle;
    })();

    this.tunnels.set(environmentId, buildPromise);
    return buildPromise;
  }

  public async invalidate(environmentId: string) {
    const p = this.tunnels.get(environmentId);
    if (!p) return;
    this.tunnels.delete(environmentId);
    try {
      const h = await p;
      await h.close();
    } catch (e) {
      // ignore
    }
  }
}
