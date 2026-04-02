import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../common/schemas/user.schema';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { EventBusService } from '../common/event-bus.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: User.name, schema: UserSchema }]),
  ],
  controllers: [UsersController],
  providers: [UsersService, EventBusService],
  exports: [UsersService],
})
export class UsersModule {}
