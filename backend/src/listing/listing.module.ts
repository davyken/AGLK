import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ListingService } from './listing.service';
import { ListingController } from './listing.controller';
import { MatchingService } from './matching.service';
import { Listing, ListingSchema } from '../common/schemas/listing.schema';
import { EventBusService } from '../common/event-bus.service';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Listing.name, schema: ListingSchema }]),
  ],
  controllers: [ListingController],
  providers: [ListingService, MatchingService, EventBusService],
  exports: [ListingService, MatchingService],
})
export class ListingModule {}
