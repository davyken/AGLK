import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PriceService } from './price.service';
import { PriceEventListener } from './price-event.listener';
import { Listing, ListingSchema } from '../common/schemas/listing.schema';
import { PriceHistory, PriceHistorySchema } from '../common/schemas/price-history.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: Listing.name, schema: ListingSchema },
      { name: PriceHistory.name, schema: PriceHistorySchema },
    ]),
  ],
  providers: [PriceService, PriceEventListener],
  exports: [PriceService],
})
export class PriceModule {}
