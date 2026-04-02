import { Injectable } from '@nestjs/common';
import { ListingService } from '../listing/listing.service';
import { UsersService } from '../users/users.service';
import { CreateListingDto } from '../listing/dto';
import { PriceService } from '../price/price.service';
import { MatchingService } from '../listing/matching.service';
import { MetaSenderService } from '../whatsapp/meta-sender.service';

interface PendingState {
  type: 'sell' | 'sell_waiting_image' | 'buy_select';
  product: string;
  quantity: number;
  unit: string;
  userPhone: string;
  userRole: string;
  price?: number;
  imageUrl?: string;
  imageMediaId?: string;
  listings?: Array<{
    id: string;
    userPhone: string;
    farmerName: string;
    location: string;
    quantity: number;
    price: number;
    imageUrl?: string;
    imageMediaId?: string;
  }>;
}

const pendingStates = new Map<string, PendingState>();

interface PendingFarmerResponse {
  buyerPhone: string;
  sellerListingId: string;
  buyerListingId: string;
  product: string;
  quantity: number;
  unit: string;
  price: number;
}

const pendingFarmerResponses = new Map<string, PendingFarmerResponse>();

@Injectable()
export class ListingFlowService {
  constructor(
    private readonly listingService: ListingService,
    private readonly usersService: UsersService,
    private readonly priceService: PriceService,
    private readonly matchingService: MatchingService,
    private readonly metaSender: MetaSenderService,
  ) {}

  async handle(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const input = this.normalizeCommand(text);

    if (pendingStates.has(phone)) {
      return this.handlePendingState(phone, input, channel);
    }

    if (input.toUpperCase().startsWith('SELL')) {
      return this.handleSellCommand(phone, input, channel);
    }

    if (input.toUpperCase().startsWith('BUY')) {
      return this.handleBuyCommand(phone, input, channel);
    }

    if (input.toUpperCase().startsWith('OFFER')) {
      return this.handleOfferCommand(phone, input, channel);
    }

    return this.msg(
      channel,
      `❌ Invalid command.\n\nUse: SELL maize 10 bags\nor: BUY maize 20 bags`,
    );
  }

  private normalizeCommand(text: string): string {
    const upper = text.trim().toUpperCase();
    if (upper.startsWith('VENDRE')) return 'SELL' + upper.slice(6);
    if (upper.startsWith('ACHETER')) return 'BUY' + upper.slice(7);
    if (upper.startsWith('OFFRE')) return 'OFFER' + upper.slice(5);
    if (upper === 'OUI') return 'YES';
    if (upper === 'NON') return 'NO';
    if (upper === 'AIDE') return 'HELP';
    if (upper === 'SAUTER') return 'SKIP';
    return text.trim();
  }

  private async handleSellCommand(
    phone: string,
    command: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const parsed = this.parseListingCommand(command);

    if (!parsed || parsed.type !== 'sell') {
      return this.msg(channel, `❌ Invalid format.\n\nUse: SELL maize 10 bags`);
    }

    try {
      const user = await this.usersService.findByPhone(phone);

      if (!user || user.conversationState !== 'REGISTERED') {
        return this.msg(
          channel,
          `❌ You need to register first.\n\nReply Hi to start registration.`,
        );
      }

      if (user.role !== 'farmer') {
        return this.msg(
          channel,
          `❌ Only farmers can sell. You are registered as a ${user.role}.`,
        );
      }

      pendingStates.set(phone, {
        type: 'sell',
        product: parsed.product,
        quantity: parsed.quantity,
        unit: parsed.unit,
        userPhone: phone,
        userRole: user.role,
      });

      const priceData = await this.priceService.getPrice(parsed.product);

      if (!priceData) {
        return this.msg(
          channel,
          `📦 *Listing: ${this.capitalize(parsed.product)}*\n\n` +
            `Quantity: ${parsed.quantity} ${parsed.unit}\n\n` +
            `💰 No market price available for this product.\n` +
            `Please enter your custom price.\n\n` +
            `Example: 20000\n\n` +
            `Reply with the price you want to set.`,
        );
      }

      return this.msg(
        channel,
        `📊 *Market Price for ${this.capitalize(parsed.product)}*\n\n` +
          `Current market prices:\n` +
          `Low: ${this.formatPrice(priceData.low)}\n` +
          `Average: ${this.formatPrice(priceData.avg)}\n` +
          `High: ${this.formatPrice(priceData.high)}\n\n` +
          `*Suggested: ${this.formatPrice(priceData.suggested)}*\\n\\n` +
          `What would you like to do?\n` +
          `1️⃣ Accept suggested price (${this.formatPrice(priceData.suggested)})\n` +
          `2️⃣ Set custom price\\n\\n` +
          `Reply 1 or 2`,
      );
    } catch (error) {
      console.error('Sell command error:', error);
      return this.msg(channel, `❌ Failed to process. Please try again.`);
    }
  }

