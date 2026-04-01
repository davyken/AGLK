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

    if (input.startsWith('SELL')) {
      return await this.listingFlow.handle(phone, text, channel);
    }

    if (input.startsWith('BUY')) {
      return await this.listingFlow.handle(phone, text, channel);
    }

    if (input === 'YES' || input === 'NO') {
      // → Hand off to MatchingFlow (Person 3 builds this)
      return `🤝 Matching response noted: ${text}`;
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
        'HELP - show this menu',
      ].join('\n');
    }

    return [
      '📋 *FarmerConnect Help*',
      '',
      '👨‍🌾 *Farmer commands:*',
      'SELL maize 10 bags',
      '',
      '🏪 *Buyer commands:*',
      'BUY maize 20 bags',
      '',
      'Reply HELP anytime to see this menu.',
    ].join('\n');
  }

  // ─── Unknown command ──────────────────────────────────────
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