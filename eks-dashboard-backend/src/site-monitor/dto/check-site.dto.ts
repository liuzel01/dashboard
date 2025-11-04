import { IsInt } from 'class-validator';

export class CheckSiteDto {
  @IsInt()
  id!: number;
}