  private async handleBuyCommand(
    phone: string,
    command: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const parsed = this.parseListingCommand(command);

    if (!parsed || parsed.type !== 'buy') {
      return this.msg(channel, `❌ Invalid format.\n\nUse: BUY maize 20 bags`);
    }

    try {
      const user = await this.usersService.findByPhone(phone);

      if (!user || user.conversationState !== 'REGISTERED') {
        return this.msg(
          channel,
          `❌ You need to register first.\n\nReply Hi to start registration.`,
        );
      }

      if (user.role !== 'buyer') {
        return this.msg(
          channel,
          `❌ Only buyers can buy. You are registered as a ${user.role}.`,
        );
      }

      let matchingListings;
      if (parsed.location || parsed.minPrice || parsed.maxPrice) {
        matchingListings = await this.listingService.findWithFilters(
          parsed.product,
          {
            location: parsed.location,
            minPrice: parsed.minPrice,
            maxPrice: parsed.maxPrice,
            type: 'sell',
          },
        );
      } else {
        matchingListings = await this.listingService.findByProduct(
          parsed.product,
        );
      }

      const sellListings = matchingListings.filter(
        (l) => l.type === 'sell' && l.status === 'active',
      );

      if (sellListings.length === 0) {
        const dto: CreateListingDto = {
          type: 'buy',
          product: parsed.product,
          quantity: parsed.quantity,
          unit: parsed.unit,
          priceType: 'none',
        };

        const listing = await this.listingService.createEnriched(dto, {
          phone: user.phone,
          name: user.name,
          location: user.location,
          channel: user.lastChannelUsed,
        });

        return this.msg(
          channel,
          `🔍 *No listings found for ${this.capitalize(parsed.product)}*\\n\\n` +
            `Your request has been saved.\n` +
            `Product: ${listing.product}\n` +
            `Quantity: ${listing.quantity} ${listing.unit}\n` +
            `Location: ${listing.location}\n\n` +
            `We'll notify you when farmers list this product.\\n\\n` +
            `🏪 Type HELP for more options.`,
        );
      }

      const topListings = sellListings.slice(0, 5);

      pendingStates.set(phone, {
        type: 'buy_select',
        product: parsed.product,
        quantity: parsed.quantity,
        unit: parsed.unit,
        userPhone: phone,
        userRole: user.role,
        listings: topListings.map((l) => ({
          id: l._id.toString(),
          userPhone: l.userPhone,
          farmerName: l.userName,
          location: l.userLocation,
          quantity: l.quantity,
          price: l.price || 0,
          imageUrl: l.imageUrl,
          imageMediaId: l.imageMediaId,
        })),
      });

      let message = `🔍 *Found ${sellListings.length} farmer(s) with ${this.capitalize(parsed.product)}*\n\n`;

      topListings.forEach((listing, index) => {
        message += `${index + 1}️⃣ ${listing.userName}\n`;
        message += `   📦 ${listing.quantity} ${listing.unit}\n`;
        message += `   💰 ${this.formatPrice(listing.price || 0)}\n`;
        message += `   📍 ${listing.userLocation}\n`;
        if (listing.imageUrl || listing.imageMediaId) {
          message += `   📷 Photo available\n`;
        }
        message += `\n`;
      });

      message += `Reply with the number (1-${topListings.length}) to select a farmer.`;

      await this.metaSender.send(phone, message);

      for (const listing of topListings) {
        if (listing.imageMediaId) {
          await this.metaSender.sendImageByMediaId(
            phone,
            listing.imageMediaId,
            `${listing.userName}'s ${listing.product}`,
          );
        } else if (listing.imageUrl) {
          await this.metaSender.sendImage(
            phone,
            listing.imageUrl,
            `${listing.userName}'s ${listing.product}`,
          );
        }
      }

      return '';
    } catch (error) {
      console.error('Buy command error:', error);
      return this.msg(channel, `❌ Failed to search. Please try again.`);
    }
  }

