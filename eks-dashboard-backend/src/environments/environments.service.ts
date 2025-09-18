import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { EC2Client } from '@aws-sdk/client-ec2';
import { SSMClient } from '@aws-sdk/client-ssm';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';

interface Platform {
  name: string;
  loadBalancerArn: string;
}

export interface Environment {
  id: string;
  name: string;
  aws_access_key_id: string;
  aws_secret_access_key: string;
  aws_region: string;
  kubeContext: string;
  platforms?: Platform[];
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

  onModuleInit() {
    try {
      const filePath = path.join(
        __dirname,
        'environments',
        'environments.json',
      );
      const fileContent = fs.readFileSync(filePath, 'utf-8');
      this.environments = JSON.parse(fileContent);
      this.logger.log(`Loaded ${this.environments.length} environments.`);
    } catch (error) {
      this.logger.error('Failed to load environments.json', error.stack);
      throw new Error('Could not load environments configuration.');
    }
  }

  getEnvironments() {
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

    const env = this.environments.find((e) => e.id === environmentId);

    if (!env) {
      throw new Error(`Environment with id "${environmentId}" not found.`);
    }

    const credentials = {
      accessKeyId: env.aws_access_key_id,
      secretAccessKey: env.aws_secret_access_key,
    };

    const ec2 = new EC2Client({ region: env.aws_region, credentials });
    const ssm = new SSMClient({ region: env.aws_region, credentials });
    const elbv2 = new ElasticLoadBalancingV2Client({
      region: env.aws_region,
      credentials,
    });

    this.clientsCache.set(environmentId, { ec2, ssm, elbv2 });
    return { ec2, ssm, elbv2 };
  }

  getPlatformsForEnvironment(environmentId: string): Platform[] {
    const env = this.getEnvironmentById(environmentId);
    if (!env) {
      throw new Error(`Environment with id "${environmentId}" not found.`);
    }
    return env.platforms || [];
  }
}
