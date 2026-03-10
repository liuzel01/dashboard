import {
  Injectable,
  Logger,
  OnModuleDestroy,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { createTunnel, TunnelOptions, ForwardOptions } from 'tunnel-ssh';
import { TunnelManagerService } from './tunnel-manager.service';
import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { spawn } from 'child_process';
import { EnvironmentsService } from '../environments/environments.service';
import type { Environment } from '../environments/environment.types';

interface ActiveTunnel {
  server: net.Server;
  localDbPort: number;
  localRedisPort: number;
  close: () => Promise<void>;
}

@Injectable()
export class TunnelService implements OnModuleDestroy {
  private readonly logger = new Logger(TunnelService.name);
  private tunnels = new Map<string, Promise<ActiveTunnel>>();
  private nextPort = 33000; // Starting port for local forwarding

  constructor(
    private readonly environmentsService: EnvironmentsService,
    private readonly tunnelManager: TunnelManagerService,
  ) {}

  async onModuleDestroy() {
    this.logger.log('Closing all SSH tunnels...');
    const closingPromises: Promise<void>[] = [];
    for (const tunnelPromise of this.tunnels.values()) {
      closingPromises.push(tunnelPromise.then((tunnel) => tunnel.close()));
    }
    await Promise.all(closingPromises);
    this.tunnels.clear();
    this.logger.log('All SSH tunnels closed.');
  }

  private getNextPorts(): { dbPort: number; redisPort: number } {
    const dbPort = this.nextPort++;
    const redisPort = this.nextPort++;
    return { dbPort, redisPort };
  }

  private async createTunnel(environment: Environment): Promise<ActiveTunnel> {
    const jumpServerConfig = environment.jumpServer;
    if (!jumpServerConfig) {
      throw new Error('Jump server config is missing for tunneling.');
    }

    const { dbPort: localDbPort, redisPort: localRedisPort } =
      this.getNextPorts();

    const tunnelOptions: TunnelOptions = {
      autoClose: true,
      reconnectOnError: true,
    };

    const privateKeyPath = path.resolve(
      process.cwd(),
      jumpServerConfig.privateKeyPath,
    );
    this.logger.debug(`Attempting to read private key from: ${privateKeyPath}`);
    let privateKey: Buffer;
    try {
      privateKey = fs.readFileSync(privateKeyPath);
      this.logger.debug(
        `Private key read successfully. Length: ${privateKey.length} bytes.`,
      );
    } catch (readError) {
      this.logger.error(
        `Failed to read private key from ${privateKeyPath}`,
        readError.stack,
      );
      throw new InternalServerErrorException(
        `Could not read private key file at ${privateKeyPath}. Please ensure the file exists and has correct permissions.`,
      );
    }

    // This object contains the connection details for the remote SSH server.
    const sshOptions = {
      host: jumpServerConfig.host,
      port: jumpServerConfig.port,
      username: jumpServerConfig.username,
      privateKey,
    };

    // This object is for the local net.Server created by tunnel-ssh.
    // We can pass an empty object as the library seems to derive what it needs
    // from the forwardOptions.
    const localServerOptions = {};

    const forwardOptions: ForwardOptions[] = [];
    if (environment.database) {
      forwardOptions.push({
        srcAddr: '127.0.0.1',
        srcPort: localDbPort,
        dstAddr: environment.database.host,
        dstPort: environment.database.port,
      });
    }
    if (environment.redis) {
      forwardOptions.push({
        srcAddr: '127.0.0.1',
        srcPort: localRedisPort,
        dstAddr: environment.redis.host,
        dstPort: environment.redis.port,
      });
    }

    this.logger.log(
      `Creating SSH tunnel for env "${environment.id}" to ${jumpServerConfig.host}:${jumpServerConfig.port} as user "${jumpServerConfig.username}"...`,
    );

    // For deep debugging, log the options being passed to the library.
    this.logger.debug('Passing the following options to createTunnel:', {
      tunnelOptions,
      localServerOptions,
      sshOptions: {
        ...sshOptions,
        privateKey: `[Buffer of ${privateKey.length} bytes]`,
      }, // Avoid logging the actual key content.
      forwardOptions,
    });

    const extractErrorMessage = (e: unknown): string => {
      if (e === null || e === undefined) return 'Unknown error';
      if (typeof e === 'string') return e;
      if (e instanceof Error) return e.message;
      try {
        return JSON.stringify(e);
      } catch {
        return String(e);
      }
    };

    const waitForPortOpen = async (
      host: string,
      port: number,
      timeoutMs = 3000,
      maxAttempts = 5,
    ) => {
      const attemptConnect = (attemptTimeout: number) =>
        new Promise<void>((resolve, reject) => {
          const socket = new net.Socket();
          let settled = false;
          const timer = setTimeout(() => {
            settled = true;
            socket.destroy();
            reject(
              new Error(
                'Timeout waiting for forwarded port to accept connections',
              ),
            );
          }, attemptTimeout);

          socket.once('error', (err: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            reject(err);
          });

          socket.connect(port, host, () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.end();
            resolve();
          });
        });

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await attemptConnect(timeoutMs);
          return;
        } catch (err) {
          const backoffMs = 100 * Math.pow(2, attempt - 1);
          this.logger.debug(
            `Port ${host}:${port} connect attempt ${attempt} failed: ${err instanceof Error ? err.message : String(err)}; retrying in ${backoffMs}ms...`,
          );
          if (attempt === maxAttempts) throw err;
          await new Promise((r) => setTimeout(r, backoffMs));
        }
      }
    };

    try {
      // The `tunnel-ssh` library expects rest parameters for forwarding, but its
      // type definitions are incorrect. The actual signature appears to be:
      // createTunnel(tunnelOptions, serverOptions, sshOptions, ...forwardOptions)
      // On error, the promise rejects. On success, it resolves with [server, ssh2.Client].
      // Create one tunnel/server per forward option. Some versions of
      // tunnel-ssh may bind to ephemeral ports when multiple forwards are
      // requested in a single call; creating one per forward gives us the
      // actual bound port for each forwarded service and avoids mismatches.
      const servers: net.Server[] = [];
      const actualPorts: number[] = [];

      const waitForListening = (s: net.Server, timeoutMs = 5000) =>
        new Promise<void>((resolve, reject) => {
          try {
            if ((s as any).listening) return resolve();
          } catch {
            // ignore
          }

          const timer = setTimeout(() => {
            reject(
              new Error(
                'Timeout waiting for local tunnel server to start listening',
              ),
            );
          }, timeoutMs);

          const onListening = () => {
            clearTimeout(timer);
            resolve();
          };
          const onError = (err: Error) => {
            clearTimeout(timer);
            reject(err);
          };

          s.once('listening', onListening);
          s.once('error', onError);
        });

      for (const fwd of forwardOptions) {
        let server: net.Server | null = null;
        try {
          const createTunnelFn = createTunnel as unknown as (
            ...args: unknown[]
          ) => Promise<[net.Server, unknown]>;
          const [s] = await createTunnelFn(
            tunnelOptions,
            localServerOptions,
            sshOptions,
            fwd,
          );
          server = s;
          servers.push(server);

          await waitForListening(server, 5000);

          // get bound port if any
          let boundPort: number | undefined;
          try {
            const addr = server.address();
            this.logger.debug(
              `Local tunnel server bound to: ${JSON.stringify(addr)}`,
            );
            if (addr && typeof addr === 'object' && 'port' in addr) {
              const addressInfo = addr;
              boundPort = addressInfo.port;
            }
          } catch {
            /* ignore */
          }

          const chosenPort = boundPort ?? fwd.srcPort!;
          actualPorts.push(chosenPort);

          // candidates to try
          const candidates: Array<{ host: string; port: number }> = [];
          candidates.push({
            host: fwd.srcAddr || '127.0.0.1',
            port: chosenPort,
          });
          candidates.push({ host: '127.0.0.1', port: chosenPort });
          candidates.push({ host: '::1', port: chosenPort });
          if (boundPort && boundPort !== fwd.srcPort) {
            candidates.push({ host: '127.0.0.1', port: boundPort });
            candidates.push({ host: '::1', port: boundPort });
          }

          let ok = false;
          let lastErr: unknown = null;
          for (const c of candidates) {
            try {
              this.logger.warn(
                `Trying forwarded candidate ${c.host}:${c.port} for requested ${fwd.srcAddr || '127.0.0.1'}:${fwd.srcPort}`,
              );
              await waitForPortOpen(c.host, c.port, 3000, 4);
              this.logger.debug(`Candidate ${c.host}:${c.port} succeeded`);
              ok = true;
              break;
            } catch (e: unknown) {
              lastErr = e;
              this.logger.warn(
                `Candidate ${c.host}:${c.port} failed: ${extractErrorMessage(e)}`,
              );
            }
          }

          if (!ok) {
            if (lastErr instanceof Error) throw lastErr;
            throw new Error(String(lastErr ?? 'No candidate succeeded'));
          }
        } catch (e: unknown) {
          // close any servers created so far
          for (const s of servers) {
            try {
              s.close();
            } catch {
              /* ignore */
            }
          }
          this.tunnels.delete(environment.id);
          const msg = extractErrorMessage(e);
          this.logger.error(
            `Forward failed for env "${environment.id}": ${msg}`,
          );
          throw new InternalServerErrorException(
            `Local forwarded port ${fwd.srcAddr || '127.0.0.1'}:${fwd.srcPort} not ready: ${msg}`,
          );
        }
      }

      // After creating all servers and verifying their ports, map the
      // actual ports back to localDbPort/localRedisPort.
      const dbPort = environment.database ? actualPorts.shift()! : localDbPort;
      const redisPort = environment.redis
        ? actualPorts.shift()!
        : localRedisPort;

      this.logger.log(
        `SSH tunnel for env "${environment.id}" established. DB -> localhost:${dbPort}, Redis -> localhost:${redisPort}`,
      );

      return {
        server: servers[0],
        localDbPort: dbPort,
        localRedisPort: redisPort,
        close: () =>
          new Promise<void>((resolve) => {
            let pending = servers.length;
            if (pending === 0) return resolve();
            for (const s of servers) {
              s.close((err) => {
                pending -= 1;
                if (err) {
                  // Log and continue closing others
                  this.logger.warn(
                    'Error closing local server for tunnel:',
                    err,
                  );
                }
                if (pending === 0) {
                  this.logger.log(
                    `SSH tunnel for env "${environment.id}" closed.`,
                  );
                  resolve();
                }
              });
            }
          }),
      };
    } catch (err: unknown) {
      // This block will now correctly catch errors from createTunnel promise rejection.
      const host = sshOptions.host;
      const port = sshOptions.port;

      // The error from tunnel-ssh might be an AggregateError with an 'errors' array.
      let individualErrors = extractErrorMessage(err);
      const maybeErrObj = err as { errors?: unknown[] } | null;
      if (maybeErrObj && Array.isArray(maybeErrObj.errors)) {
        try {
          individualErrors = maybeErrObj.errors
            .map((e: unknown) => extractErrorMessage(e))
            .join(', ');
        } catch {
          // fall back to single message
        }
      }

      const detailedMessage = `Failed to establish SSH tunnel. Details: ${individualErrors}.`;

      const errorStack = err instanceof Error ? err.stack : String(err);
      this.logger.error(
        `Failed to create SSH tunnel for env "${environment.id}": ${detailedMessage}`,
        errorStack,
      );

      // Try fallback: spawn system ssh with -L mappings using requested src ports.
      try {
        const sshArgs: string[] = [];
        sshArgs.push('-i', privateKeyPath);
        // disable interactive prompts for known_hosts
        sshArgs.push('-o', 'StrictHostKeyChecking=no');
        sshArgs.push('-o', 'BatchMode=yes');
        for (const f of forwardOptions) {
          sshArgs.push(
            '-L',
            `${f.srcAddr || '127.0.0.1'}:${f.srcPort}:${f.dstAddr}:${f.dstPort}`,
          );
        }
        sshArgs.push(`${sshOptions.username}@${sshOptions.host}`);
        sshArgs.push('-N');

        this.logger.log(
          `Attempting fallback with system ssh: ssh ${sshArgs.join(' ')}`,
        );
        const child = spawn('ssh', sshArgs, { stdio: 'ignore' });

        const waitForFallback = async () => {
          // wait a short time for SSH to establish
          await new Promise((r) => setTimeout(r, 500));
          // verify each requested src port is open
          for (const f of forwardOptions) {
            await waitForPortOpen(
              f.srcAddr || '127.0.0.1',
              f.srcPort!,
              3000,
              5,
            );
          }
        };

        try {
          await waitForFallback();
          this.logger.log(
            `Fallback system ssh tunnel established for env "${environment.id}".`,
          );
          // Return a tunnel object that will kill the child process on close.
          const close = async () => {
            try {
              child.kill();
            } catch {
              /* ignore */
            }
          };
          // Provide a dummy server (not used) to satisfy the interface.
          const dummyServer = new net.Server();
          return {
            server: dummyServer,
            localDbPort: localDbPort,
            localRedisPort: localRedisPort,
            close,
          } as ActiveTunnel;
        } catch (fallbackErr) {
          try {
            child.kill();
          } catch {
            /* ignore */
          }
          this.logger.warn(
            `Fallback system ssh failed for env "${environment.id}": ${extractErrorMessage(fallbackErr)}`,
          );
        }
      } catch (spawnErr) {
        this.logger.warn(
          `Failed to spawn fallback ssh: ${extractErrorMessage(spawnErr)}`,
        );
      }

      // Also remove the failed tunnel promise from the cache to allow retries.
      this.tunnels.delete(environment.id);

      throw new InternalServerErrorException(
        `Failed to create SSH tunnel to ${host}:${port}. ${detailedMessage} Please check the 'jumpServer' configuration and ensure the host is accessible.`,
      );
    }
  }

  private getOrCreateTunnel(environmentId: string): Promise<ActiveTunnel> {
    if (!this.tunnels.has(environmentId)) {
      const env = this.environmentsService.getEnvironmentById(environmentId);
      if (!env) {
        throw new NotFoundException(
          `Environment "${environmentId}" not found.`,
        );
      }

      const tunnelPromise = this.createTunnel(env);
      this.tunnels.set(environmentId, tunnelPromise);
    }
    return this.tunnels.get(environmentId)!;
  }

  public async getProxiedDbConfig(environmentId: string) {
    const env = this.environmentsService.getEnvironmentById(environmentId);
    if (!env) {
      throw new NotFoundException(`Environment "${environmentId}" not found.`);
    }
    if (!env.database)
      throw new NotFoundException(
        `Database config for env "${environmentId}" not found.`,
      );

    if (!env.jumpServer) {
      this.logger.debug(
        `No jump server for env "${environmentId}", connecting directly to DB.`,
      );
      return env.database;
    }

    const tunnel = await this.getOrCreateTunnel(environmentId);
    return {
      ...env.database,
      host: '127.0.0.1',
      port: tunnel.localDbPort,
    };
  }

  public async getProxiedRedisConfig(environmentId: string) {
    const env = this.environmentsService.getEnvironmentById(environmentId);
    if (!env)
      throw new NotFoundException(`Environment "${environmentId}" not found.`);
    if (!env.redis)
      throw new NotFoundException(
        `Redis config for env "${environmentId}" not found.`,
      );

    if (!env.jumpServer) {
      this.logger.debug(
        `No jump server for env "${environmentId}", connecting directly to Redis.`,
      );
      return env.redis;
    }

    const tunnel = await this.getOrCreateTunnel(environmentId);
    return {
      ...env.redis,
      host: '127.0.0.1',
      port: tunnel.localRedisPort,
    };
  }
}
