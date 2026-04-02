import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { RegistrationFlowService } from './registration.flow';
import { ListingFlowService } from './listing.flow';
import { UsersModule } from '../users/users.module';
import { ListingModule } from '../listing/listing.module';
import { PriceModule } from '../price/price.module';

@Module({
  imports: [UsersModule, ListingModule, PriceModule],
  controllers: [BotController],
  providers: [BotService, RegistrationFlowService, ListingFlowService],
})
export class BotModule {}
