import { Injectable } from '@nestjs/common';
import { ListingService } from '../listing/listing.service';
import { UsersService } from '../users/users.service';
import { CreateListingDto } from '../dto/listing.dto';

@Injectable()
export class ListingFlowService {
  constructor(
    private readonly listingService: ListingService,
    private readonly usersService: UsersService,
  ) {}

  async handle(
    phone: string,
    command: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    // Parse the command: "SELL maize 10 bags" or "BUY maize 20 bags"
    const parsed = this.parseListingCommand(command);

    if (!parsed) {
      return this.msg(
        channel,
        `❌ Invalid format.\n\nUse: SELL maize 10 bags\nor: BUY maize 20 bags`,
      );
    }

    try {
      // Get user details for the listing
      const user = await this.usersService.findByPhone(phone);

      if (!user || user.conversationState !== 'REGISTERED') {
        return this.msg(
          channel,
          `❌ You need to register first.\n\nReply Hi to start registration.`,
        );
      }

      // Validate user role matches command type
      if (parsed.type === 'sell' && user.role !== 'farmer') {
        return this.msg(
          channel,
          `❌ Only farmers can sell. You are registered as a ${user.role}.`,
        );
      }

      if (parsed.type === 'buy' && user.role !== 'buyer') {
        return this.msg(
          channel,
          `❌ Only buyers can buy. You are registered as a ${user.role}.`,
        );
      }

      // Create the listing
      const dto: CreateListingDto = {
        type: parsed.type,
        product: parsed.product,
        quantity: parsed.quantity,
        unit: parsed.unit,
      };

      const listing = await this.listingService.create(dto, phone);

      // Format confirmation message
      const typeEmoji = parsed.type === 'sell' ? '🌽' : '🛒';
      const roleEmoji = parsed.type === 'sell' ? '👨‍🌾' : '🏪';

      return this.msg(
        channel,
        `${typeEmoji} *${parsed.type.toUpperCase()} Listing Created!*\n\n` +
          `Product: ${listing.product}\n` +
          `Quantity: ${listing.quantity} ${listing.unit}\n` +
          `Location: ${listing.location}\n\n` +
          `📋 Listing ID: ${listing._id}\n\n` +
          `${roleEmoji} Type HELP for more options.`,
      );
    } catch (error) {
      console.error('Listing creation error:', error);
      return this.msg(
        channel,
        `❌ Failed to create listing. Please try again or type HELP for options.`,
      );
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

    // Product is everything between type and quantity
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

  private msg(channel: 'sms' | 'whatsapp', message: string): string {
    if (channel === 'sms') {
      return message
        .replace(/[\u{1F300}-\u{1FFFF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}]/gu, '')
        .replace(/\*/g, '')
        .trim();
    }
    return message;
  }
}
