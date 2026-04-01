import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';

@Injectable()
export class RegistrationFlowService {
  constructor(private readonly usersService: UsersService) {}

  // ─── Main entry point called by BotService ────────────────
  async handle(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string | null> {
    const input = text.trim();

    const user = await this.usersService.findByPhone(phone);

    // ── Fully registered → return null → BotService handles ──
    if (user?.conversationState === 'REGISTERED') {
      await this.usersService.updateChannel(phone, channel);
      return null;
    }

    // ── Brand new user → create stub record immediately ───────
    if (!user) {
      await this.usersService.createStub(phone, channel);
      return this.msg(
        channel,
        `👋 Welcome to AGRO-LINK!\n\nAre you a:\n1️⃣ Farmer (I sell produce)\n2️⃣ Buyer (I buy produce)\n\nReply 1 or 2`,
      );
    }

    // ── Existing user mid-registration → resume ───────────────
    await this.usersService.updateChannel(phone, channel);
    return this.resume(phone, input, user.conversationState, channel);
  }

  // ─── Resume from saved state ──────────────────────────────
  private async resume(
    phone: string,
    input: string,
    state: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    switch (state) {
      case 'AWAITING_ROLE':     return this.handleRole(phone, input, channel);
      case 'AWAITING_NAME':     return this.handleName(phone, input, channel);
      case 'AWAITING_LOCATION': return this.handleLocation(phone, input, channel);
      case 'AWAITING_PRODUCES': return this.handleProduces(phone, input, channel);
      case 'AWAITING_BUSINESS': return this.handleBusiness(phone, input, channel);
      case 'AWAITING_NEEDS':    return this.handleNeeds(phone, input, channel);
      default:
        return this.msg(channel, '❌ Something went wrong. Reply Hi to restart.');
    }
  }

  // ─── Step 1: Role ─────────────────────────────────────────
  private async handleRole(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    if (!['1', '2', 'farmer', 'buyer'].includes(input.toLowerCase())) {
      return this.msg(channel, '❌ Please reply 1 for Farmer or 2 for Buyer.');
    }

    const role =
      input === '1' || input.toLowerCase() === 'farmer' ? 'farmer' : 'buyer';

    await this.usersService.update(phone, {
      role,
      conversationState: 'AWAITING_NAME',
    });

    return this.msg(channel, `What is your full name?`);
  }

  // ─── Step 2: Name ─────────────────────────────────────────
  private async handleName(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    if (input.length < 2) {
      return this.msg(channel, '❌ Please enter a valid name.');
    }

    await this.usersService.update(phone, {
      name: input,
      conversationState: 'AWAITING_LOCATION',
    });

    return this.msg(channel, `📍 What is your location? (e.g. Yaoundé, Bafoussam)`);
  }

  // ─── Step 3: Location ─────────────────────────────────────
  private async handleLocation(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    if (input.length < 2) {
      return this.msg(channel, '❌ Please enter a valid location.');
    }

    const user = await this.usersService.findByPhone(phone);

    await this.usersService.update(phone, {
      location: input,
      conversationState:
        user?.role === 'farmer' ? 'AWAITING_PRODUCES' : 'AWAITING_BUSINESS',
    });

    if (user?.role === 'farmer') {
      return this.msg(
        channel,
        `🌱 What do you grow? Separate by commas.\n\nExample: maize, cassava, tomatoes`,
      );
    }

    return this.msg(channel, `🏪 What is your business name?`);
  }

  // ─── Step 4a: FARMER — Produces ──────────────────────────
  private async handleProduces(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const produces = input
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0);

    if (produces.length === 0) {
      return this.msg(channel, '❌ Please list at least one product.');
    }

    const user = await this.usersService.update(phone, {
      produces,
      conversationState: 'REGISTERED',
    });

    return this.msg(
      channel,
      `✅ You are registered as a Farmer!\n\nWelcome ${user.name} 👨‍🌾\n\nTo list produce, type:\nSELL maize 10 bags\n\nType HELP anytime for options.`,
    );
  }

  // ─── Step 4b: BUYER — Business name ──────────────────────
  private async handleBusiness(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    if (input.length < 2) {
      return this.msg(channel, '❌ Please enter a valid business name.');
    }

    await this.usersService.update(phone, {
      businessName: input,
      conversationState: 'AWAITING_NEEDS',
    });

    return this.msg(
      channel,
      `🛒 What products do you need? Separate by commas.\n\nExample: maize, tomatoes, plantain`,
    );
  }

  // ─── Step 5b: BUYER — Needs ───────────────────────────────
  private async handleNeeds(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const needs = input
      .split(',')
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length > 0);

    if (needs.length === 0) {
      return this.msg(channel, '❌ Please list at least one product.');
    }

    const user = await this.usersService.update(phone, {
      needs,
      conversationState: 'REGISTERED',
    });

    return this.msg(
      channel,
      `✅ You are registered as a Buyer!\n\nWelcome ${user.name} 🏪\n\nTo find produce, type:\nBUY maize 20 bags\n\nType HELP anytime for options.`,
    );
  }

  // ─── Format message per channel ──────────────────────────
  private msg(channel: 'sms' | 'whatsapp', message: string): string {
    if (channel === 'sms') {
      return message
        .replace(/[\u{1F300}-\u{1FFFF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}]/gu, '')
        .trim();
    }
    return message;
  }
}