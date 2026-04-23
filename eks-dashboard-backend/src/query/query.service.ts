import {
  Injectable,
  InternalServerErrorException,
  HttpException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { KubernetesService } from '../kubernetes/kubernetes.service';
import { QueryGatewayClientService } from './query-gateway-client.service';
import { QueryRequestContext } from './query-request-context';

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
  private readonly superAdminNamespace = 'default';
  private readonly superAdminServiceName = 'kylin-admin-kylin-admin-impl';
  private readonly superAdminServicePort = 80;
  private readonly superAdminUserQueryPath = '/admin/trade/user/1/25';
  private readonly superAdminUidQueryType = 5;
  private readonly superAdminAuthRecordSearchPath = '/admin/authRecord/search';
  private readonly superAdminAuthRecordUpdatePath = '/admin/authRecord/update/auth';

  constructor(
    private readonly mongoService: MongoDataService,
    private readonly kubernetesService: KubernetesService,
    private readonly queryGatewayClient: QueryGatewayClientService,
  ) {}

  // Helper to fetch a single redis key via agent and return TTL and formatted TTL
  async getRedisKey(environmentId: string, key: string) {
    if (!this.queryGatewayClient.isGatewayEnabledForEnvironment(environmentId)) {
      throw new InternalServerErrorException('AGENT_ONLY_MODE_DISABLED');
    }

    try {
      const data = await this.queryGatewayClient.getRedisKey(environmentId, key);
      if (!data) {
        throw new InternalServerErrorException('AGENT_UNREACHABLE');
      }
      if (data?.status === 'not_found') {
        throw new NotFoundException(data?.error || `Key "${key}" not found.`);
      }
      if (data?.status === 'success') {
        const ttl = Number(data?.data?.ttlSeconds ?? -2);
        return {
          key: data?.data?.key,
          value: data?.data?.value,
          ttlSeconds: ttl,
          ttlFormatted: this.formatTtl(ttl),
        };
      }
      return data;
    } catch (e) {
      this.logger.warn(
        `Warning fetching redis key via agent ${key} in env ${environmentId}: ${String(e)}`,
      );
      if (e instanceof HttpException) throw e;
      throw new InternalServerErrorException('Failed to fetch key via agent');
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

  private normalizeSuperAdminUserRecord(
    raw: Record<string, unknown>,
    uid: string,
    tenantId?: number,
  ): Record<string, unknown> {
    const userId = raw.userId ?? raw.id ?? null;
    return {
      ...raw,
      id: userId,
      tenant_user_id: raw.tenantUserId ?? raw.tenant_user_id ?? uid,
      tenant_id: raw.tenantId ?? raw.tenant_id ?? tenantId ?? null,
      tel_country_code: raw.telCountryCode ?? raw.tel_country_code ?? null,
      email: raw.email ?? null,
      tel: raw.tel ?? null,
    };
  }

  private extractSuperAdminUserList(body: any): Record<string, unknown>[] {
    const listCandidates = [
      body?.data?.list,
      body?.list,
      body?.data?.records,
      body?.records,
      body?.data?.rows,
      body?.rows,
      body?.data?.items,
      body?.items,
    ];
    const list = listCandidates.find((item) => Array.isArray(item));
    if (!Array.isArray(list)) return [];
    return list.filter(
      (item): item is Record<string, unknown> =>
        item && typeof item === 'object',
    );
  }

  private parseSuperAdminTotalCount(body: any): number | null {
    const candidates = [
      body?.data?.totalCount,
      body?.totalCount,
      body?.data?.total,
      body?.total,
      body?.data?.count,
      body?.count,
    ];
    const value = candidates.find((item) => Number.isFinite(Number(item)));
    if (value === undefined || value === null) return null;
    return Number(value);
  }

  private summarizeSuperAdminFirstRecord(records: Record<string, unknown>[]) {
    const first = records[0];
    if (!first) {
      return {
        tenantName: null,
        tenantId: null,
        tenantUserId: null,
        userId: null,
      };
    }
    return {
      tenantName: String(first.tenantName ?? first.tenant_name ?? ''),
      tenantId: first.tenantId ?? first.tenant_id ?? null,
      tenantUserId: first.tenantUserId ?? first.tenant_user_id ?? null,
      userId: first.userId ?? first.id ?? null,
    };
  }

  private async querySuperAdminUsers(
    environmentId: string,
    uid: string,
    tenantId?: number,
  ): Promise<{ response: { statusCode: number; body: any }; records: Record<string, unknown>[] }> {
    const query: Record<string, unknown> = {
      queryType: this.superAdminUidQueryType,
      queryValue: uid,
      realName: '',
      userStatus: '',
      userType: '',
    };
    if (tenantId !== undefined && tenantId !== null) {
      query.tenantId = tenantId;
    }

    const response = await this.kubernetesService.requestServiceProxy(
      environmentId,
      {
        namespace: this.superAdminNamespace,
        serviceName: this.superAdminServiceName,
        port: this.superAdminServicePort,
        method: 'GET',
        path: this.superAdminUserQueryPath,
        query,
        timeoutMs: 15000,
      },
    );
    const records = this.extractSuperAdminUserList(response?.body);
    const totalCount = this.parseSuperAdminTotalCount(response?.body);
    const first = this.summarizeSuperAdminFirstRecord(records);
    this.logger.log(
      `[QueryCenter] super-admin user query env=${environmentId} uid=${uid} tenantId=${tenantId ?? 'none'} http=${response?.statusCode ?? 'n/a'} code=${response?.body?.code ?? 'n/a'} totalCount=${totalCount ?? 'n/a'} listLen=${records.length} firstTenantName=${first.tenantName ?? ''} firstTenantId=${first.tenantId ?? ''} firstTenantUserId=${first.tenantUserId ?? ''} firstUserId=${first.userId ?? ''}`,
    );
    return { response, records };
  }

  private async findUserByUidViaSuperAdmin(
    environmentId: string,
    uid: string,
    tenantId?: number,
  ): Promise<Record<string, unknown> | null> {
    const { response, records } = await this.querySuperAdminUsers(
      environmentId,
      uid,
      tenantId,
    );
    const body = response?.body;
    if (
      body &&
      typeof body === 'object' &&
      'code' in body &&
      Number((body as { code?: number }).code) !== 0
    ) {
      const msg = (body as { msg?: string }).msg || 'super-admin query failed';
      throw new Error(msg);
    }
    if (records.length === 0) {
      // 诊断日志：当按 tenantId 查询为空时，对照一次不带 tenantId 的结果，
      // 用于快速判断“租户过滤”是否为根因，不改变现有业务返回。
      if (tenantId !== undefined && tenantId !== null) {
        try {
          const fallback = await this.querySuperAdminUsers(environmentId, uid);
          if (fallback.records.length > 0) {
            const first = this.summarizeSuperAdminFirstRecord(fallback.records);
            this.logger.warn(
              `[QueryCenter] tenant-filter mismatch suspected env=${environmentId} uid=${uid} requestedTenantId=${tenantId} fallbackFirstTenantName=${first.tenantName ?? ''} fallbackFirstTenantId=${first.tenantId ?? ''} fallbackFirstTenantUserId=${first.tenantUserId ?? ''} fallbackFirstUserId=${first.userId ?? ''}`,
            );
          } else {
            this.logger.warn(
              `[QueryCenter] user not found in super-admin even without tenantId env=${environmentId} uid=${uid}`,
            );
          }
        } catch (diagError) {
          this.logger.warn(
            `[QueryCenter] fallback diagnostic query failed env=${environmentId} uid=${uid}: ${String(diagError)}`,
          );
        }
      }
      return null;
    }
    const matched =
      records.find(
        (item) =>
          String(item.tenantUserId ?? item.tenant_user_id ?? '') === uid,
      ) || records[0];
    return this.normalizeSuperAdminUserRecord(matched, uid, tenantId);
  }

  async aggregate(
    environmentId: string,
    identifier: string,
    type: 'UID' | 'EMAIL' | 'PHONE',
    tenantId?: number,
    context?: QueryRequestContext,
  ) {
    if (!this.queryGatewayClient.isGatewayEnabledForEnvironment(environmentId)) {
      return {
        mysql: { status: 'error', error: 'AGENT_ONLY_MODE_DISABLED' },
        redis: { status: 'not_found', error: '网关未启用，未执行缓存查询' },
        mongo: { status: 'not_found', error: '网关未启用，未执行活动日志查询' },
      };
    }

    try {
      const gatewayData = await this.queryGatewayClient.aggregate(
        environmentId,
        identifier,
        type,
        tenantId,
        context,
      );
      if (gatewayData) return gatewayData;

      return {
        mysql: { status: 'error', error: 'AGENT_UNREACHABLE' },
        redis: { status: 'not_found', error: '网关不可达，未执行缓存查询' },
        mongo: { status: 'not_found', error: '网关不可达，未执行活动日志查询' },
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[QueryGateway] aggregate failed env=${environmentId} requestId=${context?.requestId || 'none'} err=${errMsg}`,
      );
      return {
        mysql: { status: 'error', error: 'AGENT_UNREACHABLE' },
        redis: { status: 'not_found', error: '网关不可达，未执行缓存查询' },
        mongo: { status: 'not_found', error: '网关不可达，未执行活动日志查询' },
      };
    }

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
    if (!this.queryGatewayClient.isGatewayEnabledForEnvironment(environmentId)) {
      throw new InternalServerErrorException('AGENT_ONLY_MODE_DISABLED');
    }

    try {
      const result = await this.queryGatewayClient.updateUser(
        environmentId,
        uid,
        tenantId,
        {
          email: data.email,
          tel: data.tel,
          tel_country_code: data.tel_country_code,
        },
      );
      if (!result) {
        throw new InternalServerErrorException('AGENT_UNREACHABLE');
      }
      if (result?.status === 'not_found') {
        throw new NotFoundException(result?.error || `User with UID ${uid} not found.`);
      }
      if (result?.status === 'conflict') {
        throw new ConflictException(
          result?.error || '更新失败，因为一个或多个字段的值与现有记录冲突。',
        );
      }
      if (result?.status === 'noop') {
        return { message: result?.message || 'No fields to update.' };
      }
      return { message: result?.message || 'User updated successfully.' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Error updating user via agent ${uid} in env ${environmentId}:`,
        error,
      );
      throw new InternalServerErrorException('Failed to update user via agent');
    }
  }

  async deactivateUser(environmentId: string, uid: string, tenantId: number) {
    if (!this.queryGatewayClient.isGatewayEnabledForEnvironment(environmentId)) {
      throw new InternalServerErrorException('AGENT_ONLY_MODE_DISABLED');
    }

    try {
      const result = await this.queryGatewayClient.deactivateUser(
        environmentId,
        uid,
        tenantId,
      );
      if (!result) {
        throw new InternalServerErrorException('AGENT_UNREACHABLE');
      }
      if (result?.status === 'not_found') {
        throw new NotFoundException(result?.error || `User with UID ${uid} not found.`);
      }
      if (result?.status === 'noop') {
        return {
          message:
            result?.message || 'User already deactivated or has no email/phone to mark.',
        };
      }
      return { message: result?.message || 'User deactivated successfully.' };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.error(
        `Error deactivating user via agent ${uid} in env ${environmentId}:`,
        error,
      );
      throw new InternalServerErrorException('Failed to deactivate user via agent');
    }
  }

  async deleteRedisKey(environmentId: string, key: string) {
    if (!this.queryGatewayClient.isGatewayEnabledForEnvironment(environmentId)) {
      throw new InternalServerErrorException('AGENT_ONLY_MODE_DISABLED');
    }

    try {
      const data = await this.queryGatewayClient.deleteRedisKey(environmentId, key);
      if (!data) {
        throw new InternalServerErrorException('AGENT_UNREACHABLE');
      }
      if (data?.status === 'not_found') {
        throw new NotFoundException(data?.error || `Key "${key}" not found.`);
      }
      return data;
    } catch (error) {
      this.logger.error(
        `Error deleting Redis key via agent "${key}" in env ${environmentId}:`,
        error,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete key via agent');
    }
  }

  async createRedisKey(
    environmentId: string,
    key: string,
    value: string,
    ttlSeconds?: number,
  ) {
    if (!this.queryGatewayClient.isGatewayEnabledForEnvironment(environmentId)) {
      throw new InternalServerErrorException('AGENT_ONLY_MODE_DISABLED');
    }

    try {
      const data = await this.queryGatewayClient.createRedisKey(
        environmentId,
        key,
        value,
        ttlSeconds,
      );
      if (!data) {
        throw new InternalServerErrorException('AGENT_UNREACHABLE');
      }
      return data;
    } catch (error) {
      this.logger.error(
        `Error creating Redis key via agent "${key}" in env ${environmentId}:`,
        error,
      );
      if (error instanceof HttpException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to create key via agent');
    }
  }

  /**
   * 通过 Agent 查询交易员信息
   */
  async getOtcMerchantInfoByUserUid(
    environmentId: string,
    uid: string,
    tenantId: number,
  ) {
    if (!this.queryGatewayClient.isGatewayEnabledForEnvironment(environmentId)) {
      throw new InternalServerErrorException('AGENT_ONLY_MODE_DISABLED');
    }

    try {
      const data = await this.queryGatewayClient.getOtcMerchantInfo(
        environmentId,
        uid,
        tenantId,
      );
      if (!data) {
        throw new InternalServerErrorException('AGENT_UNREACHABLE');
      }
      if (data?.status === 'not_found') {
        throw new NotFoundException(data?.error || 'OTC merchant info not found');
      }
      if (data?.status === 'success') {
        return data.data;
      }
      return data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Error fetching OTC merchant info via agent for uid ${uid} in env ${environmentId}:`,
        error,
      );
      throw new InternalServerErrorException('Failed to fetch OTC merchant info');
    }
  }

  async updateOtcMerchantNameByUserUid(
    environmentId: string,
    uid: string,
    name: string,
    tenantId: number,
  ) {
    if (!this.queryGatewayClient.isGatewayEnabledForEnvironment(environmentId)) {
      throw new InternalServerErrorException('AGENT_ONLY_MODE_DISABLED');
    }

    try {
      const data = await this.queryGatewayClient.updateOtcMerchantName(
        environmentId,
        uid,
        tenantId,
        name,
      );
      if (!data) {
        throw new InternalServerErrorException('AGENT_UNREACHABLE');
      }
      if (data?.status === 'not_found') {
        throw new NotFoundException(data?.error || 'No OTC merchant record updated.');
      }
      return data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Error updating OTC merchant name via agent for uid ${uid} in env ${environmentId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to update OTC merchant name',
      );
    }
  }

  async getAuthRecordByUserUid(
    environmentId: string,
    uid: string,
    tenantId: number,
  ) {
    const user = await this.findUserByUidViaSuperAdmin(environmentId, uid, tenantId);
    if (!user) {
      throw new NotFoundException(`User with UID ${uid} not found.`);
    }
    const userId = Number(user.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new InternalServerErrorException('Invalid user id resolved from super-admin user record');
    }

    const response = await this.kubernetesService.requestServiceProxy(environmentId, {
      namespace: this.superAdminNamespace,
      serviceName: this.superAdminServiceName,
      port: this.superAdminServicePort,
      method: 'POST',
      path: this.superAdminAuthRecordSearchPath,
      body: {
        page: 1,
        size: 20,
        userId,
        status: 1,
      },
      timeoutMs: 15000,
    });

    const body = response?.body;
    if (
      body &&
      typeof body === 'object' &&
      'code' in body &&
      Number((body as { code?: number }).code) !== 0
    ) {
      const msg = (body as { msg?: string }).msg || 'super-admin authRecord search failed';
      throw new InternalServerErrorException(msg);
    }

    const list = Array.isArray((body as any)?.data?.list) ? (body as any).data.list : [];
    const matched =
      list.find(
        (item: any) =>
          Number(item?.userId) === userId &&
          Number(item?.status) === 1 &&
          (item?.tenantId === undefined || Number(item?.tenantId) === Number(tenantId)),
      ) ||
      list.find(
        (item: any) => Number(item?.userId) === userId && Number(item?.status) === 1,
      ) ||
      null;
    if (!matched) {
      throw new NotFoundException(`Auth record for userId ${userId} not found.`);
    }
    return matched;
  }

  async updateAuthRecordByUserUid(
    environmentId: string,
    uid: string,
    tenantId: number,
    realName?: string,
    cardNo?: string,
  ) {
    const normalizedRealName = realName ?? '';
    const normalizedCardNo = cardNo ?? '';
    if (normalizedRealName === '' && normalizedCardNo === '') {
      throw new HttpException(
        'realName and cardNo cannot both be empty',
        400,
      );
    }

    const user = await this.findUserByUidViaSuperAdmin(environmentId, uid, tenantId);
    if (!user) {
      throw new NotFoundException(`User with UID ${uid} not found.`);
    }
    const userId = Number(user.id);
    if (!Number.isFinite(userId) || userId <= 0) {
      throw new InternalServerErrorException('Invalid user id resolved from super-admin user record');
    }

    const response = await this.kubernetesService.requestServiceProxy(environmentId, {
      namespace: this.superAdminNamespace,
      serviceName: this.superAdminServiceName,
      port: this.superAdminServicePort,
      method: 'POST',
      path: this.superAdminAuthRecordUpdatePath,
      body: {
        userId,
        realName: normalizedRealName,
        cardNo: normalizedCardNo,
      },
      timeoutMs: 15000,
    });

    const body = response?.body;
    if (
      body &&
      typeof body === 'object' &&
      'code' in body &&
      Number((body as { code?: number }).code) !== 0
    ) {
      const msg = (body as { msg?: string }).msg || 'super-admin authRecord update failed';
      throw new InternalServerErrorException(msg);
    }

    return { message: 'Auth record updated successfully.' };
  }

  async getTraderInfoByUserUid(
    environmentId: string,
    uid: string,
    tenantId: number,
  ) {
    if (!this.queryGatewayClient.isGatewayEnabledForEnvironment(environmentId)) {
      throw new InternalServerErrorException('AGENT_ONLY_MODE_DISABLED');
    }

    try {
      const data = await this.queryGatewayClient.getTraderInfo(
        environmentId,
        uid,
        tenantId,
      );
      if (!data) {
        throw new InternalServerErrorException('AGENT_UNREACHABLE');
      }
      if (data?.status === 'not_found') {
        throw new NotFoundException(data?.error || 'Trader info not found');
      }
      if (data?.status === 'success') {
        return data.data;
      }
      return data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Error fetching trader info via agent for uid ${uid} in env ${environmentId}:`,
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
    if (!this.queryGatewayClient.isGatewayEnabledForEnvironment(environmentId)) {
      throw new InternalServerErrorException('AGENT_ONLY_MODE_DISABLED');
    }

    try {
      const data = await this.queryGatewayClient.updateTraderNickName(
        environmentId,
        uid,
        nickName,
        tenantId,
      );
      if (!data) {
        throw new InternalServerErrorException('AGENT_UNREACHABLE');
      }
      if (data?.status === 'not_found') {
        throw new NotFoundException(data?.error || 'No trader record updated.');
      }
      return data;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(
        `Error updating trader nick via agent for uid ${uid} in env ${environmentId}:`,
        error,
      );
      throw new InternalServerErrorException(
        'Failed to update trader nick_name',
      );
    }
  }
}
