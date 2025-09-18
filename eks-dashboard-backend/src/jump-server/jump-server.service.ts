import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DescribeInstancesCommand } from '@aws-sdk/client-ec2';
import {
  SendCommandCommand as SsmSendCommandCommand,
  GetCommandInvocationCommand as SsmGetCommandInvocationCommand,
} from '@aws-sdk/client-ssm';
import * as crypto from 'crypto';
import { EnvironmentsService } from '../environments/environments.service';

@Injectable()
export class JumpServerService {
  private readonly logger = new Logger(JumpServerService.name);

  constructor(private readonly environmentsService: EnvironmentsService) {}

  async getJumpServers(environmentId: string) {
    const { ec2: ec2Client } =
      this.environmentsService.getAwsClients(environmentId);
    try {
      const command = new DescribeInstancesCommand({
        Filters: [
          {
            Name: 'platform',
            Values: ['windows'],
          },
        ],
      });

      this.logger.log('Calling AWS EC2 DescribeInstancesCommand...');
      const response = await ec2Client.send(command);

      if (!response.Reservations) {
        return [];
      }
      const jumpServers = response.Reservations.flatMap(
        (reservation) =>
          reservation.Instances?.map((instance) => ({
            instanceId: instance.InstanceId || 'N/A',
            name:
              instance.Tags?.find((tag) => tag.Key === 'Name')?.Value || 'N/A',
            instanceType: instance.InstanceType || 'N/A',
            status: instance.State?.Name || 'N/A',
            publicIpAddress: instance.PublicIpAddress || 'N/A',
            securityGroups:
              instance.SecurityGroups?.map((sg) => ({
                id: sg.GroupId,
                name: sg.GroupName,
              })) || [],
            platformDetails: instance.PlatformDetails || 'N/A',
          })) || [],
      );

      this.logger.log(
        `Successfully fetched ${jumpServers.length} jump servers from AWS.`,
      );

      return jumpServers;
    } catch (error: any) {
      this.logger.error(
        `Failed to fetch jump servers from AWS: ${error.message}`,
        error.stack,
      );
      // 重新抛出错误，以便控制器层可以处理它并返回正确的 HTTP 状态码。
      // 通过返回一个空数组来隐藏错误可能会误导客户端。
      throw new HttpException(
        `Failed to fetch jump servers from AWS: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async resetAndGetPassword(instanceId: string, environmentId: string) {
    const { ssm: ssmClient } =
      this.environmentsService.getAwsClients(environmentId);
    // 1. 生成一个安全的新密码
    const newPassword = crypto.randomBytes(32).toString('base64url');
    this.logger.log(`Generated new password for instance ${instanceId}.`);

    // 2. 使用 SSM Run Command 执行密码重置命令
    const command = new SsmSendCommandCommand({
      DocumentName: 'AWS-RunPowerShellScript',
      InstanceIds: [instanceId],
      Parameters: {
        // 在 PowerShell 中，双引号内的变量会被解析，所以密码中的特殊字符需要小心。
        // base64url 编码不包含单引号或双引号，所以是安全的。
        commands: [`net user Administrator "${newPassword}"`],
      },
    });

    try {
      this.logger.log(
        `Sending SSM command to reset password for ${instanceId}`,
      );
      const sendResponse = await ssmClient.send(command);
      const commandId = sendResponse.Command?.CommandId;

      if (!commandId) {
        throw new Error(
          'Failed to get CommandId from SSM SendCommand response.',
        );
      }

      this.logger.log(`SSM Command sent with ID: ${commandId}`);

      // 3. 轮询命令执行结果
      const maxAttempts = 30; // 30 * 2s = 60s timeout
      const pollInterval = 2000;

      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((resolve) => setTimeout(resolve, pollInterval));

        const invocation = await ssmClient.send(
          new SsmGetCommandInvocationCommand({
            CommandId: commandId,
            InstanceId: instanceId,
          }),
        );

        if (invocation.Status === 'Success') {
          this.logger.log(
            `Password reset successful for instance ${instanceId}.`,
          );
          return { password: newPassword };
        }

        if (
          ['Failed', 'Cancelled', 'TimedOut'].includes(invocation.Status || '')
        ) {
          throw new HttpException(
            `Password reset command failed with status: ${invocation.Status}. Error: ${invocation.StandardErrorContent}`,
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }
      }

      throw new HttpException(
        'Password reset command timed out.',
        HttpStatus.REQUEST_TIMEOUT,
      );
    } catch (error: any) {
      this.logger.error(
        `Failed to reset password for instance ${instanceId}: ${error.message}`,
        error.stack,
      );
      throw new HttpException(
        `Failed to reset password: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
