import {
  IsIn,
  IsInt,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAlertNoiseControlDto {
  @IsIn(['RESOURCE', 'NAMESPACE', 'ENVIRONMENT'])
  scope!: 'RESOURCE' | 'NAMESPACE' | 'ENVIRONMENT';

  @IsInt()
  @IsIn([30, 60, 120, 240, 480, 1440])
  durationMinutes!: number;

  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  mfaCode!: string;
}

export class CancelAlertNoiseControlDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  mfaCode!: string;
}
