import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ListingService } from './listing.service';
import { ListingController } from './listing.controller';
import { Listing, ListingSchema } from '../schemas/listing.schema';
import { UsersModule } from '../users/users.module';

@Module({
  // Import the Mongoose module and register the Listing schema
  imports: [
    MongooseModule.forFeature([{ name: Listing.name, schema: ListingSchema }]),
    UsersModule,
  ],
  controllers: [ListingController],
  providers: [ListingService],
  // Export the service so other modules can use it
  exports: [ListingService],
})
export class ListingModule {}
