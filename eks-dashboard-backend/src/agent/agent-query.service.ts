import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import Redis, { Redis as RedisClient } from 'ioredis';
import { AgentConfigService } from './agent-config.service';
import { AgentConnectionService } from './agent-connection.service';
import { AgentError } from './agent.types';

interface JdbcConfig {
  host: string;
  port: number;
  database: string;
  params: URLSearchParams;
}

@Injectable()
export class AgentQueryService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentQueryService.name);
  private mysqlPool: mysql.Pool | null = null;
  private mysqlKey = '';
  private redisClient: RedisClient | null = null;
  private redisKey = '';

  constructor(
    private readonly configService: AgentConfigService,
    private readonly connectionService: AgentConnectionService,
  ) {}

  async onModuleDestroy() {
    if (this.mysqlPool) {
      await this.mysqlPool.end();
      this.mysqlPool = null;
    }
    if (this.redisClient) {
      this.redisClient.disconnect();
      this.redisClient = null;
    }
  }

  async aggregate(
    environmentId: string,
    identifier: string,
    type: 'UID' | 'EMAIL' | 'PHONE',
    tenantId?: number,
  ) {
    const timeoutMs = this.configService.getQueryTimeoutMs();
    let user: Record<string, unknown> | null = null;
    let mysqlError: string | null = null;

    try {
      user = await this.withTimeout(
        this.findUser(environmentId, identifier, type, tenantId),
        timeoutMs,
      );
    } catch (error) {
      mysqlError = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `[AgentQuery] mysql query failed env=${environmentId} type=${type}: ${mysqlError}`,
      );
    }

    if (mysqlError) {
      return {
        mysql: { status: 'error', error: mysqlError },
        redis: { status: 'not_found', error: '依赖用户信息，未执行缓存查询' },
        mongo: { status: 'not_found', error: '暂未启用 Mongo 查询' },
      };
    }
    if (!user) {
      return {
        mysql: { status: 'not_found', error: '未找到用户信息' },
        redis: { status: 'not_found', error: '未找到缓存数据' },
        mongo: { status: 'not_found', error: '未找到活动日志' },
      };
    }

    const redisData = user.id
      ? await this.withTimeout(
          this.findRedisKeys(environmentId, String(user.id)),
          timeoutMs,
        ).catch((error) => {
          this.logger.warn(
            `[AgentQuery] redis subquery failed env=${environmentId}: ${String(error)}`,
          );
          return [];
        })
      : [];

    return {
      mysql: { status: 'success', data: user },
      redis:
        redisData.length > 0
          ? { status: 'success', data: redisData }
          : { status: 'not_found', error: '未找到缓存数据' },
      mongo: { status: 'not_found', error: '暂未启用 Mongo 查询' },
    };
  }

  private async findUser(
    environmentId: string,
    identifier: string,
    type: 'UID' | 'EMAIL' | 'PHONE',
    tenantId?: number,
  ) {
    const pool = await this.getMysqlPool(environmentId);
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (type === 'UID') {
      where.push('`tenant_user_id` = ?');
      params.push(identifier);
    } else if (type === 'EMAIL') {
      where.push('`email` = ?');
      params.push(identifier);
    } else {
      where.push('`tel` = ?');
      params.push(identifier);
    }

    if (tenantId !== undefined && tenantId !== null) {
      where.push('`tenant_id` = ?');
      params.push(tenantId);
    }

    const sql = `SELECT * FROM \`tbl_user\` WHERE ${where.join(' AND ')} LIMIT 1`;
    const [rows] = await pool.execute(sql, params);
    if (!Array.isArray(rows) || rows.length === 0) return null;
    return rows[0] as Record<string, unknown>;
  }

  private async findRedisKeys(environmentId: string, userId: string) {
    const client = await this.getRedisClient(environmentId);
    const pattern = `*${userId}*`;
    const keys = await client.keys(pattern);
    if (keys.length === 0) return [];

    const pipeline = client.pipeline();
    for (const key of keys.slice(0, 50)) {
      pipeline.ttl(key);
    }
    const ttlRows = await pipeline.exec();
    return keys.slice(0, 50).map((key, index) => ({
      key,
      ttl: Number(ttlRows?.[index]?.[1] ?? -2),
    }));
  }

  private async getMysqlPool(environmentId: string) {
    const resolved = await this.connectionService.getResolvedConnectionConfig(
      environmentId,
    );
    const key = JSON.stringify({
      url: resolved.mysql.url,
      username: resolved.mysql.username,
      password: resolved.mysql.password,
    });
    if (this.mysqlPool && this.mysqlKey === key) {
      return this.mysqlPool;
    }
    if (this.mysqlPool) {
      await this.mysqlPool.end();
      this.mysqlPool = null;
    }

    const jdbc = this.parseJdbcUrl(resolved.mysql.url);
    this.mysqlPool = mysql.createPool({
      host: jdbc.host,
      port: jdbc.port,
      user: resolved.mysql.username,
      password: resolved.mysql.password,
      database: jdbc.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });
    this.mysqlKey = key;
    return this.mysqlPool;
  }

  private async getRedisClient(environmentId: string) {
    const resolved = await this.connectionService.getResolvedConnectionConfig(
      environmentId,
    );
    const key = JSON.stringify({
      host: resolved.redis.host,
      port: resolved.redis.port,
      database: resolved.redis.database,
      ssl: resolved.redis.ssl,
      password: resolved.redis.password,
    });
    if (this.redisClient && this.redisKey === key) {
      return this.redisClient;
    }
    if (this.redisClient) {
      this.redisClient.disconnect();
      this.redisClient = null;
    }

    this.redisClient = new Redis({
      host: resolved.redis.host,
      port: resolved.redis.port,
      db: resolved.redis.database,
      password: resolved.redis.password,
      tls: resolved.redis.ssl ? { servername: resolved.redis.host } : undefined,
      lazyConnect: true,
      maxRetriesPerRequest: 2,
      connectTimeout: 2000,
    });
    await this.redisClient.connect();
    this.redisKey = key;
    return this.redisClient;
  }

  async getTraderInfoByUserUid(
    environmentId: string,
    uid: string,
    tenantId: number,
  ) {
    const pool = await this.getMysqlPool(environmentId);
    const userSql =
      'SELECT id FROM `tbl_user` WHERE `tenant_user_id` = ? AND `tenant_id` = ? LIMIT 1';
    const [userRows] = (await pool.execute(userSql, [uid, tenantId])) as any;
    if (!Array.isArray(userRows) || userRows.length === 0 || !userRows[0]?.id) {
      return { status: 'not_found', error: `User with UID ${uid} not found.` };
    }

    const userId = String(userRows[0].id);
    const sqlWithTenant =
      'SELECT * FROM `tiger`.`copy_trade_user_info` WHERE `user_id` = ? AND `tenant_id` = ? LIMIT 1';
    try {
      const [rows] = (await pool.execute(sqlWithTenant, [userId, tenantId])) as any;
      if (Array.isArray(rows) && rows.length > 0) {
        return { status: 'success', data: rows[0] };
      }
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (!/Unknown column|ER_BAD_FIELD_ERROR/i.test(msg)) {
        throw err;
      }
      this.logger.warn(
        '[AgentQuery] copy_trade_user_info missing tenant_id, fallback to user_id-only query',
      );
    }

    const sql =
      'SELECT * FROM `tiger`.`copy_trade_user_info` WHERE `user_id` = ? LIMIT 1';
    const [rowsNoTenant] = (await pool.execute(sql, [userId])) as any;
    if (Array.isArray(rowsNoTenant) && rowsNoTenant.length > 0) {
      return { status: 'success', data: rowsNoTenant[0] };
    }
    return {
      status: 'not_found',
      error: `Trader info for user id ${userId} not found.`,
    };
  }

  async updateTraderNickName(
    environmentId: string,
    uid: string,
    nickName: string,
    tenantId: number,
  ) {
    const pool = await this.getMysqlPool(environmentId);
    const userSql =
      'SELECT id FROM `tbl_user` WHERE `tenant_user_id` = ? AND `tenant_id` = ? LIMIT 1';
    const [userRows] = (await pool.execute(userSql, [uid, tenantId])) as any;
    if (!Array.isArray(userRows) || userRows.length === 0 || !userRows[0]?.id) {
      return { status: 'not_found', error: `User with UID ${uid} not found.` };
    }

    const userId = String(userRows[0].id);
    const sqlWithTenant =
      'UPDATE `tiger`.`copy_trade_user_info` SET `nick_name` = ? WHERE `user_id` = ? AND `tenant_id` = ?';
    try {
      const [result] = (await pool.execute(sqlWithTenant, [nickName, userId, tenantId])) as any;
      if (result && result.affectedRows > 0) {
        return { message: 'Trader nick_name updated successfully.' };
      }
    } catch (err: any) {
      const msg = String(err?.message || err);
      if (!/Unknown column|ER_BAD_FIELD_ERROR/i.test(msg)) {
        throw err;
      }
      this.logger.warn(
        '[AgentQuery] copy_trade_user_info missing tenant_id, fallback to user_id-only update',
      );
    }

    const sql =
      'UPDATE `tiger`.`copy_trade_user_info` SET `nick_name` = ? WHERE `user_id` = ?';
    const [resultNoTenant] = (await pool.execute(sql, [nickName, userId])) as any;
    if (resultNoTenant && resultNoTenant.affectedRows > 0) {
      return { message: 'Trader nick_name updated successfully.' };
    }
    return { status: 'not_found', error: 'No trader record updated.' };
  }

  private parseJdbcUrl(url: string): JdbcConfig {
    const matched = url.match(/^jdbc:mysql:\/\/([^/?]+)\/([^?]+)(?:\?(.*))?$/i);
    if (!matched) {
      throw new AgentError('CONFIG_PARSE_FAILED', `Invalid JDBC url: ${url}`);
    }
    const hostPort = matched[1];
    const database = matched[2];
    const query = matched[3] || '';
    const firstHostPort = hostPort.split(',')[0];
    const [hostRaw, portRaw] = firstHostPort.split(':');
    const host = hostRaw?.trim();
    const port = portRaw ? Number(portRaw) : 3306;
    if (!host || !Number.isFinite(port)) {
      throw new AgentError(
        'CONFIG_PARSE_FAILED',
        `Invalid JDBC host/port: ${firstHostPort}`,
      );
    }
    return {
      host,
      port,
      database: decodeURIComponent(database),
      params: new URLSearchParams(query),
    };
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new AgentError('QUERY_EXEC_FAILED', `Query timeout ${timeoutMs}ms`));
      }, timeoutMs);
      promise
        .then((value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(value);
        })
        .catch((error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}

