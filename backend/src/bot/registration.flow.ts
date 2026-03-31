import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';

// Temporary in-memory store for partial registration data
// Keyed by phone number — cleared once user is fully registered
const registrationCache = new Map<string, Record<string, string>>();

@Injectable()
export class RegistrationFlowService {
  constructor(private readonly usersService: UsersService) {}

  // ─── Main entry point called by BotService ────────────────
  // Returns the reply text to send back to the user
  async handle(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    const input = text.trim();

    // Always update last channel used if user already exists
    const existingUser = await this.usersService.findByPhone(phone);

    if (existingUser) {
      await this.usersService.updateChannel(phone, channel);

      // If fully registered, hand off to main bot flow
      if (existingUser.conversationState === 'REGISTERED') {
        return ""; // signals BotService to continue to main menu
      }

      // Resume interrupted registration
      return this.resume(phone, input, existingUser.conversationState, channel);
    }

    // Brand new user — start registration
    return this.startRegistration(phone, channel);
  }

  // ─── Step 0: First contact ────────────────────────────────
  private async startRegistration(
    phone: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    // Create a stub user record with just the phone
    await this.usersService.update(phone, {
      lastChannelUsed: channel,
      conversationState: 'AWAITING_ROLE',
    }).catch(async () => {
      // User doesn't exist yet — seed the cache only
    });

    registrationCache.set(phone, { channel });

    return this.msg(
      channel,
      `👋 Welcome to FarmerConnect!\n\nAre you a:\n1️⃣ Farmer (I sell produce)\n2️⃣ Buyer (I buy produce)\n\nReply 1 or 2`,
    );
  }

  // ─── Resume from current state ────────────────────────────
  private async resume(
    phone: string,
    input: string,
    state: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    switch (state) {
      case 'AWAITING_ROLE':
        return this.handleRole(phone, input, channel);
      case 'AWAITING_NAME':
        return this.handleName(phone, input, channel);
      case 'AWAITING_LOCATION':
        return this.handleLocation(phone, input, channel);
      case 'AWAITING_PRODUCES':
        return this.handleProduces(phone, input, channel);
      case 'AWAITING_BUSINESS':
        return this.handleBusiness(phone, input, channel);
      case 'AWAITING_NEEDS':
        return this.handleNeeds(phone, input, channel);
      default:
        return this.msg(channel, '❌ Something went wrong. Reply Hi to restart.');
    }
  }

  // ─── Step 1: Role selection ───────────────────────────────
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

    const cache = registrationCache.get(phone) ?? {};
    registrationCache.set(phone, { ...cache, role });

    await this.usersService.update(phone, {
      conversationState: 'AWAITING_NAME',
    }).catch(() => {});

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

    const cache = registrationCache.get(phone) ?? {};
    registrationCache.set(phone, { ...cache, name: input });

    await this.usersService.update(phone, {
      conversationState: 'AWAITING_LOCATION',
    }).catch(() => {});

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

    const cache = registrationCache.get(phone) ?? {};
    registrationCache.set(phone, { ...cache, location: input });

    const role = cache.role;

    if (role === 'farmer') {
      await this.usersService.update(phone, {
        conversationState: 'AWAITING_PRODUCES',
      }).catch(() => {});

      return this.msg(
        channel,
        `🌱 What do you grow? List your produce separated by commas.\n\nExample: maize, cassava, tomatoes`,
      );
    }

    // Buyer path
    await this.usersService.update(phone, {
      conversationState: 'AWAITING_BUSINESS',
    }).catch(() => {});

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

    const cache = registrationCache.get(phone) ?? {};

    // All data collected — create the user
    await this.usersService.create({
      phone,
      name: cache.name,
      role: 'farmer',
      location: cache.location,
      preferredChannel: cache.channel as 'sms' | 'whatsapp',
      lastChannelUsed: cache.channel as 'sms' | 'whatsapp',
      produces,
    });

    registrationCache.delete(phone);

    return this.msg(
      channel,
      `✅ You are registered as a Farmer!\n\nWelcome ${cache.name} 👨‍🌾\n\nTo list produce, type:\nSELL maize 10 bags\n\nType HELP anytime for options.`,
    );
  }

  // ─── Step 4b: BUYER — Business Name ──────────────────────
  private async handleBusiness(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string> {
    if (input.length < 2) {
      return this.msg(channel, '❌ Please enter a valid business name.');
    }

    const cache = registrationCache.get(phone) ?? {};
    registrationCache.set(phone, { ...cache, businessName: input });

    await this.usersService.update(phone, {
      conversationState: 'AWAITING_NEEDS',
    }).catch(() => {});

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

    const cache = registrationCache.get(phone) ?? {};

    // All data collected — create the user
    await this.usersService.create({
      phone,
      name: cache.name,
      role: 'buyer',
      location: cache.location,
      preferredChannel: cache.channel as 'sms' | 'whatsapp',
      lastChannelUsed: cache.channel as 'sms' | 'whatsapp',
      businessName: cache.businessName,
      needs,
    });

    registrationCache.delete(phone);

    return this.msg(
      channel,
      `✅ You are registered as a Buyer!\n\nWelcome ${cache.name} 🏪\n\nTo find produce, type:\nBUY maize 20 bags\n\nType HELP anytime for options.`,
    );
  }

  // ─── Format message based on channel ─────────────────────
  // SMS: keep it short and plain (no emojis heavy)
  // WhatsApp: full formatting
  private msg(channel: 'sms' | 'whatsapp', message: string): string {
    if (channel === 'sms') {
      // Strip emojis for SMS
      return message.replace(
        /[\u{1F300}-\u{1FFFF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}]/gu,
        '',
      ).trim();
    }
    return message;
  }
}