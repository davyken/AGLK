import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AiService } from '../ai/ai.service';

type Language = 'english' | 'french' | 'pidgin';

@Injectable()
export class RegistrationFlowService {
  resumeMessage(phone: string, arg1: string, channel: string) {
    throw new Error('Method not implemented.');
  }
  constructor(
    private readonly usersService: UsersService,
    private readonly aiService: AiService,
  ) {}

  // ─── Main entry point ─────────────────────────────────────
  async handle(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string | null> {
    const user = await this.usersService.findByPhone(phone);

    // Fully registered → hand off to main bot
    if (user?.conversationState === 'REGISTERED') {
      await this.usersService.updateChannel(phone, channel);
      return null;
    }

    // Detect language from message
    const parsed = await this.aiService.parseIntent(text);
    const lang: Language = parsed.language ?? 'english';

    // Brand new user
    if (!user) {
      await this.usersService.createStub(phone, channel, lang);
      return this.aiService.reply('welcome', lang, {});
    }

    // Resume registration
    await this.usersService.updateChannel(phone, channel);
    const savedLang = (user as any).language ?? lang;
    return this.resume(phone, text.trim(), user.conversationState, savedLang);
  }

  // ─── Resume from saved state ──────────────────────────────
  private async resume(
    phone: string,
    input: string,
    state: string,
    lang: Language,
  ): Promise<string> {
    switch (state) {
      case 'AWAITING_ROLE':     return this.handleRole(phone, input, lang);
      case 'AWAITING_NAME':     return this.handleName(phone, input, lang);
      case 'AWAITING_LOCATION': return this.handleLocation(phone, input, lang);
      case 'AWAITING_PRODUCES': return this.handleProduces(phone, input, lang);
      case 'AWAITING_BUSINESS': return this.handleBusiness(phone, input, lang);
      case 'AWAITING_NEEDS':    return this.handleNeeds(phone, input, lang);
      default:
        return this.aiService.reply('unknown_command', lang, {});
    }
  }

  // ─── Step 1: Role ─────────────────────────────────────────
  private async handleRole(
    phone: string,
    input: string,
    lang: Language,
  ): Promise<string> {
    // Accept: 1, 2, farmer, buyer, agriculteur, acheteur, I dey sell, etc.
    const farmerKeywords = ['1', 'farmer', 'agriculteur', 'sell', 'vend', 'farm'];
    const buyerKeywords  = ['2', 'buyer', 'acheteur', 'buy', 'achet', 'buy'];

    const lower = input.toLowerCase();
    const isFarmer = farmerKeywords.some((k) => lower.includes(k));
    const isBuyer  = buyerKeywords.some((k) => lower.includes(k));

    if (!isFarmer && !isBuyer) {
      // Use AI to detect intent
      const parsed = await this.aiService.parseIntent(input);
      if (parsed.intent !== 'register') {
        const errorMsgs: Record<Language, string> = {
          english: '❌ Please reply 1 for Farmer or 2 for Buyer.',
          french:  '❌ Veuillez répondre 1 pour Agriculteur ou 2 pour Acheteur.',
          pidgin:  '❌ Send 1 if you be Farmer, 2 if you be Buyer.',
        };
        return errorMsgs[lang];
      }
    }

    const role = isBuyer ? 'buyer' : 'farmer';

    await this.usersService.update(phone, {
      role,
      conversationState: 'AWAITING_NAME',
    });

    return this.aiService.reply('ask_name', lang, {});
  }

  // ─── Step 2: Name ─────────────────────────────────────────
  private async handleName(
    phone: string,
    input: string,
    lang: Language,
  ): Promise<string> {
    if (input.length < 2) {
      const errorMsgs: Record<Language, string> = {
        english: '❌ Please enter a valid name.',
        french:  '❌ Veuillez entrer un nom valide.',
        pidgin:  '❌ Put your real name abeg.',
      };
      return errorMsgs[lang];
    }

    await this.usersService.update(phone, {
      name: input,
      conversationState: 'AWAITING_LOCATION',
    });

    return this.aiService.reply('ask_location', lang, {});
  }

  // ─── Step 3: Location ─────────────────────────────────────
  private async handleLocation(
    phone: string,
    input: string,
    lang: Language,
  ): Promise<string> {
    if (input.length < 2) {
      const errorMsgs: Record<Language, string> = {
        english: '❌ Please enter a valid location.',
        french:  '❌ Veuillez entrer une localité valide.',
        pidgin:  '❌ Tell us which side you dey.',
      };
      return errorMsgs[lang];
    }

    const user = await this.usersService.findByPhone(phone);

    await this.usersService.update(phone, {
      location: input,
      conversationState:
        user?.role === 'farmer' ? 'AWAITING_PRODUCES' : 'AWAITING_BUSINESS',
    });

    return user?.role === 'farmer'
      ? this.aiService.reply('ask_produces', lang, {})
      : this.aiService.reply('ask_business', lang, {});
  }

  // ─── Step 4a: FARMER — Produces ──────────────────────────
  private async handleProduces(
    phone: string,
    input: string,
    lang: Language,
  ): Promise<string> {
    const produces = input
      .split(/[,،،]/)
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0);

    if (produces.length === 0) {
      const errorMsgs: Record<Language, string> = {
        english: '❌ Please list at least one product.',
        french:  '❌ Veuillez lister au moins un produit.',
        pidgin:  '❌ List at least one thing wey you dey farm.',
      };
      return errorMsgs[lang];
    }

    const user = await this.usersService.update(phone, {
      produces,
      conversationState: 'REGISTERED',
    });

    return this.aiService.reply('registered_farmer', lang, { name: user.name });
  }

  // ─── Step 4b: BUYER — Business ────────────────────────────
  private async handleBusiness(
    phone: string,
    input: string,
    lang: Language,
  ): Promise<string> {
    if (input.length < 2) {
      const errorMsgs: Record<Language, string> = {
        english: '❌ Please enter a valid business name.',
        french:  '❌ Veuillez entrer un nom d\'entreprise valide.',
        pidgin:  '❌ Put your business name abeg.',
      };
      return errorMsgs[lang];
    }

    await this.usersService.update(phone, {
      businessName: input,
      conversationState: 'AWAITING_NEEDS',
    });

    return this.aiService.reply('ask_needs', lang, {});
  }

  // ─── Step 5b: BUYER — Needs ───────────────────────────────
  private async handleNeeds(
    phone: string,
    input: string,
    lang: Language,
  ): Promise<string> {
    const needs = input
      .split(/[,،،]/)
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length > 0);

    if (needs.length === 0) {
      const errorMsgs: Record<Language, string> = {
        english: '❌ Please list at least one product.',
        french:  '❌ Veuillez lister au moins un produit.',
        pidgin:  '❌ List at least one thing wey you need.',
      };
      return errorMsgs[lang];
    }

    const user = await this.usersService.update(phone, {
      needs,
      conversationState: 'REGISTERED',
    });

    return this.aiService.reply('registered_buyer', lang, { name: user.name });
  }
}