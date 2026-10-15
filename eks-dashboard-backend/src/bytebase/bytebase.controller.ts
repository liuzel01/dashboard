import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { BytebaseService } from './bytebase.service';

const validation = new ValidationPipe({ transform: true, whitelist: true });
const ENV = /^[a-z][a-z0-9-]{1,127}$/;
const RESOURCE = /^projects\/[A-Za-z0-9._-]+$/;
const DATABASE = /^instances\/[A-Za-z0-9._-]+\/databases\/.+$/;
const PLAN = /^projects\/[A-Za-z0-9._-]+\/plans\/[A-Za-z0-9._-]+$/;

class EnvironmentQuery {
  @IsString() @Matches(ENV) environmentId!: string;
}
class ProjectQuery extends EnvironmentQuery {
  @IsString() @Matches(RESOURCE) project!: string;
}
class CreateChangeDto extends ProjectQuery {
  @IsString() @Matches(DATABASE) database!: string;
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @IsString() @MinLength(1) @MaxLength(1_000_000) statement!: string;
  @IsIn(['CREATE_BYTEBASE_CHANGE']) confirmation!: 'CREATE_BYTEBASE_CHANGE';
}
class RolloutDto extends EnvironmentQuery {
  @IsString() @Matches(PLAN) plan!: string;
  @IsString() @MinLength(6) @MaxLength(8) mfaCode!: string;
  @IsIn(['EXECUTE_BYTEBASE_ROLLOUT']) confirmation!: 'EXECUTE_BYTEBASE_ROLLOUT';
}
class CancelRequestDto {
  @IsString() @MinLength(6) @MaxLength(8) mfaCode!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsIn(['CANCEL_BYTEBASE_REQUEST']) confirmation!: 'CANCEL_BYTEBASE_REQUEST';
}

@Controller('bytebase')
export class BytebaseController {
  constructor(private readonly service: BytebaseService) {}

  @Get('bindings') bindings(@Headers('authorization') authorization?: string) {
    return this.service.bindings(authorization);
  }
  @Get('catalog') catalog(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) q: EnvironmentQuery,
  ) {
    return this.service.catalog(authorization, q.environmentId);
  }
  @Get('databases') databases(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) q: ProjectQuery,
  ) {
    return this.service.databases(authorization, q.environmentId, q.project);
  }
  @Get('issues') issues(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) q: ProjectQuery,
  ) {
    return this.service.issues(authorization, q.environmentId, q.project);
  }
  @Get('diagnostics') diagnostics(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) q: EnvironmentQuery,
  ) {
    return this.service.diagnostics(authorization, q.environmentId);
  }
  @Get('requests') requests(@Headers('authorization') authorization?: string) {
    return this.service.requests(authorization);
  }
  @Post('changes') createChange(
    @Headers('authorization') authorization: string | undefined,
    @Body(validation) body: CreateChangeDto,
  ) {
    return this.service.createChange(authorization, body);
  }
  @Post('rollouts') rollout(
    @Headers('authorization') authorization: string | undefined,
    @Body(validation) body: RolloutDto,
  ) {
    return this.service.createRollout(authorization, body);
  }
  @Get('requests/:requestId') request(
    @Headers('authorization') authorization: string | undefined,
    @Param('requestId') requestId: string,
  ) {
    return this.service.request(authorization, requestId);
  }
  @Get('requests/:requestId/detail') requestDetail(
    @Headers('authorization') authorization: string | undefined,
    @Param('requestId') requestId: string,
  ) {
    return this.service.requestDetail(authorization, requestId);
  }
  @Post('requests/:requestId/cancel') cancelRequest(
    @Headers('authorization') authorization: string | undefined,
    @Param('requestId') requestId: string,
    @Body(validation) body: CancelRequestDto,
  ) {
    return this.service.cancelRequest(authorization, requestId, body);
  }
  @Get('jit/capability') jit(
    @Headers('authorization') authorization: string | undefined,
    @Query(validation) q: EnvironmentQuery,
  ) {
    return this.service.jitCapability(authorization, q.environmentId);
  }
}
