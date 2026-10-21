import { Injectable } from '@nestjs/common';
import { ACMClient } from '@aws-sdk/client-acm';
import { CloudTrailClient } from '@aws-sdk/client-cloudtrail';
import { EC2Client } from '@aws-sdk/client-ec2';
import { EKSClient } from '@aws-sdk/client-eks';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { IAMClient } from '@aws-sdk/client-iam';
import { RDSClient } from '@aws-sdk/client-rds';
import { Route53Client } from '@aws-sdk/client-route-53';
import { S3Client } from '@aws-sdk/client-s3';
import { STSClient } from '@aws-sdk/client-sts';
import {
  fromIni,
  fromInstanceMetadata,
  fromTemporaryCredentials,
} from '@aws-sdk/credential-providers';
import type {
  AwsCloudAccount,
  AwsGovernanceClients,
} from './aws-governance.types';

@Injectable()
export class AwsCredentialProviderFactory {
  createPlatformAuditClients(
    account: AwsCloudAccount,
    region: string,
  ): AwsGovernanceClients {
    const production =
      String(process.env.NODE_ENV || '').toLowerCase() === 'production';
    const sourceProfile = String(
      process.env.AWS_GOVERNANCE_SOURCE_PROFILE ||
        process.env.AWS_PROFILE ||
        '',
    ).trim();
    if (!production && !sourceProfile) {
      throw new Error(
        '本地 AWS Inventory 未配置凭据来源。请设置 AWS_GOVERNANCE_SOURCE_PROFILE（例如 megadev）后重启后端服务。',
      );
    }
    const masterCredentials = production
      ? fromInstanceMetadata({ maxRetries: 2, timeout: 1_000 })
      : fromIni({ profile: sourceProfile });
    const roleSessionName =
      `dashboard-audit-${account.environmentId}-${Date.now()}`
        .replace(/[^A-Za-z0-9_=,.@-]/g, '-')
        .slice(0, 64);
    const credentials = fromTemporaryCredentials({
      masterCredentials,
      clientConfig: { region },
      params: {
        RoleArn: account.platformAuditRoleArn,
        RoleSessionName: roleSessionName,
        DurationSeconds: 900,
      },
    });
    const config = { region, credentials };
    return {
      credentials,
      sts: new STSClient(config),
      ec2: new EC2Client(config),
      elbv2: new ElasticLoadBalancingV2Client(config),
      eks: new EKSClient(config),
      rds: new RDSClient(config),
      s3: new S3Client(config),
      route53: new Route53Client(config),
      acm: new ACMClient(config),
      iam: new IAMClient(config),
      cloudTrail: new CloudTrailClient(config),
    };
  }
}
