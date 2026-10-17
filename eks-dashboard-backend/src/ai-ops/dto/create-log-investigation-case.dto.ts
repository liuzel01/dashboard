import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  Min,
} from 'class-validator';

export class CreateLogInvestigationCaseDto {
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsInt({ each: true })
  @Min(1, { each: true })
  jobIds!: number[];
}
