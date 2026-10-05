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
  private static readonly MAX_ORDER_REDIS_ORDERS = 100;
  private static readonly MAX_REDIS_KEYS_PER_ORDER = 20;
  private static readonly MAX_REDIS_KEYS_TOTAL = 200;
  private static readonly MAX_REDIS_VALUE_BYTES = 16 * 1024;
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

  /**
   * Read-only lookup for existing order-related Redis records. It deliberately
   * accepts only a UID and tenant, reads a bounded set of that user's recent
   * orders, and scans a fixed key prefix rather than exposing a caller-controlled
   * Redis pattern.
   */
  async getUserOrderRedis(
    environmentId: string,
    uid: string,
    tenantId: number,
  ) {
    const pool = await this.getMysqlPool(environmentId);
    const userSql =
      'SELECT `id` FROM `spot`.`tbl_user` WHERE `tenant_user_id` = ? AND `tenant_id` = ? LIMIT 1';
    const [userRows] = (await pool.execute(userSql, [uid, tenantId])) as any;
    if (!Array.isArray(userRows) || userRows.length === 0 || !userRows[0]?.id) {
      return { status: 'not_found', error: `User with UID ${uid} not found.` };
    }

    const userId = String(userRows[0].id);
    const ordersSql = `
      SELECT
        id AS order_no, user_id, tenant_id, tx_type, tx_status,
        tx_deposit_status, tx_coin, tx_amount, tx_fee,
        tx_from_wallet, tx_to_wallet, remark, created_time, update_time
      FROM \`spot\`.\`tbl_tx\`
      WHERE user_id = ? AND tenant_id = ?
      ORDER BY update_time DESC
      LIMIT ${AgentQueryService.MAX_ORDER_REDIS_ORDERS}`;
    const [orderRows] = (await pool.execute(ordersSql, [
      userId,
      tenantId,
    ])) as any;
    const orders = Array.isArray(orderRows) ? orderRows : [];
    const client = await this.getRedisClient(environmentId);
    let remainingKeys = AgentQueryService.MAX_REDIS_KEYS_TOTAL;

    const ordersWithRedis: Array<Record<string, any> & {
      redisKeys: Array<{
        key: string;
        value: string | object | null;
        valueTruncated: boolean;
        ttlSeconds: number;
      }>;
      redisKeySearchTruncated: boolean;
      redisLookupOrderNo: string;
      redisLookupTruncated: boolean;
    }> = [];
    for (const order of orders) {
      if (remainingKeys <= 0) {
        const orderNo = String(order.order_no);
        const redisLookupTruncated = orderNo.length > 19;
        ordersWithRedis.push({
          ...order,
          redisKeys: [],
          redisKeySearchTruncated: true,
          redisLookupOrderNo: redisLookupTruncated ? orderNo.slice(0, 19) : orderNo,
          redisLookupTruncated,
        });
        continue;
      }
      const orderNo = String(order.order_no);
      const redisLookupTruncated = orderNo.length > 19;
      const redisLookupOrderNo = redisLookupTruncated ? orderNo.slice(0, 19) : orderNo;
      const limit = Math.min(AgentQueryService.MAX_REDIS_KEYS_PER_ORDER, remainingKeys);
      const keys = await this.scanRedisKeysForOrder(
        client,
        redisLookupOrderNo,
        redisLookupTruncated,
        limit,
      );
      remainingKeys -= keys.length;
      const redisKeys: Array<{
        key: string;
        value: string | object | null;
        valueTruncated: boolean;
        ttlSeconds: number;
      }> = [];
      for (const key of keys) {
        const result = await this.readRedisKey(client, key);
        if (result.status === 'success' && result.data) redisKeys.push(result.data);
      }
      ordersWithRedis.push({
        ...order,
        redisKeys,
        redisKeySearchTruncated: keys.length === limit,
        redisLookupOrderNo,
        redisLookupTruncated,
      });
    }

    const redisKeyCount = ordersWithRedis.reduce(
      (count, order) => count + order.redisKeys.length,
      0,
    );
    this.logger.log(
      `[AgentQuery] user-order-redis env=${environmentId} tenantId=${tenantId} orders=${ordersWithRedis.length} redisKeys=${redisKeyCount}`,
    );
    return {
      status: 'success',
      data: {
        uid,
        userId,
        tenantId,
        orderLimit: AgentQueryService.MAX_ORDER_REDIS_ORDERS,
        redisKeyLimit: AgentQueryService.MAX_REDIS_KEYS_TOTAL,
        orders: ordersWithRedis,
      },
    };
  }

  async getOtcMerchantInfoByUserUid(
    environmentId: string,
    uid: string,
    tenantId: number,
  ) {
    const pool = await this.getMysqlPool(environmentId);
    const userSql =
      'SELECT id FROM `spot`.`tbl_user` WHERE `tenant_user_id` = ? AND `tenant_id` = ? LIMIT 1';
    const [userRows] = (await pool.execute(userSql, [uid, tenantId])) as any;
    if (!Array.isArray(userRows) || userRows.length === 0 || !userRows[0]?.id) {
      return { status: 'not_found', error: `User with UID ${uid} not found.` };
    }

    const userId = Number(userRows[0].id);
    const sql =
      'SELECT * FROM `otc`.`tbl_otc_merchant` WHERE `user_id` = ? AND `tenant_id` = ? AND `status` = 0 AND `deleted` = 0 LIMIT 1';
    const [rows] = (await pool.execute(sql, [userId, tenantId])) as any;
    if (Array.isArray(rows) && rows.length > 0) {
      return { status: 'success', data: rows[0] };
    }
    return {
      status: 'not_found',
      error: `OTC merchant info for user id ${userId} not found.`,
    };
  }

  async updateOtcMerchantNameByUserUid(
    environmentId: string,
    uid: string,
    tenantId: number,
    name: string,
  ) {
    const pool = await this.getMysqlPool(environmentId);
    const userSql =
      'SELECT id FROM `spot`.`tbl_user` WHERE `tenant_user_id` = ? AND `tenant_id` = ? LIMIT 1';
    const [userRows] = (await pool.execute(userSql, [uid, tenantId])) as any;
    if (!Array.isArray(userRows) || userRows.length === 0 || !userRows[0]?.id) {
      return { status: 'not_found', error: `User with UID ${uid} not found.` };
    }

    const userId = Number(userRows[0].id);
    const sql =
      'UPDATE `otc`.`tbl_otc_merchant` SET `name` = ? WHERE `user_id` = ? AND `tenant_id` = ? AND `status` = 0 AND `deleted` = 0';
    const [result] = (await pool.execute(sql, [name, userId, tenantId])) as any;

    if (result && result.affectedRows > 0) {
      return { message: 'OTC merchant name updated successfully.' };
    }
    return { status: 'not_found', error: 'No OTC merchant record updated.' };
  }

  async clearUserInviteBy(
    environmentId: string,
    uid: string,
    tenantId: number,
  ) {
    const pool = await this.getMysqlPool(environmentId);
    const selectSql =
      'SELECT `invite_by` FROM `spot`.`tbl_user` WHERE `tenant_user_id` = ? AND `tenant_id` = ? LIMIT 1';
    const [rows] = (await pool.execute(selectSql, [uid, tenantId])) as any;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { status: 'not_found', error: `User with UID ${uid} not found.` };
    }

    const currentInviteBy = rows[0]?.invite_by;
    if (currentInviteBy === null || currentInviteBy === undefined || currentInviteBy === '') {
      return { status: 'noop', message: 'invite_by is already cleared.' };
    }

    const updateSql =
      'UPDATE `spot`.`tbl_user` SET `invite_by` = NULL WHERE `tenant_user_id` = ? AND `tenant_id` = ?';
    const [result] = (await pool.execute(updateSql, [uid, tenantId])) as any;
    if (result && result.affectedRows > 0) {
      return { message: 'User invite_by cleared successfully.' };
    }
    return { status: 'not_found', error: 'No user record updated.' };
  }

  async resetPartnerPassword(
    environmentId: string,
    uid: string,
    tenantId: number,
  ) {
    const pool = await this.getMysqlPool(environmentId);
    const userSql =
      'SELECT `id` FROM `spot`.`tbl_user` WHERE `tenant_user_id` = ? AND `tenant_id` = ? LIMIT 1';
    const [userRows] = (await pool.execute(userSql, [uid, tenantId])) as any;
    const userId = userRows?.[0]?.id;
    if (!userId) {
      return { status: 'not_found', error: `User with UID ${uid} not found.` };
    }

    const activePartnerSql =
      'SELECT `id` FROM `spot`.`tbl_channel` WHERE `channel_user_id` = ? AND `tenant_id` = ? AND (`is_del` = 0 OR `is_del` IS NULL)';
    const [partnerRows] = (await pool.execute(activePartnerSql, [userId, tenantId])) as any;
    if (!Array.isArray(partnerRows) || partnerRows.length === 0) {
      return {
        status: 'not_found',
        error: `No active partner record found for UID ${uid}.`,
      };
    }

    const resetPasswordHash = 'e19d5cd5af0378da05f63f891c7467af';
    const updateSql =
      'UPDATE `spot`.`tbl_channel` SET `password` = ? WHERE `channel_user_id` = ? AND `tenant_id` = ? AND (`is_del` = 0 OR `is_del` IS NULL)';
    const [result] = (await pool.execute(updateSql, [
      resetPasswordHash,
      userId,
      tenantId,
    ])) as any;

    if (!result || result.affectedRows === 0) {
      return {
        status: 'not_found',
        error: `No active partner record updated for UID ${uid}.`,
      };
    }

    return {
      status: 'success',
      message: 'Partner password reset successfully.',
      affectedRows: result.affectedRows,
    };
  }

  async disableOtcUserTradeByUserUid(environmentId: string, uid: string) {
    const pool = await this.getMysqlPool(environmentId);
    const selectSql =
      'SELECT `status` FROM `otc`.`otc_user` WHERE `tenant_user_id` = ? LIMIT 1';
    const [rows] = (await pool.execute(selectSql, [uid])) as any;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { status: 'not_found', error: `OTC user with tenant_user_id ${uid} not found.` };
    }

    const currentStatus = Number(rows[0]?.status);
    if (currentStatus === 0) {
      return { status: 'noop', message: 'OTC trading is already disabled.' };
    }

    const updateSql =
      'UPDATE `otc`.`otc_user` SET `status` = 0 WHERE `tenant_user_id` = ?';
    const [result] = (await pool.execute(updateSql, [uid])) as any;
    if (result && result.affectedRows > 0) {
      return { message: 'OTC trading disabled successfully.' };
    }
    return { status: 'not_found', error: 'No OTC user record updated.' };
  }

  async enableOtcUserTradeByUserUid(environmentId: string, uid: string) {
    const pool = await this.getMysqlPool(environmentId);
    const selectSql =
      'SELECT `status` FROM `otc`.`otc_user` WHERE `tenant_user_id` = ? LIMIT 1';
    const [rows] = (await pool.execute(selectSql, [uid])) as any;
    if (!Array.isArray(rows) || rows.length === 0) {
      return { status: 'not_found', error: `OTC user with tenant_user_id ${uid} not found.` };
    }

    const currentStatus = Number(rows[0]?.status);
    if (currentStatus === 1) {
      return { status: 'noop', message: 'OTC trading is already enabled.' };
    }

    const updateSql =
      'UPDATE `otc`.`otc_user` SET `status` = 1 WHERE `tenant_user_id` = ?';
    const [result] = (await pool.execute(updateSql, [uid])) as any;
    if (result && result.affectedRows > 0) {
      return { message: 'OTC trading enabled successfully.' };
    }
    return { status: 'not_found', error: 'No OTC user record updated.' };
  }

  async getRedisKey(environmentId: string, key: string) {
    const client = await this.getRedisClient(environmentId);
    return this.readRedisKey(client, key);
  }

  private async scanRedisKeys(client: RedisClient, pattern: string, limit: number) {
    let cursor = '0';
    const keys: string[] = [];
    do {
      const [nextCursor, batch] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      cursor = nextCursor;
      for (const key of batch) {
        keys.push(key);
        if (keys.length >= limit) return keys;
      }
    } while (cursor !== '0');
    return keys;
  }

  private async scanRedisKeysForOrder(
    client: RedisClient,
    lookupOrderNo: string,
    isTruncated: boolean,
    limit: number,
  ) {
    const keyPrefix = `BALANCE_EXCHANGE_BIZ:${lookupOrderNo}`;
    if (isTruncated) {
      // Historical Redis blob keys omit the long-order suffix, so prefix matching
      // is required only when the database order number was truncated to 19 chars.
      return this.scanRedisKeys(client, `${keyPrefix}*`, limit);
    }

    // Short order numbers retain exact semantics while accepting either a bare key
    // or the normal colon-delimited suffix form.
    const exactKeys = await this.scanRedisKeys(client, keyPrefix, limit);
    if (exactKeys.length >= limit) return exactKeys;
    const suffixedKeys = await this.scanRedisKeys(
      client,
      `${keyPrefix}:*`,
      limit - exactKeys.length,
    );
    return [...new Set([...exactKeys, ...suffixedKeys])];
  }

  private truncateRedisValue(value: string | object | null) {
    if (value == null) return { value, valueTruncated: false };
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (Buffer.byteLength(serialized, 'utf8') <= AgentQueryService.MAX_REDIS_VALUE_BYTES) {
      return { value, valueTruncated: false };
    }
    return {
      value: `${serialized.slice(0, AgentQueryService.MAX_REDIS_VALUE_BYTES)}…`,
      valueTruncated: true,
    };
  }

  private async readRedisKey(client: RedisClient, key: string) {
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
      return { status: 'not_found', error: `Key "${key}" not found.` };
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

    const limitedValue = this.truncateRedisValue(value);
    return {
      status: 'success',
      data: {
        key,
        value: limitedValue.value,
        valueTruncated: limitedValue.valueTruncated,
        ttlSeconds: ttl,
      },
    };
  }

  async createRedisKey(
    environmentId: string,
    key: string,
    value: string,
    ttlSeconds?: number,
  ) {
    const client = await this.getRedisClient(environmentId);
    const result =
      ttlSeconds !== undefined && ttlSeconds !== null && ttlSeconds > 0
        ? await client.set(key, value, 'EX', Math.floor(ttlSeconds))
        : await client.set(key, value);
    return {
      message: `Key "${key}" created successfully.`,
      result,
    };
  }

  async deleteRedisKey(environmentId: string, key: string) {
    const client = await this.getRedisClient(environmentId);
    const deletedCount = await client.del(key);
    if (deletedCount > 0) {
      return { message: `Key "${key}" deleted successfully.` };
    }
    return { status: 'not_found', error: `Key "${key}" not found.` };
  }

  async updateUser(
    environmentId: string,
    uid: string,
    tenantId: number,
    data: Record<string, any>,
  ) {
    const updatePayload: { [key: string]: any } = {};

    if (data.email !== undefined) {
      updatePayload.email = data.email;
    }

    if (data.tel !== undefined) {
      if (data.tel === '') {
        updatePayload.tel = null;
        updatePayload.tel_country_code = null;
      } else {
        updatePayload.tel = data.tel;
        if (data.tel_country_code !== undefined) {
          updatePayload.tel_country_code = data.tel_country_code;
        }
      }
    } else if (data.tel_country_code !== undefined) {
      updatePayload.tel_country_code = data.tel_country_code;
    }

    if (Object.keys(updatePayload).length === 0) {
      return { status: 'noop', message: 'No fields to update.' };
    }

    const pool = await this.getMysqlPool(environmentId);
    const fields = Object.keys(updatePayload)
      .map((key) => `\`${key}\` = ?`)
      .join(', ');
    const values = Object.values(updatePayload);
    const sql = `UPDATE \`tbl_user\` SET ${fields} WHERE \`tenant_user_id\` = ? AND \`tenant_id\` = ? LIMIT 1`;

    try {
      const [result] = (await pool.execute(sql, [...values, uid, tenantId])) as any;
      if (!result || result.affectedRows === 0) {
        return { status: 'not_found', error: `User with UID ${uid} not found.` };
      }
      return { status: 'success', message: 'User updated successfully.' };
    } catch (error: any) {
      if (error?.code === 'ER_DUP_ENTRY') {
        return {
          status: 'conflict',
          error:
            String(error?.message || '').includes('tbl_user_tel_tenantId_uindex')
              ? '此电话号码已被同一租户下的其他用户使用。'
              : '更新失败，因为一个或多个字段的值与现有记录冲突。',
        };
      }
      throw error;
    }
  }

  async deactivateUser(environmentId: string, uid: string, tenantId: number) {
    const pool = await this.getMysqlPool(environmentId);
    const userSql =
      'SELECT `tenant_user_id`, `email`, `tel`, `tel_country_code` FROM `tbl_user` WHERE `tenant_user_id` = ? AND `tenant_id` = ? LIMIT 1';
    const [userRows] = (await pool.execute(userSql, [uid, tenantId])) as any;

    if (!Array.isArray(userRows) || userRows.length === 0) {
      return { status: 'not_found', error: `User with UID ${uid} not found.` };
    }

    const user = userRows[0] || {};
    const alreadyCleared =
      user.email == null &&
      user.tel == null &&
      user.tel_country_code == null;

    if (alreadyCleared) {
      return {
        status: 'noop',
        message: 'User account is already deactivated.',
      };
    }

    const sql = `
      UPDATE \`spot\`.\`tbl_user\` u
      LEFT JOIN \`spot\`.\`user_sensitive_info\` s
        ON u.\`tenant_user_id\` = s.\`tenant_user_id\`
      SET
        u.\`email\` = NULL,
        s.\`email\` = NULL,
        u.\`tel_country_code\` = NULL,
        u.\`tel\` = NULL,
        s.\`tel_country_code\` = NULL,
        s.\`tel\` = NULL
      WHERE u.\`tenant_user_id\` = ?
        AND u.\`tenant_id\` = ?
    `;
    const [result] = (await pool.execute(sql, [uid, tenantId])) as any;

    if (!result || result.affectedRows === 0) {
      return {
        status: 'not_found',
        error: `Failed to deactivate user with UID ${uid}. The record may have been modified or deleted.`,
      };
    }

    return {
      status: 'success',
      message: 'User account deactivated successfully. Email and phone fields were cleared.',
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
