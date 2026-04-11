
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Listing, ListingDocument } from '../common/schemas/listing.schema';
import { User, UserDocument } from '../common/schemas/user.schema';
import { Notification, NotificationDocument } from '../common/schemas/notification.schema';
import { MatchingService, MatchResult } from '../listing/matching.service';
import { MetaSenderService } from '../whatsapp/meta-sender.service';
import { createHash } from 'crypto';
import type { ListingCreatedEvent } from '../common/event-bus.service';

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
    @InjectModel(Notification.name) private notificationModel: Model<NotificationDocument>,
    private readonly matchingService: MatchingService,
    private readonly metaSender: MetaSenderService,
  ) {}

  @OnEvent('listing.created')
  async handleListingCreated(event: ListingCreatedEvent): Promise<void> {
    try {
      const listing = await this.listingModel.findById(event.listingId).exec();

      if (!listing) return;

      // Pass the listing owner's phone so they are never matched against their own listings
      const matches = await this.matchingService.findMatches(listing, 5, listing.userPhone);

      if (matches.length === 0) return;

      if (listing.type === 'sell') {
        await this.notifyBuyersOfNewSupply(listing, matches);
      } else if (listing.type === 'buy') {
        await this.notifyFarmersOfNewDemand(listing, matches);
      }
    } catch (error) {
      this.logger.error(`Failed to notify on new listing: ${error}`);
    }
  }

  private async notifyBuyersOfNewSupply(
    sellListing: ListingDocument,
    matches: MatchResult[],
  ): Promise<void> {
    for (const match of matches) {
      const buyerListing = match.listing;
      const buyer = await this.userModel
        .findOne({ phone: buyerListing.userPhone })
        .exec();

      if (buyer?.lastChannelUsed && buyer?.phone) {
        const dedupHash = createHash('sha256')
          .update(`${buyer.phone}_${sellListing.product}_${sellListing.quantity}_${sellListing.unit}_${sellListing.userName}_${sellListing.price || 'no'}_${sellListing.userLocation}`.toLowerCase())
          .digest('hex');

        const recentDup = await this.notificationModel.findOne({
          dedupHash,
          userPhone: buyer.phone,
          type: 'match_found',
          status: 'sent',
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        });

        if (recentDup) {
          this.logger.log(`Skipped duplicate notification for ${buyer.phone}`);
          continue;
        }

        const message = this.buildSupplyNotification(
          sellListing,
          buyer.name || 'Buyer',
        );

        try {
          await this.metaSender.send(buyer.phone, message);
          this.logger.log(`Notified buyer ${buyer.phone} of new supply`);
          await new this.notificationModel({
            userPhone: buyer.phone,
            type: 'match_found',
            message,
            channel: buyer.lastChannelUsed,
            status: 'sent',
            dedupHash,
          }).save();
        } catch (error) {
          this.logger.error(`Failed to notify buyer: ${error}`);
        }
      }
    }
  }

  private async notifyFarmersOfNewDemand(
    buyListing: ListingDocument,
    matches: MatchResult[],
  ): Promise<void> {
    for (const match of matches) {
      const sellListing = match.listing;
      const farmer = await this.userModel
        .findOne({ phone: sellListing.userPhone })
        .exec();

      if (farmer?.lastChannelUsed && farmer?.phone) {
        const dedupHash = createHash('sha256')
          .update(`${farmer.phone}_${buyListing.product}_${buyListing.quantity}_${buyListing.unit}_${buyListing.userName}_${buyListing.price || 'no'}_${buyListing.userLocation}`.toLowerCase())
          .digest('hex');

        const recentDup = await this.notificationModel.findOne({
          dedupHash,
          userPhone: farmer.phone,
          type: 'match_found',
          status: 'sent',
          createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        });

        if (recentDup) {
          this.logger.log(`Skipped duplicate notification for ${farmer.phone}`);
          continue;
        }

        const message = this.buildDemandNotification(
          buyListing,
          farmer.name || 'Farmer',
        );

        try {
          await this.metaSender.send(farmer.phone, message);
          this.logger.log(`Notified farmer ${farmer.phone} of new demand`);
          await new this.notificationModel({
            userPhone: farmer.phone,
            type: 'match_found',
            message,
            channel: farmer.lastChannelUsed,
            status: 'sent',
            dedupHash,
          }).save();
        } catch (error) {
          this.logger.error(`Failed to notify farmer: ${error}`);
        }
      }
    }
  }

  private buildSupplyNotification(
    sellListing: ListingDocument,
    buyerName: string,
  ): string {
    return `🔔 *New Supply Match!*

Hi ${buyerName}!

A new listing matches your demand:

🌽 *${this.capitalize(sellListing.product)}*
📦 ${sellListing.quantity} ${sellListing.unit}
💰 ${this.formatPrice(sellListing.price || 0)}
📍 ${sellListing.userLocation}

Farmer: ${sellListing.userName}

To buy, reply:
BUY ${sellListing.product} ${sellListing.quantity} ${sellListing.unit} ${sellListing._id}

Or make an offer:
OFFER ${Math.floor((sellListing.price || 20000) * 0.95)} ${sellListing._id}`;
  }

  private buildDemandNotification(
    buyListing: ListingDocument,
    farmerName: string,
  ): string {
    return `🔔 *New Demand Match!*

Hi ${farmerName}!

A new buyer needs your produce:

🌽 *${this.capitalize(buyListing.product)}*
📦 ${buyListing.quantity} ${buyListing.unit}
💰 Target: ${this.formatPrice(buyListing.price || 0)}
📍 ${buyListing.userLocation}

Buyer: ${buyListing.userName}

To sell, reply:
SELL ${buyListing.product} ${buyListing.quantity} ${buyListing.unit} ${buyListing._id}`;
  }

  private formatPrice(price: number): string {
    return price.toLocaleString() + ' XAF';
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }
}

