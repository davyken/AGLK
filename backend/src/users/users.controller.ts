import {
  Controller,
  Get,
  Post,
  Put,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  Delete,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from './dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

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

  @Get(':phone')
  async getByPhone(@Param('phone') phone: string) {
    const user = await this.usersService.findByPhoneOrFail(phone);
    return { success: true, data: user };
  }

  @Put(':phone')
  async update(@Param('phone') phone: string, @Body() dto: UpdateUserDto) {
    const user = await this.usersService.update(phone, dto);
    return { success: true, data: user };
  }

  @Get()
  async findAll() {
    const users = await this.usersService.findAll();
    return { success: true, data: users };
  }

  @Put(':phone/ban')
  async toggleBan(
    @Param('phone') phone: string,
    @Body('banned') banned: boolean,
  ) {
    const user = await this.usersService.toggleBan(phone, banned);
    return {
      success: true,
      message: banned
        ? 'User banned successfully'
        : 'User unbanned successfully',
      data: user,
    };
  }

  @Put(':phone/trust-score')
  async updateTrustScore(
    @Param('phone') phone: string,
    @Body('score') score: number,
  ) {
    const user = await this.usersService.updateTrustScore(phone, score);
    return { success: true, message: 'Trust score updated', data: user };
  }

  @Delete(':phone')
  async delete(@Param('phone') phone: string) {
    const user = await this.usersService.delete(phone);
    return { 
      success: true, 
      message: 'User deleted successfully',
      data: user
    };
  }
}
