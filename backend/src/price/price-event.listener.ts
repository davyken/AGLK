import { Injectable, OnModuleInit } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PriceService } from './price.service';
import type { ListingCreatedEvent } from '../common/event-bus.service';

@Injectable()
export class PriceEventListener implements OnModuleInit {
  constructor(private readonly priceService: PriceService) {}

  onModuleInit() {}

  @OnEvent('listing.created')
  async handleListingCreated(event: ListingCreatedEvent) {
    if (event.price) {
      await this.priceService.recalculatePrice(event.product, event.userLocation);
    }
  }

  @OnEvent('listing.updated')
  async handleListingUpdated(event: any) {
    await this.priceService.recalculatePrice(event.product, undefined);
  }
}
