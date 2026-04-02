import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { ListingFlowService } from './listing.flow';
import { RegistrationFlowService } from './registration.flow';
import { UsersModule } from '../users/users.module';
import { AiModule } from '../ai/ai.module';
import { ListingModule } from '../listing/listing.module';
import { PriceModule } from '../price/price.module';

@Module({
  imports: [
    UsersModule,
    AiModule,
    ListingModule,
    PriceModule,
  ],
  controllers: [BotController],
  providers: [
    BotService,
    RegistrationFlowService,
    ListingFlowService,
  ],
  exports: [],
})
export class BotModule {}
