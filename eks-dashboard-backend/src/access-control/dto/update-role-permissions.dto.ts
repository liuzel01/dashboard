import { ArrayUnique, IsArray } from 'class-validator';
import { Type } from 'class-transformer';
import { IsInt } from 'class-validator';

export class UpdateRolePermissionsDto {
  @IsArray()
  @ArrayUnique()
  @Type(() => Number)
  @IsInt({ each: true })
  permissionIds!: number[];
}
