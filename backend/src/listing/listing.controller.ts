import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Headers,
} from '@nestjs/common';
import { ListingService } from './listing.service';
import { CreateListingDto, UpdateListingDto } from './dto';

@Controller('listing')
export class ListingController {
  constructor(private readonly listingService: ListingService) {}

  @Post()
  async create(
    @Body() createListingDto: CreateListingDto,
    @Headers('x-user-phone') phone: string,
  ) {
    return this.listingService.create(createListingDto, phone);
  }

  @Get()
  async findAll() {
    return this.listingService.findAll();
  }

  @Get('active')
  async findActive() {
    return this.listingService.findActiveListings();
  }

  @Get('user/:phone')
  async findByUser(@Param('phone') phone: string) {
    return this.listingService.findByUserPhone(phone);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.listingService.findOne(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() updateListingDto: UpdateListingDto,
  ) {
    return this.listingService.update(id, updateListingDto);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.listingService.remove(id);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body('status') status: string,
  ) {
    const listing = await this.listingService.updateStatus(id, status);
    return { success: true, message: 'Listing status updated', data: listing };
  }
}
