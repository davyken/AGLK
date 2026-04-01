import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { ListingService } from '../listing/listing.service';
import { MatchingService } from '../matching/matching.service';
import { MatchResult } from '../matching/matching.service';
import { MetaSenderService } from '../bot/meta-sender.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly listingService: ListingService,
    private readonly matchingService: MatchingService,
    private readonly metaSender: MetaSenderService,
  ) {}

  /**
   * Story 12: Notify Users
   * Notify buyers when new supply appears
   * Notify farmers when demand appears
   */
  async notifyOnNewListing(listingId: string): Promise<void> {
    try {
      const listing = await this.listingService.findOne(listingId);

      // Find matches for this listing
      const matches = await this.matchingService.findMatches(listing, 5);

      if (matches.length === 0) {
        return; // No matches to notify about
      }

      if (listing.type === 'sell') {
        // Notify buyers who need this product
        await this.notifyBuyersOfNewSupply(listing, matches);
      } else if (listing.type === 'buy') {
        // Notify farmers who have this product
        await this.notifyFarmersOfNewDemand(listing, matches);
      }
    } catch (error) {
      this.logger.error(`Failed to notify on new listing: ${error}`);
    }
  }

  /**
   * Notify buyers when new supply (sell listing) matches their demand
   */
  private async notifyBuyersOfNewSupply(
    sellListing: any,
    matches: MatchResult[],
  ): Promise<void> {
    for (const match of matches) {
      const buyerListing = match.listing;
      
      // Get buyer's phone number
      const buyer = await this.usersService.findByPhone(buyerListing.userPhone);
      
      if (buyer?.lastChannelUsed && buyer?.phone) {
        const message = this.buildSupplyNotification(
          sellListing,
          buyer.name || 'Buyer',
        );

        try {
          await this.metaSender.send(buyer.phone, message);
          this.logger.log(`Notified buyer ${buyer.phone} of new supply`);
        } catch (error) {
          this.logger.error(`Failed to notify buyer: ${error}`);
        }
      }
    }
  }

  /**
   * Notify farmers when new demand (buy listing) matches their supply
   */
  private async notifyFarmersOfNewDemand(
    buyListing: any,
    matches: MatchResult[],
  ): Promise<void> {
    for (const match of matches) {
      const sellListing = match.listing;
      
      // Get farmer's phone number
      const farmer = await this.usersService.findByPhone(sellListing.userPhone);
      
      if (farmer?.lastChannelUsed && farmer?.phone) {
        const message = this.buildDemandNotification(
          buyListing,
          farmer.name || 'Farmer',
        );

        try {
          await this.metaSender.send(farmer.phone, message);
          this.logger.log(`Notified farmer ${farmer.phone} of new demand`);
        } catch (error) {
          this.logger.error(`Failed to notify farmer: ${error}`);
        }
      }
    }
  }

  /**
   * Build notification message for buyers
   */
  private buildSupplyNotification(sellListing: any, buyerName: string): string {
    return `🔔 *New Supply Match!*

Hi ${buyerName}!

A new listing matches your demand:

🌽 *${this.capitalize(sellListing.product)}*
📦 ${sellListing.quantity} ${sellListing.unit}
💰 ${this.formatPrice(sellListing.price || 0)}
📍 ${sellListing.userLocation}

Farmer: ${sellListing.userName}

To buy, reply:
BUY ${sellListing.product} ${sellListing.quantity} ${sellListing.unit}

Or make an offer:
OFFER ${Math.floor((sellListing.price || 20000) * 0.95)} ${sellListing._id}`;
  }

  /**
   * Build notification message for farmers
   */
  private buildDemandNotification(buyListing: any, farmerName: string): string {
    return `🔔 *New Demand Match!*

Hi ${farmerName}!

A new buyer needs your produce:

🌽 *${this.capitalize(buyListing.product)}*
📦 ${buyListing.quantity} ${buyListing.unit}
💰 Target: ${this.formatPrice(buyListing.price || 0)}
📍 ${buyListing.userLocation}

Buyer: ${buyListing.userName}

To sell, reply:
SELL ${buyListing.product} ${buyListing.quantity} ${buyListing.unit}`;
  }

  private formatPrice(price: number): string {
    return price.toLocaleString() + ' XAF';
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}
