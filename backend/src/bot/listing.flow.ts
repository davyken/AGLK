import { Injectable } from '@nestjs/common';
import { ListingService } from '../listing/listing.service';
import { UsersService } from '../users/users.service';
import { CreateListingDto } from '../dto/listing.dto';
import { PriceService } from '../price/price.service';
import { MatchingService } from '../matching/matching.service';
import { MetaSenderService } from './meta-sender.service';

// Simple in-memory store for conversation state
// In production, this should be in Redis or database
interface PendingState {
  type: 'sell' | 'buy_select';
  product: string;
  quantity: number;
  unit: string;
  userPhone: string;
  userRole: string;
  listings?: Array<{
    id: string;
    userPhone: string;
    farmerName: string;
    location: string;
    quantity: number;
    price: number;
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
    const input = text.trim();

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

  private async handleSellCommand(
    phone: string,
    command: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const parsed = this.parseListingCommand(command);

    if (!parsed || parsed.type !== 'sell') {
      return this.msg(
        channel,
        `❌ Invalid format.\n\nUse: SELL maize 10 bags`,
      );
    }

    try {
      // Get user details
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

      // Store pending listing for price selection
      pendingStates.set(phone, {
        type: 'sell',
        product: parsed.product,
        quantity: parsed.quantity,
        unit: parsed.unit,
        userPhone: phone,
        userRole: user.role,
      });

      // Get market prices from PriceService
      const priceData = await this.priceService.getPrice(parsed.product);

      // If no price data, skip price options and go directly to custom price
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
      return this.msg(
        channel,
        `❌ Failed to process. Please try again.`,
      );
    }
  }

  private async handleBuyCommand(
    phone: string,
    command: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const parsed = this.parseListingCommand(command);

    if (!parsed || parsed.type !== 'buy') {
      return this.msg(
        channel,
        `❌ Invalid format.\n\nUse: BUY maize 20 bags`,
      );
    }

    try {
      // Get user details
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

      // Search for matching SELL listings for this product
      const matchingListings = await this.listingService.findByProduct(parsed.product);
      
      // Filter to active sell listings
      const sellListings = matchingListings.filter(
        (l) => l.type === 'sell' && l.status === 'active'
      );

      if (sellListings.length === 0) {
        // No matching listings - create a buy request and notify
        const dto: CreateListingDto = {
          type: 'buy',
          product: parsed.product,
          quantity: parsed.quantity,
          unit: parsed.unit,
          priceType: 'none',
        };

        const listing = await this.listingService.create(dto, phone);

        return this.msg(
          channel,
          `🔍 *No listings found for ${this.capitalize(parsed.product)}*\\n\\n` +
            `Your request has been saved.\n` +
            `Product: ${listing.product}\n` +
            `Quantity: ${listing.quantity} ${listing.unit}\n` +
            `Location: ${listing.location}\n\n` +
            `📋 Request ID: ${listing._id}\n\n` +
            `We'll notify you when farmers list this product.\\n\\n` +
            `🏪 Type HELP for more options.`,
        );
      }

      // Show matching listings to buyer (limit to top 5)
      const topListings = sellListings.slice(0, 5);
      
      // Store pending state
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
        })),
      });

      // Build response message
      let message = `🔍 *Found ${sellListings.length} farmer(s) with ${this.capitalize(parsed.product)}*\n\n`;
      
      topListings.forEach((listing, index) => {
        message += `${index + 1}️⃣ ${listing.userName}\n`;
        message += `   📦 ${listing.quantity} ${listing.unit}\n`;
        message += `   💰 ${this.formatPrice(listing.price || 0)}\n`;
        message += `   📍 ${listing.userLocation}\n\n`;
      });

      message += `Reply with the number (1-${topListings.length}) to select a farmer.`;

      return this.msg(channel, message);
    } catch (error) {
      console.error('Buy command error:', error);
      return this.msg(
        channel,
        `❌ Failed to search. Please try again.`,
      );
    }
  }

  private async handlePendingState(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const pending = pendingStates.get(phone);
    if (!pending) {
      return this.msg(channel, `❌ Something went wrong. Start fresh with a new command.`);
    }

    // SELL FLOW - Price selection
    if (pending.type === 'sell') {
      return this.handleSellPending(phone, response, channel, pending);
    }

    // BUY FLOW - Select farmer
    if (pending.type === 'buy_select') {
      return this.handleBuySelect(phone, response, channel, pending);
    }

    return this.msg(channel, `❌ Invalid state. Start fresh with a new command.`);
  }

  private async handleSellPending(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
    pending: PendingState,
  ): Promise<string> {
    const input = response.trim().toLowerCase();

    // Option 1: Accept suggested price
    if (input === '1') {
      try {
        const priceData = await this.priceService.getPrice(pending.product);
        
        if (!priceData) {
          pendingStates.delete(phone);
          return this.msg(channel, `❌ Price data unavailable. Please try again.`);
        }
        
        const dto: CreateListingDto = {
          type: 'sell',
          product: pending.product,
          quantity: pending.quantity,
          unit: pending.unit,
          marketAvgPrice: priceData.avg,
          marketMinPrice: priceData.low,
          marketMaxPrice: priceData.high,
          price: priceData.suggested,
          priceType: 'auto',
          acceptedSuggestion: true,
        };

        const listing = await this.listingService.create(dto, phone);

        pendingStates.delete(phone);



        return this.msg(
          channel,
          `✅ *Listing Created!*\n\n` +
            `🌽 Product: ${listing.product}\n` +
            `Quantity: ${listing.quantity} ${listing.unit}\n` +
            `Price: ${this.formatPrice(listing.price)}\n` +
            `Location: ${listing.location}\n\n` +
            `📋 Listing ID: ${listing._id}\n\n` +
            `👨‍🌾 Type HELP for more options.`,
        );
      } catch (error) {
        console.error('Price acceptance error:', error);
        pendingStates.delete(phone);
        return this.msg(channel, `❌ Failed to create listing. Please try again.`);
      }
    }

    // Option 2: Set custom price - prompt for price
    if (input === '2') {
      return this.msg(
        channel,
        `💰 Please enter your custom price.\n\n` +
          `Example: 20000\n\n` +
          `Reply with the price you want to set.`,
      );
    }

    // Check if response is a custom price (number)
    const customPrice = this.parsePrice(response);
    if (customPrice !== null) {
      try {
        const priceData = await this.priceService.getPrice(pending.product);

        const dto: CreateListingDto = {
          type: 'sell',
          product: pending.product,
          quantity: pending.quantity,
          unit: pending.unit,
          marketAvgPrice: priceData?.avg,
          marketMinPrice: priceData?.low,
          marketMaxPrice: priceData?.high,
          price: customPrice,
          priceType: 'manual',
        };

        const listing = await this.listingService.create(dto, phone);

        pendingStates.delete(phone);

        return this.msg(
          channel,
          `✅ *Listing Created!*\n\n` +
            `🌽 Product: ${listing.product}\n` +
            `Quantity: ${listing.quantity} ${listing.unit}\n` +
            `Price: ${this.formatPrice(listing.price)} (custom)\n` +
            `Location: ${listing.location}\n\n` +
            `📋 Listing ID: ${listing._id}\n\n` +
            `👨‍🌾 Type HELP for more options.`,
        );
      } catch (error) {
        console.error('Custom price listing error:', error);
        pendingStates.delete(phone);
        return this.msg(channel, `❌ Failed to create listing. Please try again.`);
      }
    }

    // Invalid response
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
    const selection = parseInt(response.trim(), 10);

    if (isNaN(selection) || selection < 1 || selection > (pending.listings?.length || 0)) {
      return this.msg(
        channel,
        `❌ Invalid selection.\n\n` +
          `Please reply with a number between 1 and ${pending.listings?.length}\n\n` +
          `Or type CANCEL to start over.`,
      );
    }

    // Handle CANCEL
    if (response.trim().toUpperCase() === 'CANCEL') {
      pendingStates.delete(phone);
      return this.msg(channel, `❌ Cancelled. Type BUY to search again.`);
    }

    const selectedListing = pending.listings![selection - 1];

    // Mark the buyer's listing as "matched" with the selected farmer
    try {
      // Create the buyer's listing
      const dto: CreateListingDto = {
        type: 'buy',
        product: pending.product,
        quantity: pending.quantity,
        unit: pending.unit,
        priceType: 'manual',
        price: selectedListing.price,
      };

      const buyerListing = await this.listingService.create(dto, phone);

      pendingStates.delete(phone);

      // Send notification to farmer
      try {
        const farmerUser = await this.usersService.findByPhone(selectedListing.userPhone);
        if (farmerUser?.phone) {
          // Store pending response for farmer
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
            selectedListing.price
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
          `📋 Your Request ID: ${buyerListing._id}\n\n` +
          `We've notified the farmer. They will contact you if interested.\n\n` +
          `🏪 Type HELP for more options.`,
      );
    } catch (error) {
      console.error('Buy selection error:', error);
      pendingStates.delete(phone);
      return this.msg(channel, `❌ Failed to complete request. Please try again.`);
    }
  }

  private parseListingCommand(
    command: string,
  ): { type: 'sell' | 'buy'; product: string; quantity: number; unit: string } | null {
    const parts = command.trim().toLowerCase().split(/\s+/);

    if (parts.length < 3) {
      return null;
    }

    const type = parts[0] as 'sell' | 'buy';
    if (type !== 'sell' && type !== 'buy') {
      return null;
    }

    // Find the last part that is a number (quantity)
    let quantityIndex = -1;
    for (let i = parts.length - 1; i >= 2; i--) {
      if (/^\d+$/.test(parts[i])) {
        quantityIndex = i;
        break;
      }
    }

    if (quantityIndex === -1) {
      return null;
    }

    const product = parts.slice(1, quantityIndex).join(' ');
    const quantity = parseInt(parts[quantityIndex], 10);
    const unit = parts[quantityIndex + 1] || 'bags';

    if (!product || quantity <= 0) {
      return null;
    }

    return { type, product, quantity, unit };
  }

  private parsePrice(text: string): number | null {
    // Remove commas and spaces, try to parse as number
    const cleaned = text.replace(/[,\s]/g, '');
    const price = parseInt(cleaned, 10);
    
    if (isNaN(price) || price <= 0) {
      return null;
    }
    
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
        .replace(/[\u{1F300}-\u{1FFFF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}]/gu, '')
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
    return `🔔 *New Buyer Interest!*\n\n` +
      `Hi ${farmerName}!\n\n` +
      `A buyer wants your produce:\n\n` +
      `🌽 ${this.capitalize(product)}\n` +
      `📦 ${quantity} ${unit}\n` +
      `💰 Budget: ${this.formatPrice(price)}\n\n` +
      `To respond, reply YES or NO.\n\n` +
      `Or type HELP for options.`;
  }

  isInPriceState(phone: string): boolean {
    return pendingStates.has(phone);
  }

  // Handle OFFER command - Story 8: Make Offer
  private async handleOfferCommand(
    phone: string,
    command: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    // Parse: OFFER 20000 LISTING_ID
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
      return this.msg(channel, `❌ Invalid offer amount. Please enter a valid number.`);
    }

    try {
      // Get the target listing (farmer's listing)
      const targetListing = await this.listingService.findOne(listingId);

      if (!targetListing) {
        return this.msg(channel, `❌ Listing not found. Please check the Listing ID.`);
      }

      if (targetListing.type !== 'sell' || targetListing.status !== 'active') {
        return this.msg(channel, `❌ Listing not available or already sold.`);
      }

      // Get buyer details
      const buyer = await this.usersService.findByPhone(phone);
      if (!buyer || buyer.role !== 'buyer') {
        return this.msg(channel, `❌ Only buyers can make offers. Please register as a buyer first.`);
      }

      // Create buyer's offer listing
      const dto: CreateListingDto = {
        type: 'buy',
        product: targetListing.product,
        quantity: targetListing.quantity,
        unit: targetListing.unit,
        price: offerAmount,
        priceType: 'manual',
      };

      const offerListing = await this.listingService.create(dto, phone);



      return this.msg(
        channel,
        `💰 *Offer Sent!*

` +
          `You offered ${this.formatPrice(offerAmount)} for ${targetListing.product}
` +
          `Farmer: ${targetListing.userName}
` +
          `Location: ${targetListing.userLocation}

` +
          `📋 Offer ID: ${offerListing._id}

` +
          `The farmer has been notified. They will contact you if interested.

` +
          `🏪 Type HELP for more options.`
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
      return this.msg(channel, `❌ No pending requests. Type HELP for options.`);
    }

    const buyer = await this.usersService.findByPhone(pending.buyerPhone);
    pendingFarmerResponses.delete(phone);

    if (response.toUpperCase() === 'YES') {
      await this.listingService.update(pending.sellerListingId, { status: 'matched' });
      await this.listingService.update(pending.buyerListingId, { status: 'matched' });

      if (buyer?.phone) {
        const buyerMsg = `✅ *Great News!*

` +
          `👨‍🌾 ${user.name} has accepted your request!

` +
          `🌽 Product: ${pending.product}
` +
          `📦 Quantity: ${pending.quantity} ${pending.unit}
` +
          `💰 Price: ${this.formatPrice(pending.price)}

` +
          `📍 Location: ${user.location}

` +
          `📞 Contact them at: ${user.phone}

` +
          `Happy trading! 🏪`;
        await this.metaSender.send(buyer.phone, buyerMsg);
      }

      return this.msg(channel,
        `✅ *Request Accepted!*

` +
        `You've connected with ${buyer?.name || 'the buyer'}.

` +
        `They have been notified and will contact you.

` +
        `Type HELP for more options.`
      );
    } else {
      if (buyer?.phone) {
        const buyerMsg = `😔 *Update*

` +
          `Unfortunately, ${user.name} declined your request for ${pending.product}.

` +
          `Type BUY to search for other farmers.`;
        await this.metaSender.send(buyer.phone, buyerMsg);
      }

      return this.msg(channel,
        `❌ *Request Declined*

` +
        `The buyer has been notified.

` +
        `Type HELP for more options.`
      );
    }
  }
}
