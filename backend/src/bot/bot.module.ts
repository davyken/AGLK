import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { MetaSenderService } from '../../src/whatsapp/meta-sender.service';
import { RegistrationFlowService } from '../bot/registration.flow';
import { UsersModule } from '../users/users.module';
import { AiModule } from '../ai/ai.module';

@Module({
  imports: [
    UsersModule,
    AiModule,
  ],
  controllers: [BotController],
  providers: [
    BotService,
    MetaSenderService,
    RegistrationFlowService,
  ],
  exports: [MetaSenderService],
})
export class BotModule {}