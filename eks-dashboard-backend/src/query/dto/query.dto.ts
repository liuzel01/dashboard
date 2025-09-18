import { IsString, IsNotEmpty, IsIn } from 'class-validator';

export class AggregateQueryDto {
  @IsString()
  @IsNotEmpty()
  identifier: string;

  // 在实际应用中，你可以扩展这个类型列表
  @IsIn(['UID', 'EMAIL', 'PHONE'])
  @IsString()
  @IsNotEmpty()
  type: 'UID' | 'EMAIL' | 'PHONE';
}
