import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

// --- 模拟的数据服务，请替换为你自己的真实服务 ---
@Injectable()
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
}

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
    private readonly redisService: RedisDataService,
    private readonly mongoService: MongoDataService,
  ) {}

  async aggregate(identifier: string, type: string) {
    this.logger.log(`Aggregating data for ${type}: ${identifier}`);
    const uid = identifier; // 简化处理，真实应用中可能需要转换

    const results = await Promise.allSettled([
      this.databaseService.findUserByUid(uid),
      this.redisService.findKeysByUid(uid),
      this.mongoService.findActivityByUid(uid),
    ]);

    const [mysqlResult, redisResult, mongoResult] = results;

    return {
      mysql: this.formatSettledResult(mysqlResult, '未找到用户信息'),
      redis: this.formatSettledResult(redisResult, '未找到缓存数据'),
      mongo: this.formatSettledResult(mongoResult, '未找到活动日志'),
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
    this.logger.error('一个子查询失败', result.reason);
    return { status: 'error', error: result.reason.message || '查询失败' };
  }

  async updateUser(
    uid: string,
    data: {
      email?: string | null;
      tel?: string | null;
      tel_country_code?: string | null;
    },
  ) {
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
      uid,
      updatePayload,
    );
    if (result.affectedRows === 0) {
      throw new NotFoundException(`User with UID ${uid} not found.`);
    }
    return { message: 'User updated successfully.' };
  }

  async deactivateUser(uid: string) {
    const user = await this.databaseService.findUserByUid(uid);
    if (!user) {
      throw new NotFoundException(`User with UID ${uid} not found.`);
    }

    const updates: { [key: string]: any } = {};

    // Only append -del if it's not already there
    if (user.email && !user.email.endsWith('-del')) {
      updates.email = `${user.email}-del`;
    }
    if (user.tel && !user.tel.endsWith('-del')) {
      updates.tel = `${user.tel}-del`;
    }

    if (Object.keys(updates).length === 0) {
      return {
        message: 'User already deactivated or has no email/phone to mark.',
      };
    }

    const result = await this.databaseService.updateUserByUid(uid, updates);
    if (result.affectedRows === 0) {
      throw new InternalServerErrorException('Failed to deactivate user.');
    }
    return { message: 'User deactivated successfully.' };
  }
}
