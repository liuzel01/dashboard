import {
  Controller,
  Get,
  Post,
  Param,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { JumpServerService } from './jump-server.service';

@Controller('jump-servers')
export class JumpServerController {
  constructor(private readonly jumpServerService: JumpServerService) {}

  @Get()
  async getJumpServers(@Headers('x-target-environment') environmentId: string) {
    if (!environmentId) {
      throw new BadRequestException(
        'Header "X-Target-Environment" is required.',
      );
    }
    return this.jumpServerService.getJumpServers(environmentId);
  }

  @Post(':instanceId/reset-password')
  async resetAndGetPassword(
    @Param('instanceId') instanceId: string,
    @Headers('x-target-environment') environmentId: string,
  ) {
    if (!environmentId) {
      throw new BadRequestException(
        'Header "X-Target-Environment" is required.',
      );
    }
    return this.jumpServerService.resetAndGetPassword(
      instanceId,
      environmentId,
    );
  }
}
