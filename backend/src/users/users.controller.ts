import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from '../dto/user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // POST /users/register
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body() dto: CreateUserDto) {
    const user = await this.usersService.create(dto);
    return {
      success: true,
      message: 'User registered successfully',
      data: user,
    };
  }

  // GET /users/:phone
  @Get(':phone')
  async getByPhone(@Param('phone') phone: string) {
    const user = await this.usersService.findByPhoneOrFail(phone);
    return { success: true, data: user };
  }

  // PUT /users/:phone
  @Put(':phone')
  async update(@Param('phone') phone: string, @Body() dto: UpdateUserDto) {
    const user = await this.usersService.update(phone, dto);
    return { success: true, data: user };
  }

  // GET /users (debug only — remove in production)
  @Get()
  async findAll() {
    const users = await this.usersService.findAll();
    return { success: true, data: users };
  }
}