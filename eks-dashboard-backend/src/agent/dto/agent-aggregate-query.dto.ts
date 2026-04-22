import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class AgentAggregateQueryDto {
  @IsString()
  @IsNotEmpty()
  identifier: string;

  @IsIn(['UID', 'EMAIL', 'PHONE'])
  @IsString()
  @IsNotEmpty()
  type: 'UID' | 'EMAIL' | 'PHONE';

  @IsOptional()
  @IsInt()
  tenantId?: number;
}

