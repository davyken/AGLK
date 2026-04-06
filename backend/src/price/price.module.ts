import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { PriceService } from './price.service';
import { Listing, ListingSchema } from '../common/schemas/listing.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Listing.name, schema: ListingSchema }]),
  ],
  providers: [PriceService],
  exports: [PriceService],
})
export class PriceModule {}
