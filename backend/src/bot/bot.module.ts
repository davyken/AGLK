import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { ListingFlowService } from './listing.flow';
import { RegistrationFlowService } from './registration.flow';
import { UsersModule } from '../users/users.module';
import { AiModule } from '../ai/ai.module';
import { ListingModule } from '../listing/listing.module';
import { PriceModule } from '../price/price.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { FilterParserService } from './filter-parser.service';
import { CropMediaService } from './Crop media.service';

@Module({
  imports: [UsersModule, AiModule, ListingModule, PriceModule, WhatsappModule],
  controllers: [BotController],
  providers: [
    BotService,
    RegistrationFlowService,
    ListingFlowService,
    FilterParserService,
    CropMediaService,
  ],

  exports: [],
})
export class BotModule {}
