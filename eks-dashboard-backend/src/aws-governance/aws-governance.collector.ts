import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  DescribeCertificateCommand,
  ListCertificatesCommand,
} from '@aws-sdk/client-acm';
import {
  DescribeTrailsCommand,
  GetEventSelectorsCommand,
  GetTrailStatusCommand,
} from '@aws-sdk/client-cloudtrail';
import {
  DescribeInstancesCommand,
  DescribeSecurityGroupsCommand,
  DescribeVolumesCommand,
} from '@aws-sdk/client-ec2';
import {
  DescribeClusterCommand,
  ListClustersCommand,
} from '@aws-sdk/client-eks';
import {
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { ListRolesCommand } from '@aws-sdk/client-iam';
import { DescribeDBInstancesCommand } from '@aws-sdk/client-rds';
import { ListHostedZonesCommand } from '@aws-sdk/client-route-53';
import {
  GetBucketLocationCommand,
  ListBucketsCommand,
} from '@aws-sdk/client-s3';
import { GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { AwsCredentialProviderFactory } from './aws-credential-provider.factory';
import type {
  AwsCloudAccount,
  AwsCollectorError,
  AwsGovernanceClients,
  AwsInventoryCollection,
  AwsInventoryResource,
} from './aws-governance.types';

const TAG_ALLOWLIST = new Set([
  'name',
  'environment',
  'project',
  'owner',
  'service',
  'application',
]);

@Injectable()
export class AwsGovernanceCollector {
  constructor(private readonly credentials: AwsCredentialProviderFactory) {}

  async collect(
    account: AwsCloudAccount,
    regions: string[],
  ): Promise<AwsInventoryCollection> {
    const resources: AwsInventoryResource[] = [];
    const errors: AwsCollectorError[] = [];
    const completedCollectors: string[] = [];
    const primaryRegion = regions[0];
    const primaryClients = this.credentials.createPlatformAuditClients(
      account,
      primaryRegion,
    );

    await this.runCollector(
      'identity',
      'global',
      errors,
      completedCollectors,
      async () => {
        const identity = await primaryClients.sts.send(
          new GetCallerIdentityCommand({}),
        );
        if (identity.Account !== account.accountId) {
          throw new Error(
            `Assumed account mismatch: expected ${account.accountId}, got ${identity.Account || 'unknown'}`,
          );
        }
      },
    );

    for (const region of regions) {
      const clients =
        region === primaryRegion
          ? primaryClients
          : this.credentials.createPlatformAuditClients(account, region);
      await this.collectRegional(
        clients,
        region,
        resources,
        errors,
        completedCollectors,
      );
    }
    await this.collectGlobal(
      primaryClients,
      resources,
      errors,
      completedCollectors,
    );
    return { resources, errors, completedCollectors };
  }

  private async collectRegional(
    clients: AwsGovernanceClients,
    region: string,
    resources: AwsInventoryResource[],
    errors: AwsCollectorError[],
    completed: string[],
  ) {
    await this.runCollector(
      'ec2-instances',
      region,
      errors,
      completed,
      async () => {
        let nextToken: string | undefined;
        do {
          const response = await clients.ec2.send(
            new DescribeInstancesCommand({
              NextToken: nextToken,
              MaxResults: 1000,
            }),
          );
          for (const reservation of response.Reservations || []) {
            for (const instance of reservation.Instances || []) {
              if (!instance.InstanceId) continue;
              resources.push(
                this.resource(
                  region,
                  'ec2:instance',
                  instance.InstanceId,
                  instance.InstanceId,
                  this.nameFromTags(instance.Tags),
                  instance.State?.Name,
                  {
                    instanceId: instance.InstanceId,
                    instanceType: instance.InstanceType,
                    state: instance.State?.Name,
                    launchTime: instance.LaunchTime?.toISOString(),
                    availabilityZone: instance.Placement?.AvailabilityZone,
                    vpcId: instance.VpcId,
                    subnetId: instance.SubnetId,
                    privateIpAddress: instance.PrivateIpAddress,
                    securityGroupIds: (instance.SecurityGroups || [])
                      .map((item) => item.GroupId)
                      .filter(Boolean)
                      .sort(),
                    tags: this.tags(instance.Tags),
                  },
                ),
              );
            }
          }
          nextToken = response.NextToken;
        } while (nextToken);
      },
    );

    await this.runCollector(
      'ebs-volumes',
      region,
      errors,
      completed,
      async () => {
        let nextToken: string | undefined;
        do {
          const response = await clients.ec2.send(
            new DescribeVolumesCommand({
              NextToken: nextToken,
              MaxResults: 500,
            }),
          );
          for (const volume of response.Volumes || []) {
            if (!volume.VolumeId) continue;
            resources.push(
              this.resource(
                region,
                'ec2:volume',
                volume.VolumeId,
                volume.VolumeId,
                this.nameFromTags(volume.Tags),
                volume.State,
                {
                  volumeId: volume.VolumeId,
                  state: volume.State,
                  sizeGiB: volume.Size,
                  volumeType: volume.VolumeType,
                  encrypted: volume.Encrypted,
                  kmsKeyId: volume.KmsKeyId,
                  availabilityZone: volume.AvailabilityZone,
                  attachmentInstanceIds: (volume.Attachments || [])
                    .map((item) => item.InstanceId)
                    .filter(Boolean)
                    .sort(),
                  tags: this.tags(volume.Tags),
                },
              ),
            );
          }
          nextToken = response.NextToken;
        } while (nextToken);
      },
    );

    await this.runCollector(
      'security-groups',
      region,
      errors,
      completed,
      async () => {
        let nextToken: string | undefined;
        do {
          const response = await clients.ec2.send(
            new DescribeSecurityGroupsCommand({
              NextToken: nextToken,
              MaxResults: 1000,
            }),
          );
          for (const group of response.SecurityGroups || []) {
            if (!group.GroupId) continue;
            resources.push(
              this.resource(
                region,
                'ec2:security-group',
                group.GroupId,
                group.GroupId,
                group.GroupName,
                null,
                {
                  groupId: group.GroupId,
                  groupName: group.GroupName,
                  description: group.Description,
                  vpcId: group.VpcId,
                  ingress: (group.IpPermissions || []).map((permission) =>
                    this.securityGroupPermission(permission),
                  ),
                  egress: (group.IpPermissionsEgress || []).map((permission) =>
                    this.securityGroupPermission(permission),
                  ),
                  tags: this.tags(group.Tags),
                },
              ),
            );
          }
          nextToken = response.NextToken;
        } while (nextToken);
      },
    );

    await this.runCollector(
      'load-balancers',
      region,
      errors,
      completed,
      async () => {
        let marker: string | undefined;
        do {
          const response = await clients.elbv2.send(
            new DescribeLoadBalancersCommand({ Marker: marker, PageSize: 400 }),
          );
          for (const item of response.LoadBalancers || []) {
            if (!item.LoadBalancerArn) continue;
            resources.push(
              this.resource(
                region,
                'elbv2:load-balancer',
                item.LoadBalancerArn,
                item.LoadBalancerArn,
                item.LoadBalancerName,
                item.State?.Code,
                {
                  arn: item.LoadBalancerArn,
                  name: item.LoadBalancerName,
                  dnsName: item.DNSName,
                  scheme: item.Scheme,
                  type: item.Type,
                  state: item.State?.Code,
                  vpcId: item.VpcId,
                  securityGroupIds: (item.SecurityGroups || []).slice().sort(),
                  availabilityZones: (item.AvailabilityZones || [])
                    .map((zone) => zone.ZoneName)
                    .filter(Boolean)
                    .sort(),
                },
              ),
            );
          }
          marker = response.NextMarker;
        } while (marker);
      },
    );

    await this.runCollector(
      'target-groups',
      region,
      errors,
      completed,
      async () => {
        let marker: string | undefined;
        do {
          const response = await clients.elbv2.send(
            new DescribeTargetGroupsCommand({ Marker: marker, PageSize: 400 }),
          );
          for (const item of response.TargetGroups || []) {
            if (!item.TargetGroupArn) continue;
            resources.push(
              this.resource(
                region,
                'elbv2:target-group',
                item.TargetGroupArn,
                item.TargetGroupArn,
                item.TargetGroupName,
                null,
                {
                  arn: item.TargetGroupArn,
                  name: item.TargetGroupName,
                  protocol: item.Protocol,
                  port: item.Port,
                  targetType: item.TargetType,
                  vpcId: item.VpcId,
                  loadBalancerArns: (item.LoadBalancerArns || [])
                    .slice()
                    .sort(),
                  healthCheck: {
                    enabled: item.HealthCheckEnabled,
                    protocol: item.HealthCheckProtocol,
                    port: item.HealthCheckPort,
                    path: item.HealthCheckPath,
                  },
                },
              ),
            );
          }
          marker = response.NextMarker;
        } while (marker);
      },
    );

    await this.runCollector(
      'eks-clusters',
      region,
      errors,
      completed,
      async () => {
        let nextToken: string | undefined;
        do {
          const response = await clients.eks.send(
            new ListClustersCommand({ nextToken, maxResults: 100 }),
          );
          for (const name of response.clusters || []) {
            const detail = await clients.eks.send(
              new DescribeClusterCommand({ name }),
            );
            const cluster = detail.cluster;
            if (!cluster?.name) continue;
            resources.push(
              this.resource(
                region,
                'eks:cluster',
                cluster.name,
                cluster.arn,
                cluster.name,
                cluster.status,
                {
                  name: cluster.name,
                  arn: cluster.arn,
                  status: cluster.status,
                  version: cluster.version,
                  createdAt: cluster.createdAt?.toISOString(),
                  endpointPublicAccess:
                    cluster.resourcesVpcConfig?.endpointPublicAccess,
                  endpointPrivateAccess:
                    cluster.resourcesVpcConfig?.endpointPrivateAccess,
                  publicAccessCidrs: (
                    cluster.resourcesVpcConfig?.publicAccessCidrs || []
                  )
                    .slice()
                    .sort(),
                  vpcId: cluster.resourcesVpcConfig?.vpcId,
                  subnetIds: (cluster.resourcesVpcConfig?.subnetIds || [])
                    .slice()
                    .sort(),
                  securityGroupIds: (
                    cluster.resourcesVpcConfig?.securityGroupIds || []
                  )
                    .slice()
                    .sort(),
                  encryptionKeyArns: (cluster.encryptionConfig || [])
                    .map((item) => item.provider?.keyArn)
                    .filter(Boolean)
                    .sort(),
                  tags: this.tags(cluster.tags),
                },
              ),
            );
          }
          nextToken = response.nextToken;
        } while (nextToken);
      },
    );

    await this.runCollector(
      'rds-instances',
      region,
      errors,
      completed,
      async () => {
        let marker: string | undefined;
        do {
          const response = await clients.rds.send(
            new DescribeDBInstancesCommand({ Marker: marker, MaxRecords: 100 }),
          );
          for (const item of response.DBInstances || []) {
            if (!item.DBInstanceIdentifier) continue;
            resources.push(
              this.resource(
                region,
                'rds:db-instance',
                item.DBInstanceIdentifier,
                item.DBInstanceArn,
                item.DBInstanceIdentifier,
                item.DBInstanceStatus,
                {
                  identifier: item.DBInstanceIdentifier,
                  arn: item.DBInstanceArn,
                  status: item.DBInstanceStatus,
                  engine: item.Engine,
                  engineVersion: item.EngineVersion,
                  instanceClass: item.DBInstanceClass,
                  storageEncrypted: item.StorageEncrypted,
                  publiclyAccessible: item.PubliclyAccessible,
                  multiAZ: item.MultiAZ,
                  vpcId: item.DBSubnetGroup?.VpcId,
                  securityGroupIds: (item.VpcSecurityGroups || [])
                    .map((group) => group.VpcSecurityGroupId)
                    .filter(Boolean)
                    .sort(),
                },
              ),
            );
          }
          marker = response.Marker;
        } while (marker);
      },
    );

    await this.runCollector(
      'acm-certificates',
      region,
      errors,
      completed,
      async () => {
        let nextToken: string | undefined;
        do {
          const response = await clients.acm.send(
            new ListCertificatesCommand({
              NextToken: nextToken,
              MaxItems: 1000,
            }),
          );
          for (const summary of response.CertificateSummaryList || []) {
            if (!summary.CertificateArn) continue;
            const detail = await clients.acm.send(
              new DescribeCertificateCommand({
                CertificateArn: summary.CertificateArn,
              }),
            );
            const certificate = detail.Certificate;
            resources.push(
              this.resource(
                region,
                'acm:certificate',
                summary.CertificateArn,
                summary.CertificateArn,
                certificate?.DomainName || summary.DomainName,
                certificate?.Status,
                {
                  arn: summary.CertificateArn,
                  domainName: certificate?.DomainName || summary.DomainName,
                  subjectAlternativeNames: (
                    certificate?.SubjectAlternativeNames || []
                  )
                    .slice()
                    .sort(),
                  status: certificate?.Status,
                  type: certificate?.Type,
                  keyAlgorithm: certificate?.KeyAlgorithm,
                  inUseBy: (certificate?.InUseBy || []).slice().sort(),
                  issuedAt: certificate?.IssuedAt?.toISOString(),
                  notBefore: certificate?.NotBefore?.toISOString(),
                  notAfter: certificate?.NotAfter?.toISOString(),
                  renewalEligibility: certificate?.RenewalEligibility,
                },
              ),
            );
          }
          nextToken = response.NextToken;
        } while (nextToken);
      },
    );
  }

  private async collectGlobal(
    clients: AwsGovernanceClients,
    resources: AwsInventoryResource[],
    errors: AwsCollectorError[],
    completed: string[],
  ) {
    await this.runCollector(
      's3-buckets',
      'global',
      errors,
      completed,
      async () => {
        const response = await clients.s3.send(new ListBucketsCommand({}));
        for (const bucket of response.Buckets || []) {
          if (!bucket.Name) continue;
          let location: string | undefined;
          try {
            const detail = await clients.s3.send(
              new GetBucketLocationCommand({ Bucket: bucket.Name }),
            );
            location = detail.LocationConstraint || 'us-east-1';
          } catch {
            location = undefined;
          }
          resources.push(
            this.resource(
              'global',
              's3:bucket',
              bucket.Name,
              `arn:aws:s3:::${bucket.Name}`,
              bucket.Name,
              null,
              {
                name: bucket.Name,
                creationDate: bucket.CreationDate?.toISOString(),
                region: location,
              },
            ),
          );
        }
      },
    );

    await this.runCollector(
      'route53-hosted-zones',
      'global',
      errors,
      completed,
      async () => {
        let marker: string | undefined;
        do {
          const response = await clients.route53.send(
            new ListHostedZonesCommand({ Marker: marker, MaxItems: 100 }),
          );
          for (const zone of response.HostedZones || []) {
            const id = String(zone.Id || '').replace('/hostedzone/', '');
            if (!id) continue;
            resources.push(
              this.resource(
                'global',
                'route53:hosted-zone',
                id,
                `arn:aws:route53:::hostedzone/${id}`,
                zone.Name,
                null,
                {
                  id,
                  name: zone.Name,
                  privateZone: zone.Config?.PrivateZone,
                  resourceRecordSetCount: zone.ResourceRecordSetCount,
                },
              ),
            );
          }
          marker = response.IsTruncated ? response.NextMarker : undefined;
        } while (marker);
      },
    );

    await this.runCollector(
      'iam-roles',
      'global',
      errors,
      completed,
      async () => {
        let marker: string | undefined;
        do {
          const response = await clients.iam.send(
            new ListRolesCommand({ Marker: marker, MaxItems: 1000 }),
          );
          for (const role of response.Roles || []) {
            if (!role.RoleName) continue;
            resources.push(
              this.resource(
                'global',
                'iam:role',
                role.RoleName,
                role.Arn,
                role.RoleName,
                null,
                {
                  roleName: role.RoleName,
                  arn: role.Arn,
                  path: role.Path,
                  createDate: role.CreateDate?.toISOString(),
                  maxSessionDuration: role.MaxSessionDuration,
                  trustPrincipals: this.trustPrincipals(
                    role.AssumeRolePolicyDocument,
                  ),
                  tags: this.tags(role.Tags),
                },
              ),
            );
          }
          marker = response.IsTruncated ? response.Marker : undefined;
        } while (marker);
      },
    );

    await this.runCollector(
      'cloudtrail-trails',
      'global',
      errors,
      completed,
      async () => {
        const response = await clients.cloudTrail.send(
          new DescribeTrailsCommand({ includeShadowTrails: false }),
        );
        for (const trail of response.trailList || []) {
          if (!trail.TrailARN || !trail.Name) continue;
          const [status, selectors] = await Promise.all([
            clients.cloudTrail.send(
              new GetTrailStatusCommand({ Name: trail.TrailARN }),
            ),
            clients.cloudTrail.send(
              new GetEventSelectorsCommand({ TrailName: trail.TrailARN }),
            ),
          ]);
          resources.push(
            this.resource(
              'global',
              'cloudtrail:trail',
              trail.TrailARN,
              trail.TrailARN,
              trail.Name,
              status.IsLogging ? 'LOGGING' : 'STOPPED',
              {
                arn: trail.TrailARN,
                name: trail.Name,
                homeRegion: trail.HomeRegion,
                multiRegion: trail.IsMultiRegionTrail,
                organizationTrail: trail.IsOrganizationTrail,
                logFileValidation: trail.LogFileValidationEnabled,
                isLogging: status.IsLogging,
                latestDeliveryError: status.LatestDeliveryError || null,
                eventSelectors: (selectors.EventSelectors || []).map(
                  (selector) => ({
                    readWriteType: selector.ReadWriteType,
                    includeManagementEvents: selector.IncludeManagementEvents,
                    dataResourceTypes: (selector.DataResources || [])
                      .map((item) => item.Type)
                      .filter(Boolean)
                      .sort(),
                  }),
                ),
              },
            ),
          );
        }
      },
    );
  }

  private async runCollector(
    collector: string,
    region: string,
    errors: AwsCollectorError[],
    completed: string[],
    fn: () => Promise<void>,
  ) {
    try {
      await fn();
      completed.push(`${collector}:${region}`);
    } catch (error: any) {
      errors.push({
        collector,
        region,
        code: String(error?.name || error?.Code || 'COLLECTOR_ERROR').slice(
          0,
          128,
        ),
        message: String(
          error?.message || error || 'Unknown collector error',
        ).slice(0, 500),
      });
    }
  }

  private resource(
    region: string,
    resourceType: string,
    resourceId: string,
    resourceArn: string | null | undefined,
    displayName: string | null | undefined,
    status: string | null | undefined,
    normalized: Record<string, unknown>,
  ): AwsInventoryResource {
    const stable = this.stable(normalized) as Record<string, unknown>;
    return {
      region,
      resourceType,
      resourceId,
      resourceArn: resourceArn || null,
      displayName: displayName || null,
      status: status || null,
      normalized: stable,
      normalizedHash: createHash('sha256')
        .update(JSON.stringify(stable))
        .digest('hex'),
    };
  }

  private stable(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value
        .map((item) => this.stable(item))
        .sort((left, right) =>
          JSON.stringify(left).localeCompare(JSON.stringify(right)),
        );
    }
    if (value && typeof value === 'object') {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .filter(([, entry]) => entry !== undefined)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([key, entry]) => [key, this.stable(entry)]),
      );
    }
    return value;
  }

  private tags(
    input:
      | Array<{ Key?: string; Value?: string }>
      | Record<string, string>
      | undefined,
  ) {
    const entries = Array.isArray(input)
      ? input.map((item) => [item.Key, item.Value] as const)
      : Object.entries(input || {});
    return Object.fromEntries(
      entries
        .filter(([key]) => key && TAG_ALLOWLIST.has(String(key).toLowerCase()))
        .map(([key, value]) => [String(key), String(value || '').slice(0, 255)])
        .sort(([left], [right]) => left.localeCompare(right)),
    );
  }

  private nameFromTags(
    tags: Array<{ Key?: string; Value?: string }> | undefined,
  ) {
    return (
      tags?.find((tag) => String(tag.Key).toLowerCase() === 'name')?.Value ||
      null
    );
  }

  private securityGroupPermission(permission: any) {
    return {
      protocol: permission.IpProtocol,
      fromPort: permission.FromPort,
      toPort: permission.ToPort,
      ipv4Ranges: (permission.IpRanges || [])
        .map((item: any) => item.CidrIp)
        .filter(Boolean)
        .sort(),
      ipv6Ranges: (permission.Ipv6Ranges || [])
        .map((item: any) => item.CidrIpv6)
        .filter(Boolean)
        .sort(),
      sourceGroupIds: (permission.UserIdGroupPairs || [])
        .map((item: any) => item.GroupId)
        .filter(Boolean)
        .sort(),
    };
  }

  private trustPrincipals(encoded?: string) {
    if (!encoded) return [];
    try {
      const document = JSON.parse(decodeURIComponent(encoded));
      const statements = Array.isArray(document.Statement)
        ? document.Statement
        : [document.Statement].filter(Boolean);
      return statements
        .flatMap((statement: any) => {
          const principal = statement?.Principal;
          if (!principal) return [];
          if (typeof principal === 'string') return [principal];
          return Object.values(principal)
            .flatMap((value) => (Array.isArray(value) ? value : [value]))
            .map(String);
        })
        .sort();
    } catch {
      return ['UNPARSEABLE'];
    }
  }
}
