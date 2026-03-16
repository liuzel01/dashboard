import { Body, Controller, Get, Param, Patch, Post, ValidationPipe } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly service: AccessControlService) {}

  @Get()
  list() {
    return this.service.listUsers();
  }

  @Post()
  create(@Body(new ValidationPipe({ transform: true })) body: CreateUserDto) {
    return this.service.createUser(body);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: UpdateUserDto,
  ) {
    return this.service.updateUser(Number(id), body);
  }

  @Post(':id/reset-password')
  resetPassword(
    @Param('id') id: string,
    @Body(new ValidationPipe({ transform: true })) body: ResetPasswordDto,
  ) {
    return this.service.resetPassword(Number(id), body.password);
  }
}
