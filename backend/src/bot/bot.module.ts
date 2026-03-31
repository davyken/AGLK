import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { MetaSenderService } from './meta-sender.service';
import { RegistrationFlowService } from '../bot/registration.flow';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [UsersModule], // gives access to UsersService
  controllers: [BotController],
  providers: [
    BotService,
    MetaSenderService,
    RegistrationFlowService,
  ],
  exports: [MetaSenderService], // exported so MatchingModule can send messages
})
export class BotModule {}