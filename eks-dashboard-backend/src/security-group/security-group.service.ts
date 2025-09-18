import {
  Injectable,
  Logger,
  NotFoundException,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { EnvironmentsService } from '../environments/environments.service';
import { DescribeLoadBalancersCommand } from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  DescribeSecurityGroupsCommand,
  AuthorizeSecurityGroupIngressCommand,
  RevokeSecurityGroupIngressCommand,
  IpPermission,
  EC2ServiceException,
} from '@aws-sdk/client-ec2';

@Injectable()
export class SecurityGroupService {
  private readonly logger = new Logger(SecurityGroupService.name);

  constructor(private readonly environmentsService: EnvironmentsService) {}

  getPlatformsForEnvironment(environmentId: string) {
    return this.environmentsService.getPlatformsForEnvironment(environmentId);
  }

  private async getLbSecurityGroupId(
    environmentId: string,
    loadBalancerArn: string,
  ): Promise<string> {
    const { elbv2: elbv2Client } =
      this.environmentsService.getAwsClients(environmentId);
    const command = new DescribeLoadBalancersCommand({
      LoadBalancerArns: [loadBalancerArn],
    });

    const response = await elbv2Client.send(command);
    const lb = response.LoadBalancers?.[0];
    const sgId = lb?.SecurityGroups?.[0];

    if (!sgId) {
      throw new NotFoundException(
        `Could not find a security group for load balancer ARN "${loadBalancerArn}".`,
      );
    }
    return sgId;
  }

  private async _getRules(environmentId: string, sgId: string) {
    const { ec2: ec2Client } =
      this.environmentsService.getAwsClients(environmentId);

    const command = new DescribeSecurityGroupsCommand({
      GroupIds: [sgId],
    });

    const response = await ec2Client.send(command);
    const sg = response.SecurityGroups?.[0];

    if (!sg) {
      throw new NotFoundException(
        `Security group with ID "${sgId}" not found.`,
      );
    }

    return sg.IpPermissions || [];
  }

  async getSecurityGroupRules(environmentId: string, loadBalancerArn: string) {
    const sgId = await this.getLbSecurityGroupId(
      environmentId,
      loadBalancerArn,
    );
    return this._getRules(environmentId, sgId);
  }

  async getRulesForSecurityGroup(environmentId: string, groupId: string) {
    return this._getRules(environmentId, groupId);
  }

  async addRule(
    environmentId: string,
    loadBalancerArn: string,
    rule: {
      protocol: string;
      fromPort: number;
      toPort: number;
      cidrIp: string;
      description?: string;
    },
  ) {
    const sgId = await this.getLbSecurityGroupId(
      environmentId,
      loadBalancerArn,
    );
    return this.addRuleToSecurityGroup(environmentId, sgId, rule);
  }

  async addRuleToSecurityGroup(
    environmentId: string,
    groupId: string,
    rule: any,
  ) {
    const { ec2: ec2Client } =
      this.environmentsService.getAwsClients(environmentId);

    const command = new AuthorizeSecurityGroupIngressCommand({
      GroupId: groupId,
      IpPermissions: [
        {
          IpProtocol: rule.protocol,
          FromPort: rule.protocol === '-1' ? undefined : rule.fromPort,
          ToPort: rule.protocol === '-1' ? undefined : rule.toPort,
          IpRanges: [
            {
              CidrIp: rule.cidrIp,
              Description:
                rule.description ||
                `Rule for ${
                  rule.cidrIp
                } added via dashboard on ${new Date().toISOString()}`,
            },
          ],
        },
      ],
    });

    try {
      await ec2Client.send(command);
      this.logger.log(
        `Successfully added rule for ${rule.cidrIp} to security group ${groupId}`,
      );
      return {
        message: `Successfully added rule for ${rule.cidrIp}.`,
      };
    } catch (error: unknown) {
      if (
        error instanceof EC2ServiceException &&
        error.name === 'InvalidPermission.Duplicate'
      ) {
        this.logger.warn(
          `Rule for IP ${rule.cidrIp} is already in the security group ${groupId}.`,
        );
        throw new HttpException(
          'This rule already exists in the security group.',
          HttpStatus.CONFLICT,
        );
      }
      const e = error as Error;
      this.logger.error(
        `Failed to add rule to security group ${groupId}: ${e.message}`,
        e.stack,
      );
      throw new HttpException(
        `Failed to add rule: ${e.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async removeRule(
    environmentId: string,
    loadBalancerArn: string,
    rule: IpPermission,
  ) {
    const sgId = await this.getLbSecurityGroupId(
      environmentId,
      loadBalancerArn,
    );
    return this.removeRuleFromSecurityGroup(environmentId, sgId, rule);
  }

  async removeRuleFromSecurityGroup(
    environmentId: string,
    groupId: string,
    rule: IpPermission,
  ) {
    const { ec2: ec2Client } =
      this.environmentsService.getAwsClients(environmentId);

    const command = new RevokeSecurityGroupIngressCommand({
      GroupId: groupId,
      IpPermissions: [rule],
    });

    try {
      await ec2Client.send(command);
      this.logger.log(
        `Successfully removed rule from security group ${groupId}`,
      );
      return { message: 'Rule removed successfully.' };
    } catch (error: unknown) {
      const e = error as Error;
      this.logger.error(
        `Failed to remove rule from security group ${groupId}: ${e.message}`,
        e.stack,
      );
      throw new HttpException(
        `Failed to remove rule: ${e.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