  private async handlePendingState(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const pending = pendingStates.get(phone);
    if (!pending) {
      return this.msg(
        channel,
        `❌ Something went wrong. Start fresh with a new command.`,
      );
    }

    if (response.trim().toUpperCase() === 'CANCEL') {
      pendingStates.delete(phone);
      return this.msg(channel, `❌ Cancelled. Type HELP for options.`);
    }

    if (pending.type === 'sell') {
      return this.handleSellPending(phone, response, channel, pending);
    }

    if (pending.type === 'sell_waiting_image') {
      return this.handleSellWaitingImage(phone, response, channel, pending);
    }

    if (pending.type === 'buy_select') {
      return this.handleBuySelect(phone, response, channel, pending);
    }

    return this.msg(
      channel,
      `❌ Invalid state. Start fresh with a new command.`,
    );
  }

  private async handleSellPending(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
    pending: PendingState,
  ): Promise<string> {
    const input = response.trim().toLowerCase();

    if (input === '1') {
      try {
        const priceData = await this.priceService.getPrice(pending.product);

        if (!priceData) {
          pendingStates.delete(phone);
          return this.msg(
            channel,
            `❌ Price data unavailable. Please try again.`,
          );
        }

        pendingStates.set(phone, {
          type: 'sell_waiting_image',
          product: pending.product,
          quantity: pending.quantity,
          unit: pending.unit,
          userPhone: phone,
          userRole: pending.userRole,
          price: priceData.suggested,
        });

        return this.msg(
          channel,
          `📷 Would you like to add a photo of your product?\n\n` +
            `Send me the image now, or reply SKIP to create listing without an image.`,
        );
      } catch (error) {
        console.error('Price acceptance error:', error);
        pendingStates.delete(phone);
        return this.msg(
          channel,
          `❌ Failed to create listing. Please try again.`,
        );
      }
    }

    if (input === '2') {
      return this.msg(
        channel,
        `💰 Please enter your custom price.\n\n` +
          `Example: 20000\n\n` +
          `You can also send an image of your product after setting the price!`,
      );
    }

    const customPrice = this.parsePrice(response);
    if (customPrice !== null) {
      try {
        pendingStates.set(phone, {
          type: 'sell_waiting_image',
          product: pending.product,
          quantity: pending.quantity,
          unit: pending.unit,
          userPhone: phone,
          userRole: pending.userRole,
          price: customPrice,
        });

        return this.msg(
          channel,
          `📷 Would you like to add a photo of your product?\n\n` +
            `Send me the image now, or reply SKIP to create listing without an image.`,
        );
      } catch (error) {
        console.error('Custom price listing error:', error);
        pendingStates.delete(phone);
        return this.msg(
          channel,
          `❌ Failed to create listing. Please try again.`,
        );
      }
    }

    return this.msg(
      channel,
      `❌ Invalid response.\n\n` +
        `1️⃣ Accept suggested price\n` +
        `2️⃣ Set custom price\n\n` +
        `Reply 1 or 2`,
    );
  }

