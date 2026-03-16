import { Module } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';
import { PermissionsController } from './permissions.controller';
import { PlatformDatabaseService } from './platform-database.service';

@Module({
  providers: [AccessControlService, PlatformDatabaseService],
  controllers: [UsersController, RolesController, PermissionsController],
  exports: [AccessControlService, PlatformDatabaseService],
})
export class AccessControlModule {}
