import { Module } from '@nestjs/common';
import { BotController } from './bot.controller';
import { ListingFlowService } from './listing.flow';
import { UsersModule } from '../users/users.module';
import { AiModule } from '../ai/ai.module';
import { ListingModule } from '../listing/listing.module';
import { PriceModule } from '../price/price.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { FilterParserService } from './filter-parser.service';
import { CropMediaService } from './Crop media.service';
import { VoltAgentModule } from '../voltagent/voltagent.module';

@Module({
  imports: [UsersModule, AiModule, ListingModule, PriceModule, WhatsappModule, VoltAgentModule],
  controllers: [BotController],
  providers: [
    ListingFlowService,
    FilterParserService,
    CropMediaService,
  ],
  exports: [],
})
export class BotModule {}
