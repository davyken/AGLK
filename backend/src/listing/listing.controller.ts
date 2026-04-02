import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Headers,
  NotFoundException,
} from '@nestjs/common';
import { ListingService } from './listing.service';
import { CreateListingDto, UpdateListingDto } from '../dto/listing.dto';

// This controller handles all the HTTP requests for listings
// It takes the request, calls the service, and returns the response
@Controller('listing')
export class ListingController {
  // We need the service to do the actual work
  constructor(private readonly listingService: ListingService) {}

  // POST /listing - Create a new listing
  @Post()
  async create(
    @Body() createListingDto: CreateListingDto,
    @Headers('x-user-phone') phone: string,
  ) {
    return this.listingService.create(createListingDto, phone);
  }

  // GET /listing - Get all listings

  @Get()
  async findAll() {
    return this.listingService.findAll();
  }

  // GET /listing/active - Get all active listings for the main feed
  @Get('active')
  async findActive() {
    return this.listingService.findActiveListings();
  }

  // GET /listing/user/:phone
  @Get('user/:phone')
  async findByUser(@Param('phone') phone: string) {
    return this.listingService.findByUserPhone(phone);
  }

  // GET /listing/:id
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.listingService.findOne(id);
  }

  // PATCH /listing/:id - Update a listing
  // Can update price, quantity, status etc
  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateListingDto: UpdateListingDto,
  ) {
    return this.listingService.update(id, updateListingDto);
  }

  // DELETE /listing/:id - Cancel a listing (soft delete)
  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.listingService.remove(id);
  }
}
