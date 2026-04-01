import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { MetaSenderService } from './meta-sender.service';
import { RegistrationFlowService } from './registration.flow';
import { ListingFlowService } from './listing.flow';
import { UsersModule } from '../users/users.module';
import { ListingModule } from '../listing/listing.module';
import { PriceModule } from '../price/price.module';
import { MatchingModule } from '../matching/matching.module';

@Module({
  imports: [UsersModule, ListingModule, PriceModule, MatchingModule], // gives access to all services
  controllers: [BotController],
  providers: [
    BotService,
    MetaSenderService,
    RegistrationFlowService,
    ListingFlowService,
  ],
  exports: [MetaSenderService], // exported so MatchingModule can send messages
})
export class BotModule {}