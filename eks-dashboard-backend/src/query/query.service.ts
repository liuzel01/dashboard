import {
  Injectable,
  InternalServerErrorException,
  HttpException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { RedisService } from '../redis/redis.service';
import { UpdateUserDto } from './dto/update-user.dto';

// --- 模拟的数据服务，请替换为你自己的真实服务 ---
/*@Injectable()
export class RedisDataService {
  async findKeysByUid(uid: string) {
    if (uid === '12345') {
      return [
        {
          key: `user:${uid}:session`,
          value: { token: 'abc-def-ghi', last_login: '2023-09-17T10:00:00Z' },
        },
        { key: `user:${uid}:cart`, value: ['item-A', 'item-B'] },
      ];
    }
    return [];
  }
}*/

@Injectable()
export class MongoDataService {
  async findActivityByUid(uid: string) {
    // 总是返回 null 来演示“未找到”的情况
    return Promise.resolve(null);
  }
}
// --- 模拟服务结束 ---

@Injectable()
export class QueryService {
  private readonly logger = new Logger(QueryService.name);

  constructor(
    private readonly databaseService: DatabaseService,
    private readonly redisService: RedisService,
    private readonly mongoService: MongoDataService,
  ) {}

  // Helper to fetch a single redis key and return TTL and formatted TTL
  async getRedisKey(environmentId: string, key: string) {
    try {
      const result = await this.redisService.getKeyWithTtl(environmentId, key);
      const ttl = result.ttl; // seconds
      // If TTL is -2 it means the key does not exist. Return 404 so front-end won't show a non-existent key.
      if (ttl === -2) {
        throw new NotFoundException(`Key "${key}" not found.`);
      }
      const formatted = this.formatTtl(ttl);
      return {
        key: result.key,
        value: result.value,
        ttlSeconds: ttl,
        ttlFormatted: formatted,
      };
    } catch (e) {
      // Use warn level here because missing keys or transient redis timeouts are
      // expected in some flows and should not be logged as ERROR for routine queries.
      this.logger.warn(
        `Warning fetching redis key ${key} in env ${environmentId}: ${String(e)}`,
      );
      throw e;
    }
  }

  private formatTtl(ttl: number) {
    if (ttl === -2) return '不存在';
    if (ttl === -1) return '无过期时间';
    const sec = Math.max(0, Math.floor(ttl));
    const hours = Math.floor(sec / 3600);
    const minutes = Math.floor((sec % 3600) / 60);
    const seconds = sec % 60;
    return `${hours}小时${minutes}分钟${seconds}秒`;
  }

  async aggregate(
    environmentId: string,
    identifier: string,
    type: 'UID' | 'EMAIL' | 'PHONE',
    tenantId?: number,
  ) {
    this.logger.log(
      `Aggregating data for ${type}: ${identifier} in env ${environmentId} (tenant: ${tenantId || 'any'})`,
    );
    const uid = identifier; // 简化处理，真实应用中可能需要转换

    // 步骤 1: 从 MySQL 获取用户以找到数据库 ID
    const user = await this.databaseService.findUserByUid(
      environmentId,
      uid,
      tenantId,
    );

    // 步骤 2: 根据用户 ID 查询 Redis 和 Mongo
    const redisPromise = user?.id
      ? (async () => {
          // Wrap Redis call with a short timeout so slow/unavailable Redis won't
          // block the whole aggregation. If it times out, return not found.
          const p = this.redisService.getKeysWithTtl(
            environmentId,
            `*${user.id}*`,
          );
          const timeoutMs = 2500;
          const timeout = new Promise<any>((res) =>
            setTimeout(() => res([]), timeoutMs),
          );
          try {
            return await Promise.race([p, timeout]);
          } catch (e) {
            this.logger.warn('Redis subquery failed or timed out', e);
            return [];
          }
        })()
      : Promise.resolve([]); // 如果没有用户，则不查询 redis

    const mongoPromise = this.mongoService.findActivityByUid(uid);

    const results = await Promise.allSettled([redisPromise, mongoPromise]);

    return {
      mysql: user
        ? { status: 'success', data: user }
        : { status: 'not_found', error: '未找到用户信息' },
      redis: this.formatSettledResult(results[0], '未找到缓存数据'),
      mongo: this.formatSettledResult(results[1], '未找到活动日志'),
    };
  }

  private formatSettledResult(
    result: PromiseSettledResult<any>,
    notFoundMessage: string,
  ) {
    if (result.status === 'fulfilled') {
      const data = result.value;
      if (data && (!Array.isArray(data) || data.length > 0)) {
        return { status: 'success', data };
      }
      return { status: 'not_found', error: notFoundMessage };
    }
    // Downgrade to warn: a subquery failing (e.g., redis timeout) should not be
    // treated as a full ERROR in the unified query endpoint logs.
    this.logger.warn('一个子查询失败', result.reason);
    return { status: 'error', error: result.reason?.message || '查询失败' };
  }

  async updateUser(
    environmentId: string,
    uid: string,
    tenantId: number,
    data: UpdateUserDto,
  ) {
    // This try-catch block will capture raw database errors (like permission issues)
    // and provide a more informative error message to the frontend.
    try {
      const updatePayload: { [key: string]: any } = {};

      // 只处理请求中明确提供的字段，避免因DTO中未提供的字段为undefined而引发问题
      if (data.email !== undefined) {
        // DTO中的 @Transform 已经将 '' 转换为了 null
        updatePayload.email = data.email;
      }

      // 只有在请求中明确提供了 tel 字段时才处理
      if (data.tel !== undefined) {
        if (data.tel === '') {
          // 业务规则：如果电话号码被清空，电话国家代码也必须被清空
          updatePayload.tel = null;
          updatePayload.tel_country_code = null;
        } else {
          updatePayload.tel = data.tel;
          // 如果电话号码被更新，并且请求中也包含了国家代码，则一并更新
          if (data.tel_country_code !== undefined) {
            updatePayload.tel_country_code = data.tel_country_code;
          }
        }
      } else if (data.tel_country_code !== undefined) {
        // 处理只更新国家代码的场景
        updatePayload.tel_country_code = data.tel_country_code;
      }

      if (Object.keys(updatePayload).length === 0) {
        return { message: 'No fields to update.' };
      }

      const result = await this.databaseService.updateUserByUid(
        environmentId,
        uid,
        tenantId,
        updatePayload,
      );
      if (result.affectedRows === 0) {
        throw new NotFoundException(`User with UID ${uid} not found.`);
      }
      return { message: 'User updated successfully.' };
    } catch (error) {
      // 专门处理唯一约束冲突错误
      if (error?.code === 'ER_DUP_ENTRY') {
        if (error.message.includes('tbl_user_tel_tenantId_uindex')) {
          throw new ConflictException(
            '此电话号码已被同一租户下的其他用户使用。',
          );
        }
        // 可以为其他唯一键添加更多判断
        throw new ConflictException(
          '更新失败，因为一个或多个字段的值与现有记录冲突。',
        );
      }
      // If it's an exception we've already handled (like NotFoundException), rethrow it.
      if (error instanceof HttpException) {
        throw error;
      }
      // Otherwise, log the specific DB error and wrap it in a 500 error.
      this.logger.error(
        `Database error while updating user ${uid} in env ${environmentId}:`,
        error,
      );
      throw new InternalServerErrorException(
        `Database error on update: ${error.message}`,
      );
    }
  }

  async deactivateUser(environmentId: string, uid: string, tenantId: number) {
    try {
      const user = await this.databaseService.findUserByUid(
        environmentId,
        uid,
        tenantId,
      );
      if (!user) {
        throw new NotFoundException(`User with UID ${uid} not found.`);
      }

      const updates: { [key: string]: any } = {};

      // Only append -del if it's not already there and the field is a string
      if (typeof user.email === 'string' && !user.email.endsWith('-del')) {
        updates.email = `${user.email}-del`;
      }
      if (typeof user.tel === 'string' && !user.tel.endsWith('-del')) {
        updates.tel = `${user.tel}-del`;
      }

      if (Object.keys(updates).length === 0) {
        return {
          message: 'User already deactivated or has no email/phone to mark.',
        };
      }

      const result = await this.databaseService.updateUserByUid(
        environmentId,
        uid,
        tenantId,
        updates,
      );
      if (result.affectedRows === 0) {
        // FIX: This is a logic bug. It should be a 404, not a 500.
        // This can happen if the user is deleted between the SELECT and UPDATE.
        this.logger.warn(
          `Deactivation for user ${uid} in env ${environmentId} affected 0 rows. The user might have been deleted.`,
        );
        throw new NotFoundException(
          `Failed to deactivate user with UID ${uid}. The record may have been modified or deleted.`,
        );
      }
      return { message: 'User deactivated successfully.' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Database error while deactivating user ${uid} in env ${environmentId}:`,
        error,
      );
      throw new InternalServerErrorException(
        `Database error on deactivation: ${error.message}`,
      );
    }
  }

  async deleteRedisKey(environmentId: string, key: string) {
    try {
      const deletedCount = await this.redisService.deleteKey(
        environmentId,
        key,
      );
      if (deletedCount > 0) {
        return { message: `Key "${key}" deleted successfully.` };
      } else {
        throw new NotFoundException(`Key "${key}" not found.`);
      }
    } catch (error) {
      this.logger.error(
        `Error deleting Redis key "${key}" in env ${environmentId}:`,
        error,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to delete key: ${error.message}`,
      );
    }
  }

  async createRedisKey(
    environmentId: string,
    key: string,
    value: string,
    ttlSeconds?: number,
  ) {
    try {
      const result = await this.redisService.setKey(
        environmentId,
        key,
        value,
        ttlSeconds,
      );
      return { message: `Key "${key}" created successfully.`, result };
    } catch (error) {
      this.logger.error(
        `Error creating Redis key "${key}" in env ${environmentId}:`,
        error,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `Failed to create key: ${error.message}`,
      );
    }
  }

  /**
   * 根据 tbl_user.tenant_user_id 查询对应的 tiger.copy_trade_user_info 记录并返回所有字段
   */
  async getTraderInfoByUserUid(
    environmentId: string,
    uid: string,
    tenantId: number,
  ) {
    try {
      const user = await this.databaseService.findUserByUid(
        environmentId,
        uid,
        tenantId,
      );
      if (!user || !user.id) {
        throw new NotFoundException(`User with UID ${uid} not found.`);
      }
      const userId = String(user.id);
      // 使用 DatabaseService.runQuery 执行参数化查询
      // 在同一租户约束下查询 trader info（如表中有 tenant_id 字段）
      // 如果 copy_trade_user_info 没有 tenant_id 字段，则此处仍可以通过 user_id 唯一定位
      // 优先按租户过滤：使用 user_id AND tenant_id 来保证在多租户场景下的隔离
      const sqlWithTenant =
        'SELECT * FROM `tiger`.`copy_trade_user_info` WHERE `user_id` = ? AND `tenant_id` = ? LIMIT 1';
      try {
        const [rows] = (await this.databaseService.runQuery(
          environmentId,
          sqlWithTenant,
          [userId, tenantId],
        )) as any;
        if (Array.isArray(rows) && rows.length > 0) {
          return rows[0];
        }
        // 如果使用 tenantId 查询未找到，再尝试不带 tenantId 的查询作为兜底（某些旧 schema 可能没有 tenant_id 字段）
      } catch (err: any) {
        // 如果报错提示不存在 tenant_id 字段（例如 Unknown column 或 ER_BAD_FIELD_ERROR），则回退到无 tenant 查询
        const msg = String(err?.message || err);
        if (!/Unknown column|ER_BAD_FIELD_ERROR/i.test(msg)) {
          // 不是字段不存在的问题，记录并抛出
          this.logger.error(
            'Error selecting trader info with tenant filter:',
            err,
          );
          throw err;
        }
        this.logger.warn(
          'copy_trade_user_info does not contain tenant_id; falling back to user_id-only query',
        );
      }

      // 尝试不带 tenantId 的查询（兜底）
      const sql =
        'SELECT * FROM `tiger`.`copy_trade_user_info` WHERE `user_id` = ? LIMIT 1';
      const [rowsNoTenant] = (await this.databaseService.runQuery(
        environmentId,
        sql,
        [userId],
      )) as any;
      if (Array.isArray(rowsNoTenant) && rowsNoTenant.length > 0) {
        return rowsNoTenant[0];
      }
      throw new NotFoundException(
        `Trader info for user id ${userId} not found.`,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Error fetching trader info for uid ${uid} in env ${environmentId}:`,
        error,
      );
      throw new InternalServerErrorException('Failed to fetch trader info');
    }
  }

  async updateTraderNickName(
    environmentId: string,
    uid: string,
    nickName: string,
    tenantId: number,
  ) {
    try {
      const user = await this.databaseService.findUserByUid(
        environmentId,
        uid,
      );
      if (!user || !user.id) {
        throw new NotFoundException(`User with UID ${uid} not found.`);
      }
      const userId = String(user.id);
      const sqlWithTenant =
        'UPDATE `tiger`.`copy_trade_user_info` SET `nick_name` = ? WHERE `user_id` = ? AND `tenant_id` = ?';
      try {
        const [result] = (await this.databaseService.runQuery(
          environmentId,
          sqlWithTenant,
          [nickName, userId, tenantId],
        )) as any;
        if (!result || result.affectedRows === 0) {
          throw new NotFoundException('No trader record updated.');
        }
        return { message: 'Trader nick_name updated successfully.' };
      } catch (err: any) {
        const msg = String(err?.message || err);
        if (!/Unknown column|ER_BAD_FIELD_ERROR/i.test(msg)) {
          this.logger.error(
            'Error updating trader nick with tenant filter:',
            err,
          );
          throw err;
        }
        this.logger.warn(
          'copy_trade_user_info does not contain tenant_id; falling back to user_id-only update',
        );
      }

      // 兜底：不带 tenantId 的 UPDATE
      const sql =
        'UPDATE `tiger`.`copy_trade_user_info` SET `nick_name` = ? WHERE `user_id` = ?';
      const [resultNoTenant] = (await this.databaseService.runQuery(
        environmentId,
        sql,
        [nickName, userId],
      )) as any;
      if (!resultNoTenant || resultNoTenant.affectedRows === 0) {
        throw new NotFoundException('No trader record updated.');
      }
      return { message: 'Trader nick_name updated successfully.' };
      return { message: 'Trader nick_name updated successfully.' };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Error updating trader nick for uid ${uid} in env ${environmentId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to update trader nick_name',
      );
    }
  }
}
