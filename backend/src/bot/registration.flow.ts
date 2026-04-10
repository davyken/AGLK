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

  // ─── Main entry point ─────────────────────────────────────────
  // Returns the bot reply, or null if the user is already registered.
  async handle(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string | null> {
    const user = await this.usersService.findByPhone(phone);

    // Fully registered — hand off to main bot flow
    if (user?.conversationState === 'REGISTERED') {
      await this.usersService.updateChannel(phone, channel);
      return null;
    }

    // ── Brand-new user: detect language from first message ────────
    if (!user) {
      const lang: Language = await this.aiService.detectLanguage(text);
      return this.handleNewUser(phone, text, channel, lang);
    }

    // ── Returning mid-registration user ───────────────────────────
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

  // ─── New user: extract-first onboarding ───────────────────────
  // Extracts name and location from the first message. Only asks for
  // what's missing. No role question — intent is resolved per message.
  private async handleNewUser(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
    lang: Language,
  ): Promise<string> {
    const parsed = await this.aiService.parseIntent(text);

    const updates: Record<string, any> = {
      name: parsed.name ?? 'unknown',
      role: 'user',
      location: parsed.location ?? 'unknown',
    };

    const nextState = this.determineFirstMissingState(
      parsed.name ?? null,
      parsed.location ?? null,
    );
    updates.conversationState = nextState;

    await this.usersService.createStub(phone, channel, lang);
    await this.usersService.update(phone, updates);

    return this.generateFirstResponse(parsed, lang, nextState);
  }

  // ─── Determine which field to ask for next ─────────────────────
  private determineFirstMissingState(
    name: string | null,
    location: string | null,
  ): string {
    if (!name || name === 'unknown') return 'AWAITING_NAME';
    if (!location || location === 'unknown') return 'AWAITING_LOCATION';
    return 'REGISTERED';
  }

  // ─── Generate the first bot message for a new user ────────────
  private async generateFirstResponse(
    parsed: Awaited<ReturnType<AiService['parseIntent']>>,
    lang: Language,
    nextState: string,
  ): Promise<string> {
    const hasName = !!parsed.name;
    const hasLocation = !!parsed.location;

    // ── All required fields present → complete registration ───────
    if (nextState === 'REGISTERED') {
      return this.buildRegistrationComplete(parsed, lang);
    }

    // ── Partial extraction: acknowledge what we know, ask for ONE thing ──
    if (hasName || hasLocation || parsed.intent !== 'unknown') {
      const parts: string[] = [];

      if (lang === 'french') {
        if (hasName) parts.push(`Enchanté, *${parsed.name}* !`);
        if (hasLocation) parts.push(`Vous êtes à *${parsed.location}*.`);
        if (nextState === 'AWAITING_NAME') parts.push(`Comment vous appelez-vous ?`);
        else if (nextState === 'AWAITING_LOCATION') parts.push(`Dans quelle ville êtes-vous ?`);
      } else if (lang === 'pidgin') {
        if (hasName) parts.push(`How you dey, *${parsed.name}*!`);
        if (hasLocation) parts.push(`You dey for *${parsed.location}*.`);
        if (nextState === 'AWAITING_NAME') parts.push(`Wetin be your name?`);
        else if (nextState === 'AWAITING_LOCATION') parts.push(`Which town you dey?`);
      } else {
        if (hasName) parts.push(`Nice to meet you, *${parsed.name}*!`);
        if (hasLocation) parts.push(`You're in *${parsed.location}*.`);
        if (nextState === 'AWAITING_NAME') parts.push(`What's your name?`);
        else if (nextState === 'AWAITING_LOCATION') parts.push(`Which city or town are you in?`);
      }
      return parts.join('\n');
    }

    // Nothing extracted — standard welcome
    return await this.aiService.reply('welcome', lang, {});
  }

  // ─── Build the registration-complete welcome message ─────────
  private async buildRegistrationComplete(
    parsed: Awaited<ReturnType<AiService['parseIntent']>>,
    lang: Language,
  ): Promise<string> {
    const name = parsed.name ?? '';
    const location = parsed.location ?? '';
    const intent = parsed.intent;
    const product = parsed.product ?? '';

    // If the user came in with a clear intent, act on it immediately
    if (intent === 'sell' || intent === 'buy') {
      const action = intent === 'sell'
        ? {
            english: `Let me set up your listing`,
            french: `Je prépare votre annonce`,
            pidgin: `Make I set up your listing`,
          }
        : {
            english: `Let me search for sellers`,
            french: `Je cherche des vendeurs`,
            pidgin: `Make I find sellers for you`,
          };

      if (lang === 'french') {
        return `✅ Bienvenue${name ? `, *${name}*` : ''} !${location ? ` Vous êtes à *${location}*.` : ''}\n\n${action.french}${product ? ` de *${product}*` : ''}...`;
      }
      if (lang === 'pidgin') {
        return `✅ Welcome${name ? `, *${name}*` : ''}!${location ? ` You dey *${location}*.` : ''}\n\n${action.pidgin}${product ? ` for *${product}*` : ''}...`;
      }
      return `✅ Welcome${name ? `, *${name}*` : ''}!${location ? ` You're in *${location}*.` : ''}\n\n${action.english}${product ? ` for *${product}*` : ''}...`;
    }

    // Generic welcome — ask what they'd like to do
    if (lang === 'french') {
      return `✅ Bienvenue${name ? `, *${name}*` : ''} !${location ? ` Vous êtes à *${location}*.` : ''}\n\nVous voulez vendre des produits ou en acheter aujourd'hui ?`;
    }
    if (lang === 'pidgin') {
      return `✅ Welcome${name ? `, *${name}*` : ''}!${location ? ` You dey *${location}*.` : ''}\n\nYou wan sell something or buy something today?`;
    }
    return `✅ Welcome${name ? `, *${name}*` : ''}!${location ? ` You're in *${location}*.` : ''}\n\nWould you like to sell something or buy something today?`;
  }

  // ─── Resume from saved state ───────────────────────────────────
  private async resume(
    phone: string,
    input: string,
    user: any,
    lang: Language,
  ): Promise<string> {
    const state: string = user.conversationState;

    // Warm resume — if user re-greeted mid-registration
    const isGreeting = /^(hi|hello|bonjour|salut|bonsoir|hey|start|begin)$/i.test(input);
    if (isGreeting && state !== 'AWAITING_NAME') {
      return this.buildWarmResumeMessage(user, lang);
    }

    const parsed = await this.aiService.parseIntent(input);

    switch (state) {
      case 'AWAITING_NAME':
        return this.handleName(phone, input, parsed, lang);
      case 'AWAITING_LOCATION':
        return this.handleLocation(phone, input, parsed, lang);

      // Legacy states — migrate users forward gracefully
      case 'AWAITING_ROLE':
        // No longer collecting roles — store 'user' and advance to name
        await this.usersService.update(phone, { role: 'user', conversationState: 'AWAITING_NAME' });
        return await this.aiService.reply('ask_name', lang, {});
      case 'AWAITING_PRODUCES':
      case 'AWAITING_BUSINESS':
      case 'AWAITING_NEEDS':
        // Legacy states — complete registration immediately
        await this.usersService.update(phone, { conversationState: 'REGISTERED' });
        return await this.aiService.reply('registered_farmer', lang, { name: user.name ?? '' });

      default:
        return await this.aiService.reply('unknown_command', lang, {});
    }
  }

  // ─── Warm resume message ──────────────────────────────────────
  private buildWarmResumeMessage(user: any, lang: Language): string {
    const name = user.name && user.name !== 'unknown' ? user.name : null;
    const state: string = user.conversationState;

    const missing: Record<string, Record<Language, string>> = {
      AWAITING_NAME: {
        english: 'your name',
        french: 'votre nom',
        pidgin: 'your name',
      },
      AWAITING_LOCATION: {
        english: 'your location',
        french: 'votre localité',
        pidgin: 'your town',
      },
    };

    const what = missing[state]?.[lang] ?? 'one more detail';

    if (lang === 'french') {
      return `Bon retour${name ? `, *${name}*` : ''} ! Vous étiez en train de vous inscrire — il reste juste *${what}*.\n\nQu'est-ce que c'est ?`;
    }
    if (lang === 'pidgin') {
      return `Welcome back${name ? `, *${name}*` : ''}! We just need *${what}* from you. Go ahead!`;
    }
    return `Welcome back${name ? `, *${name}*` : ''}! Just need *${what}* to finish — go ahead!`;
  }

  // ─── Step 1: Name ─────────────────────────────────────────────
  private async handleName(
    phone: string,
    input: string,
    parsed: Awaited<ReturnType<AiService['parseIntent']>>,
    lang: Language,
  ): Promise<string> {
    const name = parsed.name ?? input.trim();

    if (name.length < 2) {
      const errors: Record<Language, string> = {
        english: `Please enter your real name.`,
        french: `Veuillez entrer votre vrai nom.`,
        pidgin: `Abeg put your real name.`,
      };
      return errors[lang];
    }

    const updates: Record<string, any> = { name };

    // If location was also in this message, store it and register immediately
    if (parsed.location) {
      updates.location = parsed.location;
      updates.conversationState = 'REGISTERED';
      await this.usersService.update(phone, updates);
      return await this.buildRegistrationComplete(parsed, lang);
    }

    updates.conversationState = 'AWAITING_LOCATION';
    await this.usersService.update(phone, updates);
    return await this.aiService.reply('ask_location', lang, {});
  }

  // ─── Step 2: Location ─────────────────────────────────────────
  private async handleLocation(
    phone: string,
    input: string,
    parsed: Awaited<ReturnType<AiService['parseIntent']>>,
    lang: Language,
  ): Promise<string> {
    const location = parsed.location ?? input.trim();

    if (location.length < 2) {
      const errors: Record<Language, string> = {
        english: `Please enter your city or town name.`,
        french: `Veuillez entrer le nom de votre ville.`,
        pidgin: `Tell us which town you dey.`,
      };
      return errors[lang];
    }

    const userUpdated = await this.usersService.update(phone, {
      location,
      conversationState: 'REGISTERED',
    });

    return await this.buildRegistrationComplete({ ...parsed, name: userUpdated.name, location }, lang);
  }
}
