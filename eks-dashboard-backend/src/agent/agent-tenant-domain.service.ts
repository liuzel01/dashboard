import { BadRequestException, ConflictException, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import * as mysql from 'mysql2/promise';
import { AgentConnectionService } from './agent-connection.service';

@Injectable()
export class AgentTenantDomainService implements OnModuleDestroy {
  private readonly logger = new Logger(AgentTenantDomainService.name);
  private mysqlPool: mysql.Pool | null = null;
  private mysqlKey = '';

  constructor(private readonly connectionService: AgentConnectionService) {}

  async onModuleDestroy() {
    if (this.mysqlPool) {
      await this.mysqlPool.end();
      this.mysqlPool = null;
    }
  }

  async applyTenantDomain(input: {
    environmentId: string;
    tenantId: number;
    domain: string;
    requestId?: string;
    userId?: string;
    username?: string;
  }) {
    const environmentId = String(input.environmentId || '').trim();
    const tenantId = Number(input.tenantId);
    const domain = String(input.domain || '').trim().toLowerCase();

    if (!Number.isInteger(tenantId) || tenantId <= 0) {
      throw new BadRequestException('tenantId must be a positive integer');
    }
    if (!domain) throw new BadRequestException('domain is required');

    this.logger.log(
      `[AgentTenantDomain] apply start env=${environmentId || 'none'} requestId=${input.requestId || 'none'} userId=${input.userId || 'none'} username=${input.username || 'none'} tenantId=${tenantId} domain=${domain}`,
    );

    const pool = await this.getMysqlPool(environmentId);
    const [rows] = (await pool.execute(
      'SELECT `id`, `tenant_id` AS tenantId, `domian` AS domain, `status`, `created_time` AS createdTime FROM `tenant`.`tenant_domain` WHERE `domian` = ? ORDER BY `id` ASC',
      [domain],
    )) as any;
    const existing = Array.isArray(rows) ? rows : [];

    if (existing.length === 1 && Number(existing[0].tenantId) === tenantId) {
      this.logger.log(
        `[AgentTenantDomain] unchanged env=${environmentId} requestId=${input.requestId || 'none'} id=${existing[0].id} tenantId=${tenantId} domain=${domain}`,
      );
      return {
        success: true,
        data: {
          action: 'unchanged',
          id: Number(existing[0].id),
          tenantId,
          domain,
          status: Number(existing[0].status),
          createdAt: existing[0].createdTime,
        },
      };
    }

    if (existing.length > 0) {
      this.logger.warn(
        `[AgentTenantDomain] conflict env=${environmentId} requestId=${input.requestId || 'none'} tenantId=${tenantId} domain=${domain} conflicts=${existing.length}`,
      );
      throw new ConflictException({
        message: 'domain already exists for another tenant or duplicated records found',
        conflictType: existing.length > 1 ? 'duplicated_domain' : 'domain_owner',
        conflicts: existing.map((item: any) => ({
          id: Number(item.id),
          tenantId: Number(item.tenantId),
          domain: String(item.domain),
          status: Number(item.status),
          createdAt: item.createdTime,
        })),
      });
    }

    const [result] = (await pool.execute(
      'INSERT INTO `tenant`.`tenant_domain` (`tenant_id`, `domian`, `status`, `created_time`) VALUES (?, ?, 1, NOW())',
      [tenantId, domain],
    )) as any;
    const id = Number(result?.insertId || 0);
    this.logger.log(
      `[AgentTenantDomain] created env=${environmentId} requestId=${input.requestId || 'none'} id=${id} tenantId=${tenantId} domain=${domain}`,
    );

    return {
      success: true,
      data: {
        action: 'created',
        id,
        tenantId,
        domain,
        status: 1,
        createdAt: new Date().toISOString(),
      },
    };
  }

  private async getMysqlPool(environmentId: string) {
    const resolved = await this.connectionService.getResolvedConnectionConfig(environmentId);
    const key = JSON.stringify({
      url: resolved.mysql.url,
      username: resolved.mysql.username,
      password: resolved.mysql.password,
    });
    if (this.mysqlPool && this.mysqlKey === key) return this.mysqlPool;
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
      connectionLimit: 5,
      queueLimit: 0,
    });
    this.mysqlKey = key;
    return this.mysqlPool;
  }

  private parseJdbcUrl(url: string) {
    const match = /^jdbc:mysql:\/\/([^/:?#]+)(?::(\d+))?\/([^?]+)(?:\?(.*))?$/i.exec(url || '');
    if (!match) {
      throw new BadRequestException('Invalid MySQL JDBC url.');
    }
    return {
      host: match[1],
      port: match[2] ? Number(match[2]) : 3306,
      database: decodeURIComponent(match[3]),
    };
  }
}