  private async handleBuySelect(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
    pending: PendingState,
  ): Promise<string> {
    if (response.trim().toUpperCase() === 'CANCEL') {
      pendingStates.delete(phone);
      return this.msg(channel, `❌ Cancelled. Type BUY to search again.`);
    }

    const selection = parseInt(response.trim(), 10);

    if (
      isNaN(selection) ||
      selection < 1 ||
      selection > (pending.listings?.length || 0)
    ) {
      return this.msg(
        channel,
        `❌ Invalid selection.\n\n` +
          `Please reply with a number between 1 and ${pending.listings?.length}\n\n` +
          `Or type CANCEL to start over.`,
      );
    }

    const selectedListing = pending.listings![selection - 1];

    try {
      const dto: CreateListingDto = {
        type: 'buy',
        product: pending.product,
        quantity: pending.quantity,
        unit: pending.unit,
        priceType: 'manual',
        price: selectedListing.price,
      };

      const buyerUser = await this.usersService.findByPhone(phone);
      const buyerListing = await this.listingService.createEnriched(dto, {
        phone,
        name: buyerUser?.name || '',
        location: buyerUser?.location || '',
        channel: buyerUser?.lastChannelUsed || 'whatsapp',
      });

      pendingStates.delete(phone);

      try {
        const farmerUser = await this.usersService.findByPhone(
          selectedListing.userPhone,
        );
        if (farmerUser?.phone) {
          pendingFarmerResponses.set(farmerUser.phone, {
            buyerPhone: phone,
            sellerListingId: selectedListing.id,
            buyerListingId: buyerListing._id.toString(),
            product: pending.product,
            quantity: pending.quantity,
            unit: pending.unit,
            price: selectedListing.price,
          });

          const notificationMsg = this.buildFarmerNotification(
            farmerUser.name || 'Farmer',
            pending.product,
            pending.quantity,
            pending.unit,
            selectedListing.price,
          );
          await this.metaSender.send(farmerUser.phone, notificationMsg);
        }
      } catch {}

      return this.msg(
        channel,
        `🤝 *Connection Requested!*\n\n` +
          `You've selected:\n` +
          `👨‍🌾 ${selectedListing.farmerName}\n` +
          `📦 ${selectedListing.quantity} ${pending.unit}\n` +
          `💰 ${this.formatPrice(selectedListing.price)}\n` +
          `📍 ${selectedListing.location}\n\n` +
          `We've notified the farmer. They will contact you if interested.\n\n` +
          `🏪 Type HELP for more options.`,
      );
    } catch (error) {
      console.error('Buy selection error:', error);
      pendingStates.delete(phone);
      return this.msg(
        channel,
        `❌ Failed to complete request. Please try again.`,
      );
    }
  }

  private parseListingCommand(command: string): {
    type: 'sell' | 'buy';
    product: string;
    quantity: number;
    unit: string;
    location?: string;
    minPrice?: number;
    maxPrice?: number;
  } | null {
    const parts = command.trim().toLowerCase().split(/\s+/);

    if (parts.length < 3) return null;

    const type = parts[0] as 'sell' | 'buy';
    if (type !== 'sell' && type !== 'buy') return null;

    let location: string | undefined;
    let minPrice: number | undefined;
    let maxPrice: number | undefined;

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      if (part.startsWith('@')) {
        location = part.substring(1);
        continue;
      }
      if (part.startsWith('#')) {
        const priceRange = part.substring(1).split('-');
        if (priceRange.length === 2) {
          minPrice = parseInt(priceRange[0], 10);
          maxPrice = parseInt(priceRange[1], 10);
        }
        continue;
      }
    }

    let quantityIndex = -1;
    for (let i = parts.length - 1; i >= 2; i--) {
      const part = parts[i];
      if (part.startsWith('@') || part.startsWith('#')) continue;
      if (/^\d+$/.test(part)) {
        quantityIndex = i;
        break;
      }
    }

    if (quantityIndex === -1) return null;

    const productParts: string[] = [];
    for (let i = 1; i < quantityIndex; i++) {
      const part = parts[i];
      if (!part.startsWith('@') && !part.startsWith('#')) {
        productParts.push(part);
      }
    }
    const product = productParts.join(' ');

    if (!product) return null;

    const quantity = parseInt(parts[quantityIndex], 10);
    const unit = parts[quantityIndex + 1] || 'bags';

    if (quantity <= 0) return null;

