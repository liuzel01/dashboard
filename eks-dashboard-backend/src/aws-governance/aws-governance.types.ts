import type { AwsCredentialIdentityProvider } from '@smithy/types';
import type { EC2Client } from '@aws-sdk/client-ec2';
import type { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import type { EKSClient } from '@aws-sdk/client-eks';
import type { RDSClient } from '@aws-sdk/client-rds';
import type { S3Client } from '@aws-sdk/client-s3';
import type { Route53Client } from '@aws-sdk/client-route-53';
import type { ACMClient } from '@aws-sdk/client-acm';
import type { IAMClient } from '@aws-sdk/client-iam';
import type { CloudTrailClient } from '@aws-sdk/client-cloudtrail';
import type { STSClient } from '@aws-sdk/client-sts';

export type AwsCloudAccount = {
  id: number;
  environmentId: string;
  accountId: string;
  displayName: string;
  partition: string;
  defaultRegions: string[];
  platformAuditRoleArn: string;
  enabled: boolean;
};

export type AwsGovernanceActor = {
  userId: number;
  username: string;
  displayName: string;
  roleIds: number[];
  permissions: string[];
};

export type AwsInventoryResource = {
  region: string;
  resourceType: string;
  resourceId: string;
  resourceArn?: string | null;
  displayName?: string | null;
  status?: string | null;
  normalized: Record<string, unknown>;
  normalizedHash: string;
};

export type AwsCollectorError = {
  collector: string;
  region: string;
  code: string;
  message: string;
};

export type AwsInventoryCollection = {
  resources: AwsInventoryResource[];
  errors: AwsCollectorError[];
  completedCollectors: string[];
};

export type AwsGovernanceClients = {
  credentials: AwsCredentialIdentityProvider;
  sts: STSClient;
  ec2: EC2Client;
  elbv2: ElasticLoadBalancingV2Client;
  eks: EKSClient;
  rds: RDSClient;
  s3: S3Client;
  route53: Route53Client;
  acm: ACMClient;
  iam: IAMClient;
  cloudTrail: CloudTrailClient;
};
