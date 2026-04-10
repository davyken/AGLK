import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { AiService } from '../ai/ai.service';

type Language = 'english' | 'french' | 'pidgin';

@Injectable()
export class RegistrationFlowService {
  constructor(
    private readonly usersService: UsersService,
    private readonly aiService: AiService,
  ) {}

  // ─── Main entry point ─────────────────────────────────────────────────────
  // Returns a reply string, or null to hand off to the main bot / listing flow.
  async handle(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string | null> {
    const user = await this.usersService.findByPhone(phone);

    // Already registered → update channel and hand off immediately
    if (user?.conversationState === 'REGISTERED') {
      await this.usersService.updateChannel(phone, channel);
      return null;
    }

    // ── Brand-new user ────────────────────────────────────────────────────────
    if (!user) {
      const lang: Language = await this.aiService.detectLanguage(text);
      return this.handleNewUser(phone, text, channel, lang);
    }

    // ── Returning user stuck in a legacy / mid-registration state ─────────────
    const savedLang: Language = (user as any).language ?? 'english';
    const tokens = text.trim().split(/\s+/);
    const longEnough = text.trim().length >= 8 && tokens.length >= 2;

    let activeLang = savedLang;
    if (longEnough) {
      const detectedLang: Language = await this.aiService.detectLanguage(text);
      if (detectedLang !== 'english' && detectedLang !== savedLang) {
        activeLang = detectedLang;
        await this.usersService.updateLanguage(phone, activeLang);
      }
    }

    await this.usersService.updateChannel(phone, channel);
    return this.resume(phone, text.trim(), user, activeLang);
  }

  // ─── New user — register silently and hand off ────────────────────────────
  // Extracts everything available from the first message.
  // Never blocks to ask for name or location.
  // If the message has an actionable intent (sell/buy/price) → returns null
  // so the listing flow handles it immediately on turn 1.
  private async handleNewUser(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
    lang: Language,
  ): Promise<string | null> {
    const parsed = await this.aiService.parseIntent(text);

    // Persist whatever the AI extracted — no required fields
    await this.usersService.createStub(phone, channel, lang);
    await this.usersService.update(phone, {
      name: parsed.name ?? 'unknown',
      role: 'user',
      location: parsed.location ?? 'unknown',
      conversationState: 'REGISTERED',   // always registered immediately
    });

    // Actionable intent → hand off silently; listing flow will process the message
    if (
      parsed.intent === 'sell' ||
      parsed.intent === 'buy' ||
      parsed.intent === 'price'
    ) {
      return null;
    }

    // Pure greeting or unclear → brief welcome, no questions
    return this.buildWelcomeMessage(parsed.name ?? null, lang);
  }

  // ─── Resume a user that is stuck mid-registration (legacy states) ─────────
  // Migrates them to REGISTERED immediately and hands off for actionable intent.
  private async resume(
    phone: string,
    input: string,
    user: any,
    lang: Language,
  ): Promise<string | null> {
    const state: string = user.conversationState;
    const parsed = await this.aiService.parseIntent(input);

    // Any message with a clear actionable intent → register and hand off
    if (
      parsed.intent === 'sell' ||
      parsed.intent === 'buy' ||
      parsed.intent === 'price'
    ) {
      // Absorb any newly-extracted name / location
      const updates: Record<string, any> = { conversationState: 'REGISTERED' };
      if (parsed.name && parsed.name !== 'unknown') updates.name = parsed.name;
      if (parsed.location) updates.location = parsed.location;
      await this.usersService.update(phone, updates);
      return null;
    }

    switch (state) {
      // ── AWAITING_NAME — treat input as the name, register, welcome ──────────
      case 'AWAITING_NAME': {
        const name = parsed.name ?? (input.length >= 2 ? input : null);
        await this.usersService.update(phone, {
          name: name ?? 'unknown',
          location: parsed.location ?? user.location ?? 'unknown',
          conversationState: 'REGISTERED',
        });
        return this.buildWelcomeMessage(name, lang);
      }

      // ── AWAITING_LOCATION — treat input as the location, register, welcome ──
      case 'AWAITING_LOCATION': {
        const location = parsed.location ?? (input.length >= 2 ? input : null);
        await this.usersService.update(phone, {
          location: location ?? 'unknown',
          conversationState: 'REGISTERED',
        });
        return this.buildWelcomeMessage(user.name ?? null, lang);
      }

      // ── Legacy states — migrate immediately ──────────────────────────────────
      case 'AWAITING_ROLE':
      case 'AWAITING_PRODUCES':
      case 'AWAITING_BUSINESS':
      case 'AWAITING_NEEDS':
        await this.usersService.update(phone, { conversationState: 'REGISTERED' });
        return this.buildWelcomeMessage(user.name ?? null, lang);

      default:
        await this.usersService.update(phone, { conversationState: 'REGISTERED' });
        return null;
    }
  }

  // ─── Brief welcome — no questions, no instructions ────────────────────────
  private buildWelcomeMessage(name: string | null, lang: Language): string {
    const hasName = name && name !== 'unknown';
    const greet = hasName ? `, *${name}*` : '';

    if (lang === 'french') {
      return `Bienvenue sur AgroLink${greet} ! 👋\n\nVous souhaitez vendre de la récolte ou trouver quelque chose à acheter aujourd'hui ?`;
    }
    if (lang === 'pidgin') {
      return `Welcome to AgroLink${greet}! 👋\n\nYou wan sell something or you wan buy today?`;
    }
    return `Welcome to AgroLink${greet}! 👋\n\nWould you like to sell produce or find something to buy today?`;
  }
}
