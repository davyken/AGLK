import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegistrationFlowService } from './registration.flow';
import { ListingFlowService } from './listing.flow';

export interface IncomingMessage {
  phone: string;
  text: string;
  channel: 'sms' | 'whatsapp';
}

@Injectable()
export class BotService {
  constructor(
    private readonly usersService: UsersService,
    private readonly registrationFlow: RegistrationFlowService,
    private readonly listingFlow: ListingFlowService,
  ) {}

  async handleMessage(msg: IncomingMessage): Promise<string> {
    const { phone, text, channel } = msg;
    const input = text.trim().toUpperCase();

    // ── HELP command (works at any stage) ─────────────────
    if (input === 'HELP') {
      return this.helpMessage(channel);
    }

    // ── Check if user is registered ───────────────────────
    const user = await this.usersService.findByPhone(phone);

    const isRegistered = user?.conversationState === 'REGISTERED';

    // ── Not registered or mid-registration → registration flow
    if (!user || !isRegistered) {
      const reply = await this.registrationFlow.handle(phone, text, channel);
      // Handle edge case where registration flow returns null unexpectedly
      if (!reply) {
        return this.helpMessage(channel);
      }
      return reply;
    }

    // ── Registered → main command router ──────────────────
    await this.usersService.updateChannel(phone, channel);

    // Check if user is in pending price state (waiting for price choice)
    if (this.listingFlow.isInPriceState(phone)) {
      return this.listingFlow.handle(phone, text, channel);
    }

    if (input.startsWith('SELL')) {
      return await this.listingFlow.handle(phone, text, channel);
    }

    if (input.startsWith('BUY')) {
      return await this.listingFlow.handle(phone, text, channel);
    }

    if (input.startsWith('OFFER')) {
      return await this.listingFlow.handle(phone, text, channel);
    }

    // YES/NO response from farmer - check if they have pending interest
    if (input === 'YES' || input === 'NO') {
      return this.listingFlow.handleFarmerResponse(phone, input, channel);
    }

    // ── Unrecognised command ───────────────────────────────
    return this.unknownCommand(user.role, channel);
  }

  // ─── HELP message ────────────────────────────────────────
  private helpMessage(channel: 'sms' | 'whatsapp'): string {
    if (channel === 'sms') {
      return [
        'FarmerConnect Help:',
        'SELL maize 10 bags',
        'BUY maize 20 bags',
        'BUY maize 20 bags @yaounde (filter by city)',
        'BUY maize 20 bags #10000-20000 (filter by price)',
        'HELP - show this menu',
      ].join('\n');
    }

    return [
      '📋 *FarmerConnect Help*',
      '',
      '👨‍🌾 *Farmer commands:*',
      'SELL maize 10 bags',
      '  Then send an image of your product!',
      '',
      '🏪 *Buyer commands:*',
      'BUY maize 20 bags',
      'BUY maize 20 bags @yaounde (filter by city)',
      'BUY maize 20 bags #10000-20000 (price range)',
      'BUY maize 20 bags @yaounde #15000-25000 (city + price)',
      '',
      '💡 *Tips:*',
      '- Use @ before city name to filter by location',
      '- Use #min-max for price range (e.g. #10000-20000)',
      '- Add an image when selling to attract buyers!',
      '',
      'Reply HELP anytime to see this menu.',
    ].join('\n');
  }

  private unknownCommand(role: string, channel: 'sms' | 'whatsapp'): string {
    if (channel === 'sms') {
      return role === 'farmer'
        ? 'Unknown command. Try: SELL maize 10 bags'
        : 'Unknown command. Try: BUY maize 20 bags';
    }

    return role === 'farmer'
      ? `❓ Unknown command.\n\nTry:\nSELL maize 10 bags\n\nType HELP for all options.`
      : `❓ Unknown command.\n\nTry:\nBUY maize 20 bags\n\nType HELP for all options.`;
  }
}