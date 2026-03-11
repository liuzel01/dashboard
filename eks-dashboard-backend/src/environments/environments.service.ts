import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { EC2Client } from '@aws-sdk/client-ec2';
import { SSMClient } from '@aws-sdk/client-ssm';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { S3Client } from '@aws-sdk/client-s3';
import { fromIni } from '@aws-sdk/credential-providers';
import { EnvironmentsDbService } from './environments.db.service';
import type { Environment, Platform } from './environment.types';

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
      s3: S3Client;
    }
  >();

  constructor(private readonly envDb: EnvironmentsDbService) {}

  async onModuleInit() {
    const dbEnvs = await this.envDb.getEnvironmentConfigs();
    if (dbEnvs.length > 0) {
      this.environments = dbEnvs;
      this.logger.log(`Loaded ${dbEnvs.length} environments from DB.`);
      return;
    }

    try {
      // 从项目的根目录加载配置文件，这比依赖 `__dirname` 更加健壮。
      // 这假定 `environments.json` 文件与 `package.json` 在同一目录。
      const filePath = path.resolve(process.cwd(), 'environments.json');
      this.logger.log(`Attempting to load environments from: ${filePath}`);

      const fileContent = fs.readFileSync(filePath, 'utf-8');
      this.environments = JSON.parse(fileContent);
      this.logger.log(
        `Successfully loaded ${this.environments.length} environments from file.`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to load environments from DB and could not load environments.json. Please ensure DB is available or the file exists at the project root.',
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

  async getEnvironmentConfigs() {
    const dbEnvs = await this.envDb.getEnvironmentConfigs();
    if (dbEnvs.length > 0) return dbEnvs;
    return this.environments;
  }

  async getEnvironmentConfigById(environmentId: string): Promise<Environment | undefined> {
    const dbEnv = await this.envDb.getEnvironmentConfigById(environmentId);
    if (dbEnv) return dbEnv;
    return this.getEnvironmentById(environmentId);
  }

  async upsertEnvironmentConfig(environment: Environment) {
    const dbReady = await this.envDb.isConfigAvailable();
    if (!dbReady) {
      throw new Error('environments_config table is not available in DB.');
    }
    await this.envDb.upsertEnvironmentConfig(environment);
    await this.envDb.upsertEnvironmentMeta(environment.id, environment.name);
    await this.reloadFromDb();
    this.clientsCache.delete(environment.id);
  }

  private async reloadFromDb() {
    const dbEnvs = await this.envDb.getEnvironmentConfigs();
    if (dbEnvs.length > 0) {
      this.environments = dbEnvs;
      this.logger.log(`Reloaded ${dbEnvs.length} environments from DB.`);
    }
  }

  getAwsClients(environmentId: string): {
    ec2: EC2Client;
    ssm: SSMClient;
    elbv2: ElasticLoadBalancingV2Client;
    s3: S3Client;
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
      s3: new S3Client(clientConfig),
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
