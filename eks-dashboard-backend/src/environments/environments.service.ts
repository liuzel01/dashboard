import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { EC2Client } from '@aws-sdk/client-ec2';
import { SSMClient } from '@aws-sdk/client-ssm';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { fromIni } from '@aws-sdk/credential-providers';
import { EnvironmentsDbService } from './environments.db.service';

interface Platform {
  name: string;
  loadBalancerArn: string;
}

export interface Environment {
  id: string;
  name: string;
  aws_access_key_id?: string;
  aws_secret_access_key?: string;
  aws_profile?: string;
  aws_region: string;
  kubeContext: string;
  database?: {
    host: string;
    port: number;
    user: string;
    password?: string;
    database: string;
  };
  redis?: {
    host: string;
    port: number;
    password?: string;
    ssl?: boolean;
  };
  jumpServer?: {
    host: string;
    port: number;
    username: string;
    privateKeyPath: string;
  };
  tenants?: { id: number; name: string }[];
  platforms?: Platform[];
  alerts?: {
    lark_webhook_url?: string;
    acceptable_status_codes?: string; // e.g., "200-399" or "200,302,404"
  };
}

@Injectable()
export class EnvironmentsService implements OnModuleInit {
  private readonly logger = new Logger(EnvironmentsService.name);
  private environments: Environment[] = [];
  private clientsCache = new Map<
    string,
    {
      ec2: EC2Client;
      ssm: SSMClient;
      elbv2: ElasticLoadBalancingV2Client;
    }
  >();

  constructor(private readonly envDb: EnvironmentsDbService) {}

  onModuleInit() {
    try {
      // 从项目的根目录加载配置文件，这比依赖 `__dirname` 更加健壮。
      // 这假定 `environments.json` 文件与 `package.json` 在同一目录。
      const filePath = path.resolve(process.cwd(), 'environments.json');
      this.logger.log(`Attempting to load environments from: ${filePath}`);

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      this.environments = JSON.parse(fileContent);
      this.logger.log(
        `Successfully loaded ${this.environments.length} environments.`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to load or parse environments.json. Please ensure the file exists at the project root and is valid JSON.',
        error.stack,
      );
      throw new Error('Could not load environments configuration.');
    }
  }

  async getEnvironments() {
    const dbList = await this.envDb.getEnvironments();
    if (dbList && dbList.length > 0) return dbList;
    // 出于安全考虑，不返回密钥信息给前端
    return this.environments.map(({ id, name }) => ({ id, name }));
  }

  getEnvironmentById(environmentId: string): Environment | undefined {
    return this.environments.find((e) => e.id === environmentId);
  }

  getAwsClients(environmentId: string): {
    ec2: EC2Client;
    ssm: SSMClient;
    elbv2: ElasticLoadBalancingV2Client;
  } {
    if (this.clientsCache.has(environmentId)) {
      return this.clientsCache.get(environmentId)!;
    }

    const env = this.getEnvironmentById(environmentId);

    if (!env) {
      throw new Error(`Environment with id "${environmentId}" not found.`);
    }

    const clientConfig: { region: string; credentials?: any } = {
      region: env.aws_region,
    };

    if (env.aws_access_key_id && env.aws_secret_access_key) {
      this.logger.debug(
        `Using AWS access key for environment "${environmentId}"`,
      );
      clientConfig.credentials = {
        accessKeyId: env.aws_access_key_id,
        secretAccessKey: env.aws_secret_access_key,
      };
    } else if (env.aws_profile) {
      this.logger.debug(
        `Using AWS profile "${env.aws_profile}" for environment "${environmentId}"`,
      );
      clientConfig.credentials = fromIni({ profile: env.aws_profile });
    } else {
      this.logger.debug(
        `Using default AWS credential provider chain for environment "${environmentId}"`,
      );
      // 如果没有指定凭证，SDK 将使用其默认凭证链（环境变量、EC2 实例配置文件等）
    }

    const clients = {
      ec2: new EC2Client(clientConfig),
      ssm: new SSMClient(clientConfig),
      elbv2: new ElasticLoadBalancingV2Client(clientConfig),
    };
    this.clientsCache.set(environmentId, clients);
    return clients;
  }

  getPlatformsForEnvironment(environmentId: string): Platform[] {
    const env = this.getEnvironmentById(environmentId);
    if (!env) {
      throw new Error(`Environment with id "${environmentId}" not found.`);
    }
    return env.platforms || [];
  }

  async getTenantsForEnvironment(environmentId: string): Promise<{ id: number; name: string }[]> {
    const dbTenants = await this.envDb.getTenantsForEnvironment(environmentId);
    if (dbTenants && dbTenants.length > 0) return dbTenants;
    const env = this.getEnvironmentById(environmentId);
    return env?.tenants || [];
  }
}