    return { type, product, quantity, unit, location, minPrice, maxPrice };
  }

  private parsePrice(text: string): number | null {
    const cleaned = text.replace(/[,\s]/g, '');
    const price = parseInt(cleaned, 10);
    if (isNaN(price) || price <= 0) return null;
    return price;
  }

  private formatPrice(price: number): string {
    return price.toLocaleString() + ' XAF';
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private msg(channel: 'sms' | 'whatsapp', message: string): string {
    if (channel === 'sms') {
      return message
        .replace(
          /[\u{1F300}-\u{1FFFF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}]/gu,
          '',
        )
        .replace(/\*/g, '')
        .trim();
    }
    return message;
  }

  private buildFarmerNotification(
    farmerName: string,
    product: string,
    quantity: number,
    unit: string,
    price: number,
  ): string {
    return (
      `🔔 *New Buyer Interest!*\n\n` +
      `Hi ${farmerName}!\n\n` +
      `A buyer wants your produce:\n\n` +
      `🌽 ${this.capitalize(product)}\n` +
      `📦 ${quantity} ${unit}\n` +
      `💰 Budget: ${this.formatPrice(price)}\n\n` +
      `To respond, reply YES or NO.\n\n` +
      `Or type HELP for options.`
    );
  }

  isInPriceState(phone: string): boolean {
    return pendingStates.has(phone);
  }

  isInImageState(phone: string): boolean {
    const state = pendingStates.get(phone);
    return state?.type === 'sell_waiting_image';
  }

  async handleImage(
    phone: string,
    imageUrl: string | null,
    imageMediaId: string | null,
  ): Promise<string> {
    const pending = pendingStates.get(phone);
    if (!pending || pending.type !== 'sell_waiting_image') {
      return `❌ No pending listing. Use SELL command to create a new listing.`;
    }

    return this.createListingWithImage(
      phone,
      'whatsapp',
      pending,
      imageUrl,
      imageMediaId,
    );
  }

  private async handleSellWaitingImage(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
    pending: PendingState,
  ): Promise<string> {
    const input = response.trim().toUpperCase();

    if (input === 'SKIP' || input === 'SAUTER') {
      return this.createListingWithImage(phone, channel, pending, null, null);
    }

    return this.msg(
      channel,
      `📷 Please send a photo of your product, or reply SKIP to skip.`,
    );
  }

  private async createListingWithImage(
    phone: string,
    channel: 'sms' | 'whatsapp',
    pending: PendingState,
    imageUrl: string | null,
    imageMediaId: string | null,
  ): Promise<string> {
    try {
      const priceData = await this.priceService.getPrice(pending.product);
      const user = await this.usersService.findByPhone(phone);

      const dto: CreateListingDto = {
        type: 'sell',
        product: pending.product,
        quantity: pending.quantity,
        unit: pending.unit,
        marketAvgPrice: priceData?.avg,
        marketMinPrice: priceData?.low,
        marketMaxPrice: priceData?.high,
        price: pending.price,
        priceType: pending.price ? 'manual' : 'auto',
        imageUrl: imageUrl || undefined,
        imageMediaId: imageMediaId || undefined,
      };

      const listing = await this.listingService.createEnriched(dto, {
        phone,
        name: user?.name || '',
        location: user?.location || '',
        channel: user?.lastChannelUsed || 'whatsapp',
      });

      pendingStates.delete(phone);

      let message =
        `✅ *Listing Created!*\n\n` +
        `🌽 Product: ${listing.product}\n` +
        `Quantity: ${listing.quantity} ${listing.unit}\n` +
        `Price: ${this.formatPrice(listing.price)}\n` +
        `Location: ${listing.location}\n\n`;

      if (imageUrl || imageMediaId) {
        message += `📷 Photo added to listing!\n\n`;
        await this.metaSender.send(phone, message);
        if (imageMediaId) {
          await this.metaSender.sendImageByMediaId(
            phone,
            imageMediaId,
            `📷 Your ${listing.product} listing image`,
          );
        } else if (imageUrl) {
          await this.metaSender.sendImage(
            phone,
            imageUrl,
            `📷 Your ${listing.product} listing image`,
          );
        }
        return '';
      }

      message += `👨‍🌾 Type HELP for more options.`;
      return this.msg(channel, message);
    } catch (error) {
      console.error('Create listing with image error:', error);
      pendingStates.delete(phone);
      return this.msg(
        channel,
        `❌ Failed to create listing. Please try again.`,
      );
    }
  }

  private async handleOfferCommand(
    phone: string,
    command: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const parts = command.trim().split(/\s+/);

    if (parts.length < 3) {
      return this.msg(
        channel,
        `❌ Invalid format.\n\nUse: OFFER 20000 LISTING_ID\n\n` +
          `Example: OFFER 20000 abc123xyz`,
      );
    }

    const offerAmount = this.parsePrice(parts[1]);
    const listingId = parts[2];

    if (!offerAmount) {
      return this.msg(
        channel,
        `❌ Invalid offer amount. Please enter a valid number.`,
      );
    }

    try {
      const targetListing = await this.listingService.findOne(listingId);

      if (!targetListing) {
        return this.msg(
          channel,
          `❌ Listing not found. Please check the Listing ID.`,
        );
      }

      if (targetListing.type !== 'sell' || targetListing.status !== 'active') {
        return this.msg(channel, `❌ Listing not available or already sold.`);
      }

      const buyer = await this.usersService.findByPhone(phone);
      if (!buyer || buyer.role !== 'buyer') {
        return this.msg(
          channel,
          `❌ Only buyers can make offers. Please register as a buyer first.`,
        );
      }

      const dto: CreateListingDto = {
        type: 'buy',
        product: targetListing.product,
        quantity: targetListing.quantity,
        unit: targetListing.unit,
        price: offerAmount,
        priceType: 'manual',
      };

      await this.listingService.createEnriched(dto, {
        phone,
        name: buyer.name,
        location: buyer.location,
        channel: buyer.lastChannelUsed,
      });

      return this.msg(
        channel,
        `💰 *Offer Sent!*\n\n` +
          `You offered ${this.formatPrice(offerAmount)} for ${targetListing.product}\n` +
          `Farmer: ${targetListing.userName}\n` +
          `Location: ${targetListing.userLocation}\n\n` +
          `The farmer has been notified. They will contact you if interested.\n\n` +
          `🏪 Type HELP for more options.`,
      );
    } catch (error) {
      console.error('Offer error:', error);
      return this.msg(channel, `❌ Failed to send offer. Please try again.`);
    }
  }

  async handleFarmerResponse(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const user = await this.usersService.findByPhone(phone);

    if (!user || user.role !== 'farmer') {
      return this.msg(channel, `❌ This command is for farmers only.`);
    }

    const pending = pendingFarmerResponses.get(phone);

    if (!pending) {
      return this.msg(
        channel,
        `❌ No pending requests. Type HELP for options.`,
      );
    }

    const buyer = await this.usersService.findByPhone(pending.buyerPhone);
    pendingFarmerResponses.delete(phone);

    if (response.toUpperCase() === 'YES') {
      await this.listingService.update(pending.sellerListingId, {
        status: 'matched',
      });
      await this.listingService.update(pending.buyerListingId, {
        status: 'matched',
      });

      if (buyer?.phone) {
        const buyerMsg =
          `✅ *Great News!*\n\n` +
          `👨‍🌾 ${user.name} has accepted your request!\n\n` +
          `🌽 Product: ${pending.product}\n` +
          `📦 Quantity: ${pending.quantity} ${pending.unit}\n` +
          `💰 Price: ${this.formatPrice(pending.price)}\n\n` +
          `📍 Location: ${user.location}\n\n` +
          `📞 Contact them at: ${user.phone}\n\n` +
          `Happy trading! 🏪`;
        await this.metaSender.send(buyer.phone, buyerMsg);
      }

      return this.msg(
        channel,
        `✅ *Request Accepted!*\n\n` +
          `You've connected with ${buyer?.name || 'the buyer'}.\n\n` +
          `They have been notified and will contact you.\n\n` +
          `Type HELP for more options.`,
      );
    } else {
      if (buyer?.phone) {
        const buyerMsg =
          `😔 *Update*\n\n` +
          `Unfortunately, ${user.name} declined your request for ${pending.product}.\n\n` +
          `Type BUY to search for other farmers.`;
        await this.metaSender.send(buyer.phone, buyerMsg);
      }

      return this.msg(
        channel,
        `❌ *Request Declined*\n\n` +
          `The buyer has been notified.\n\n` +
          `Type HELP for more options.`,
      );
    }
  }
}
