import {
  Controller,
  Get,
  Post,
  Delete,
  Headers,
  Req,
  Body,
  HttpException,
  HttpStatus,
  Query,
  ValidationPipe,
  Param,
} from '@nestjs/common';
import { SecurityGroupService } from './security-group.service';
import type { Request } from 'express';
import type { IpPermission } from '@aws-sdk/client-ec2';
import { CreateSecurityGroupRuleDto } from './dto/create-security-group-rule.dto';

@Controller('security-groups')
export class SecurityGroupController {
  constructor(private readonly securityGroupService: SecurityGroupService) {}

  @Get('my-ip')
  getMyIp(@Req() req: Request) {
    // 'trust proxy' must be enabled in main.ts for this to be reliable
    const userIp = (req.headers['x-forwarded-for'] as string) ?? req.ip;
    if (!userIp) {
      throw new HttpException(
        'Could not determine user IP address.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const firstIp = userIp.split(',')[0]?.trim();
    return { ip: firstIp };
  }

  @Get('platforms')
  getPlatforms(@Headers('x-target-environment') environmentId: string) {
    if (!environmentId) {
      throw new HttpException(
        'Header "X-Target-Environment" is required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.securityGroupService.getPlatformsForEnvironment(environmentId);
  }

  @Get('rules')
  async getRules(
    @Headers('x-target-environment') environmentId: string,
    @Query('loadBalancerArn') loadBalancerArn: string,
  ) {
    if (!environmentId || !loadBalancerArn) {
      throw new HttpException(
        'Headers "X-Target-Environment" and query parameter "loadBalancerArn" are required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.securityGroupService.getSecurityGroupRules(
      environmentId,
      loadBalancerArn,
    );
  }

  @Post('rules')
  async addRule(
    @Headers('x-target-environment') environmentId: string,
    @Query('loadBalancerArn') loadBalancerArn: string,
    @Body(new ValidationPipe()) ruleDto: CreateSecurityGroupRuleDto,
  ) {
    if (!environmentId || !loadBalancerArn) {
      throw new HttpException(
        'Header "X-Target-Environment" and query parameter "loadBalancerArn" are required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.securityGroupService.addRule(
      environmentId,
      loadBalancerArn,
      ruleDto,
    );
  }

  @Get('by-id/:groupId/rules')
  async getRulesByGroupId(
    @Headers('x-target-environment') environmentId: string,
    @Param('groupId') groupId: string,
  ) {
    if (!environmentId || !groupId) {
      throw new HttpException(
        'Header "X-Target-Environment" and parameter "groupId" are required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.securityGroupService.getRulesForSecurityGroup(
      environmentId,
      groupId,
    );
  }

  @Post('by-id/:groupId/rules')
  async addRuleToGroup(
    @Headers('x-target-environment') environmentId: string,
    @Param('groupId') groupId: string,
    @Body(new ValidationPipe()) ruleDto: CreateSecurityGroupRuleDto,
  ) {
    if (!environmentId || !groupId) {
      throw new HttpException(
        'Header "X-Target-Environment" and parameter "groupId" are required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.securityGroupService.addRuleToSecurityGroup(
      environmentId,
      groupId,
      ruleDto,
    );
  }

  @Delete('by-id/:groupId/rules')
  async removeRuleFromGroup(
    @Headers('x-target-environment') environmentId: string,
    @Param('groupId') groupId: string,
    @Body() rule: IpPermission,
  ) {
    return this.securityGroupService.removeRuleFromSecurityGroup(
      environmentId,
      groupId,
      rule,
    );
  }

  @Delete('rules')
  async removeRule(
    @Headers('x-target-environment') environmentId: string,
    @Body() body: { loadBalancerArn: string; rule: IpPermission },
  ) {
    if (!environmentId || !body.loadBalancerArn || !body.rule) {
      throw new HttpException(
        'Header "X-Target-Environment" and body parameters "loadBalancerArn" and "rule" are required.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.securityGroupService.removeRule(
      environmentId,
      body.loadBalancerArn,
      body.rule,
    );
  }
}
