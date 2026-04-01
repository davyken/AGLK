import { Injectable } from '@nestjs/common';
import { ListingService } from '../listing/listing.service';
import { UsersService } from '../users/users.service';
import { CreateListingDto } from '../dto/listing.dto';
import { PriceService } from '../price/price.service';

// Simple in-memory store for price conversation state
// In production, this should be in Redis or database
const pendingPriceListings = new Map<
  string,
  {
    type: 'sell';
    product: string;
    quantity: number;
    unit: string;
    userPhone: string;
    userRole: string;
  }
>();

@Injectable()
export class ListingFlowService {
  constructor(
    private readonly listingService: ListingService,
    private readonly usersService: UsersService,
    private readonly priceService: PriceService,
  ) {}

  async handle(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const input = text.trim();

    // ── Check if user is in pending price state ─────────────────
    if (pendingPriceListings.has(phone)) {
      return this.handlePriceResponse(phone, input, channel);
    }

    // ── New SELL command ───────────────────────────────────────
    if (input.toUpperCase().startsWith('SELL')) {
      return this.handleSellCommand(phone, input, channel);
    }

    // ── New BUY command ────────────────────────────────────────
    if (input.toUpperCase().startsWith('BUY')) {
      return this.handleBuyCommand(phone, input, channel);
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
      pendingPriceListings.set(phone, {
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
          `*Suggested: ${this.formatPrice(priceData.suggested)}*\n\n` +
          `What would you like to do?\n` +
          `1️⃣ Accept suggested price (${this.formatPrice(priceData.suggested)})\n` +
          `2️⃣ Set custom price\n\n` +
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

      // For BUY, create listing directly (buyers set their own price)
      const dto: CreateListingDto = {
        type: 'buy',
        product: parsed.product,
        quantity: parsed.quantity,
        unit: parsed.unit,
        priceType: 'manual',
      };

      const listing = await this.listingService.create(dto, phone);

      return this.msg(
        channel,
        `🛒 *BUY Listing Created!*\n\n` +
          `Product: ${listing.product}\n` +
          `Quantity: ${listing.quantity} ${listing.unit}\n` +
          `Location: ${listing.location}\n\n` +
          `📋 Listing ID: ${listing._id}\n\n` +
          `🏪 Type HELP for more options.`,
      );
    } catch (error) {
      console.error('Buy command error:', error);
      return this.msg(
        channel,
        `❌ Failed to create listing. Please try again.`,
      );
    }
  }

  private async handlePriceResponse(
    phone: string,
    response: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const pending = pendingPriceListings.get(phone);
    if (!pending) {
      return this.msg(channel, `❌ No pending listing. Start fresh with SELL command.`);
    }

    const input = response.trim().toLowerCase();

    // Option 1: Accept suggested price
    if (input === '1') {
      try {
        const priceData = await this.priceService.getPrice(pending.product);
        
        if (!priceData) {
          pendingPriceListings.delete(phone);
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

        pendingPriceListings.delete(phone);

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
        pendingPriceListings.delete(phone);
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
        
        if (!priceData) {
          pendingPriceListings.delete(phone);
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
          price: customPrice,
          priceType: 'manual',
        };

        const listing = await this.listingService.create(dto, phone);

        pendingPriceListings.delete(phone);

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
        pendingPriceListings.delete(phone);
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

  // Check if user is in pending price state
  isInPriceState(phone: string): boolean {
    return pendingPriceListings.has(phone);
  }
}
