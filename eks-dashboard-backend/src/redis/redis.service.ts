import {
  Injectable,
  Logger,
  OnModuleDestroy,
  NotFoundException,
} from '@nestjs/common';
import Redis, { Redis as RedisClient, RedisOptions } from 'ioredis';
import { EnvironmentsService } from '../environments/environments.service';
import { TunnelManagerService } from '../tunnel/tunnel-manager.service';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private clients = new Map<string, RedisClient>();

  constructor(
    private readonly environmentsService: EnvironmentsService,
    private readonly tunnelManager: TunnelManagerService,
  ) {}

  async onModuleDestroy() {
    this.logger.log('Disconnecting all Redis clients...');
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();
    this.logger.log('All Redis clients disconnected.');
  }

  private async getClient(environmentId: string): Promise<RedisClient> {
    if (this.clients.has(environmentId)) {
      return this.clients.get(environmentId)!;
    }

    const env = this.environmentsService.getEnvironmentById(environmentId);
    if (!env)
      throw new NotFoundException(`Environment ${environmentId} not found`);

    let redisHost = env.redis!.host;
    let redisPort = env.redis!.port;
    const password = env.redis!.password;
    const useTls = !!env.redis!.ssl;

    if (env.jumpServer) {
      const forwards = [
        {
          name: 'redis',
          dstHost: redisHost,
          dstPort: redisPort,
        },
      ];
      const tunnel = await this.tunnelManager.getTunnel(
        environmentId,
        forwards,
      );
      redisHost = tunnel.localHost;
      redisPort = tunnel.localPorts['redis'];
    }

    const options: RedisOptions = {
      host: redisHost,
      port: redisPort,
      password,
      lazyConnect: true,
      connectTimeout: 2000, // fail faster
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(1000 * times, 2000),
    };

    if (useTls) {
      this.logger.log(
        `Enabling SSL/TLS for Redis connection to ${env.redis!.host}`,
      );
      options.tls = { servername: env.redis!.host };
    }

    const client = new Redis(options);

    client.on('error', (err) => {
      this.logger.error(`Redis client error for env ${environmentId}:`, err);
      // best-effort: if we detect connection refused, invalidate tunnel so next attempt recreates it
      try {
        const errText = String(err);
        if (errText.includes('ECONNREFUSED')) {
          this.tunnelManager
            .invalidate(environmentId)
            .catch((e) =>
              this.logger.debug(
                'Error invalidating tunnel after redis error',
                e,
              ),
            );
        }
      } catch (e) {
        this.logger.debug('Error processing redis error handler', e);
      }
    });

    // Attempt to connect now with timeout and a single retry path that invalidates the tunnel
    const connectWithTimeout = (c: RedisClient, timeoutMs = 2000) =>
      new Promise<void>((resolve, reject) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          reject(new Error('Redis connect timeout'));
        }, timeoutMs);

        c.connect()
          .then(() => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve();
          })
          .catch((err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            reject(err);
          });
      });

    this.clients.set(environmentId, client);
    this.logger.log(
      `Redis client created for environment "${environmentId}". Attempting connect...`,
    );

    try {
      await connectWithTimeout(client, 2000);
      this.logger.log(`Redis client connected for env "${environmentId}"`);
      return client;
    } catch (firstErr) {
      this.logger.warn(
        `Redis connect failed for env ${environmentId}: ${String(firstErr)}; invalidating tunnel and retrying once.`,
      );
      try {
        await this.tunnelManager.invalidate(environmentId);
      } catch (invErr) {
        this.logger.debug(
          'Failed to invalidate tunnel during redis connect retry',
          invErr,
        );
      }
      // create a fresh client and try again
      const client2 = new Redis(options);
      client2.on('error', (err) =>
        this.logger.error(`Redis client error for env ${environmentId}:`, err),
      );
      this.clients.set(environmentId, client2);
      try {
        await connectWithTimeout(client2, 2000);
        this.logger.log(
          `Redis client connected for env "${environmentId}" on retry`,
        );
        return client2;
      } catch (secondErr) {
        this.logger.error(
          `Redis connect retry failed for env ${environmentId}: ${String(secondErr)}`,
        );
        // cleanup
        try {
          client.disconnect();
        } catch {}
        try {
          client2.disconnect();
        } catch {}
        this.clients.delete(environmentId);
        throw secondErr;
      }
    }
  }

  async getKeysWithTtl(
    environmentId: string,
    pattern: string,
  ): Promise<{ key: string; ttl: number }[]> {
    const client = await this.getClient(environmentId);
    const keys = await client.keys(pattern);
    const pipeline = client.pipeline();
    keys.forEach((key) => pipeline.ttl(key));
    const ttls = await pipeline.exec();
    return keys.map((key, index) => ({
      key,
      ttl: ttls?.[index]?.[1] as number,
    }));
  }

  async deleteKey(environmentId: string, key: string): Promise<number> {
    const client = await this.getClient(environmentId);
    return client.del(key);
  }

  async setKey(
    environmentId: string,
    key: string,
    value: string,
    ttlSeconds?: number,
  ): Promise<'OK' | null> {
    const client = await this.getClient(environmentId);
    if (ttlSeconds !== undefined && ttlSeconds !== null && ttlSeconds > 0) {
      return client.set(key, value, 'EX', Math.floor(ttlSeconds));
    }
    return client.set(key, value);
  }

  // Get a single key's value and TTL (seconds). TTL semantics:
  // -2 => key does not exist
  // -1 => key exists but has no expire
  async getKeyWithTtl(
    environmentId: string,
    key: string,
  ): Promise<{ key: string; value: string | object | null; ttl: number }> {
    const client = await this.getClient(environmentId);
    const metaPipeline = client.pipeline();
    metaPipeline.type(key);
    metaPipeline.ttl(key);
    const meta = await metaPipeline.exec();

    const rawType = meta?.[0]?.[1];
    const redisType =
      typeof rawType === 'string' ? rawType : String(rawType ?? 'none');
    const rawTtl = meta?.[1]?.[1];
    const ttl = typeof rawTtl === 'number' ? rawTtl : Number(rawTtl ?? -2);

    if (redisType === 'none' || ttl === -2) {
      return { key, value: null, ttl: -2 };
    }

    const parseStringValue = (raw: unknown): string | object | null => {
      if (raw == null) return null;
      if (typeof raw !== 'string') return String(raw);
      try {
        const parsed = JSON.parse(raw);
        return typeof parsed === 'object' && parsed !== null
          ? parsed
          : String(parsed);
      } catch {
        return raw;
      }
    };

    let value: string | object | null = null;
    switch (redisType) {
      case 'string': {
        const raw = await client.get(key);
        value = parseStringValue(raw);
        break;
      }
      case 'hash': {
        value = await client.hgetall(key);
        break;
      }
      case 'set': {
        value = await client.smembers(key);
        break;
      }
      case 'list': {
        value = await client.lrange(key, 0, -1);
        break;
      }
      case 'zset': {
        const rows = await client.zrange(key, 0, -1, 'WITHSCORES');
        const zset: Array<{ member: string; score: number }> = [];
        for (let i = 0; i < rows.length; i += 2) {
          zset.push({
            member: rows[i],
            score: Number(rows[i + 1]),
          });
        }
        value = zset;
        break;
      }
      default: {
        value = { redisType };
        break;
      }
    }

    return { key, value, ttl };
  }
}
