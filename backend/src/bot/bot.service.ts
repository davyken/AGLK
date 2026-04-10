import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegistrationFlowService } from '../bot/registration.flow';
import { ListingFlowService } from '../bot/listing.flow';
import { AiService, Language, ParsedIntent } from '../ai/ai.service';

export interface IncomingMessage {
  phone: string;
  text: string;
  channel: 'sms' | 'whatsapp';
}

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);

  constructor(
    private readonly usersService: UsersService,
    private readonly registrationFlow: RegistrationFlowService,
    private readonly listingFlow: ListingFlowService,
    private readonly aiService: AiService,
  ) {}

  async handleMessage(msg: IncomingMessage): Promise<string> {
    const { phone, text, channel } = msg;
    const trimmed = text.trim();
    const upper = trimmed.toUpperCase();
    const normalized = this.normalizeCommand(upper);

    const user = await this.usersService.findByPhone(phone);
    const isRegistered = user?.conversationState === 'REGISTERED';

    // ── Resolve language ──────────────────────────────────────
    const detectedLang: Language = await this.aiService.detectLanguage(trimmed);
    const savedLang: Language = (user as any)?.language ?? 'english';
    // Only override saved language if detection is confident (not plain English
    // which is often a false positive for short messages).
    const lang: Language =
      detectedLang !== 'english' ? detectedLang : savedLang;

    if (user && lang !== savedLang) {
      await this.usersService.updateLanguage(phone, lang);
    }

    // ── Explicit language-switch commands ─────────────────────
    if (
      normalized.includes('LANG_ENGLISH') ||
      (normalized.includes('ENGLISH') && normalized.includes('LANG'))
    ) {
      return this.handleLanguageSwitch(phone, 'english', lang);
    }
    if (
      normalized.includes('LANG_FRENCH') ||
      (normalized.includes('FRENCH') && normalized.includes('LANG'))
    ) {
      return this.handleLanguageSwitch(phone, 'french', lang);
    }
    if (
      normalized.includes('LANG_PIDGIN') ||
      (normalized.includes('PIDGIN') && normalized.includes('LANG'))
    ) {
      return this.handleLanguageSwitch(phone, 'pidgin', lang);
    }
    if (
      normalized === 'LANGUAGE' ||
      normalized === 'LANG' ||
      normalized === 'LANGUE' ||
      normalized.startsWith('LANGUAGE ') ||
      normalized.startsWith('LANGUE ')
    ) {
      return this.handleLanguageMenu(phone, trimmed, lang);
    }

    // ── Global shortcuts that work at any state ───────────────
    if (normalized === 'HELP' || normalized === 'AIDE') {
      return this.helpMessage(channel, lang, user?.name);
    }

    if (normalized === 'CANCEL' || normalized === 'ANNULER') {
      if (this.listingFlow.isInPriceState(phone)) {
        return this.listingFlow.handle(phone, 'CANCEL', channel);
      }
      const msgs: Record<Language, string> = {
        english: `Nothing to cancel. Type HELP for options.`,
        french: `Rien à annuler. Tapez AIDE pour les options.`,
        pidgin: `Nothing dey cancel. Type HELP.`,
      };
      return msgs[lang];
    }

    // ── Not yet registered → registration flow handles everything ──
    if (!user || !isRegistered) {
      const reply = await this.registrationFlow.handle(phone, trimmed, channel);
      if (reply) return reply;
      // Registration just completed — fall through to greet them
    }

    await this.usersService.updateChannel(phone, channel);

    // ── Pending listing state — resume it first ───────────────
    // (check in-memory Map; listing flow syncs to DB on every change)
    if (this.listingFlow.isInPriceState(phone)) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    // ── Pending farmer YES/NO/counter response ─────────────────
    if (this.listingFlow.hasPendingFarmerResponse(phone)) {
      return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
    }

    // ── Greeting from a registered user ───────────────────────
    const isGreeting = [
      'HI',
      'HELLO',
      'BONJOUR',
      'SALUT',
      'HEY',
      'START',
      'BONSOIR',
    ].includes(upper);
    if (isGreeting) {
      return this.handleRegisteredGreeting(user, lang, channel);
    }

    // ── Explicit keyword-prefix commands (fast path, no LLM) ─
    if (
      normalized.startsWith('SELL') ||
      upper.startsWith('I GET') ||
      upper.startsWith('I WAN SELL') ||
      upper.startsWith('I DEY SELL') ||
      upper.includes('FOR SELL') ||
      upper.startsWith('VND') ||
      upper.startsWith('VEND ')
    ) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    if (
      normalized.startsWith('BUY') ||
      upper.startsWith('ACH ') ||
      upper.startsWith('I WAN BUY') ||
      upper.startsWith('I DEY FIND') ||
      upper.includes('FOR BUY') ||
      upper.startsWith('JE CHERCHE') ||
      upper.startsWith('JE VEUX')
    ) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    if (normalized.startsWith('OFFER') || upper.startsWith('OFFRE ')) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    // ── Role selection (during registration only) ─────────────
    if (normalized === '1' || normalized === '2') {
      if (!isRegistered) {
        const reply = await this.registrationFlow.handle(phone, trimmed, channel);
        if (reply) return reply;
      }
    }

    // ── YES / NO (context-sensitive fast path) ────────────────
    const isYes = ['YES', 'OUI', 'YES NA', 'NA SO', 'OK', 'OKAY', "D'ACCORD"].includes(upper);
    const isNo = ['NO', 'NON', 'NO BE DAT', 'NON MERCI', 'PAS DU TOUT', 'NOPE'].includes(upper);

    if (isYes || isNo) {
      if (
        this.listingFlow.hasPendingFarmerResponse(phone) ||
        this.listingFlow.isInPriceState(phone)
      ) {
        return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
      }
    }

    // ── AI intent parsing — handles all free-form natural language ──
    try {
      const parsed = await this.aiService.parseIntent(trimmed);

      // Route sell/buy through handleWithParsed — avoids a second LLM call
      if (parsed.intent === 'sell')
        return this.listingFlow.handleWithParsed(phone, trimmed, parsed, channel);
      if (parsed.intent === 'buy')
        return this.listingFlow.handleWithParsed(phone, trimmed, parsed, channel);
      if (parsed.intent === 'price')
        return this.listingFlow.handleWithParsed(phone, trimmed, parsed, channel);

      if (parsed.intent === 'help')
        return this.helpMessage(channel, lang, user?.name);

      if (parsed.intent === 'cancel') {
        if (this.listingFlow.isInPriceState(phone))
          return this.listingFlow.handle(phone, 'CANCEL', channel);
        const msgs: Record<Language, string> = {
          english: `Nothing to cancel. Type HELP for options.`,
          french: `Rien à annuler. Tapez AIDE pour les options.`,
          pidgin: `Nothing dey cancel. Type HELP.`,
        };
        return msgs[lang];
      }

      if (parsed.intent === 'confirm' || parsed.intent === 'yes') {
        if (
          this.listingFlow.hasPendingFarmerResponse(phone) ||
          this.listingFlow.isInPriceState(phone)
        )
          return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
      }

      if (parsed.intent === 'no') {
        if (this.listingFlow.hasPendingFarmerResponse(phone))
          return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
      }

      // ── Correction intent — update a user profile field ────
      if (parsed.intent === 'correct' && isRegistered) {
        return this.handleCorrectionIntent(phone, trimmed, parsed, lang);
      }

      // ── Product mentioned but intent unclear — ask to clarify ──
      if (parsed.product && parsed.intent === 'unknown' && parsed.confidence !== 'high') {
        return await this.aiService.reply('clarify_intent', lang, {
          product: parsed.product,
        });
      }

      if (parsed.intent === 'register') {
        if (!isRegistered) {
          const reply = await this.registrationFlow.handle(phone, trimmed, channel);
          if (reply) return reply;
        }
        return this.helpMessage(channel, lang, user?.name);
      }
    } catch {
      this.logger.warn('AI unavailable, falling back to direct matching');
    }

    return await this.aiService.reply('unknown_command', lang, {});
  }

  // ─── Greeting for a fully registered user ─────────────────────
  // Ask a natural intent question — don't dump command syntax at them.
  private handleRegisteredGreeting(
    user: any,
    lang: Language,
    channel: 'sms' | 'whatsapp',
  ): string {
    const name = user?.name && user.name !== 'unknown' ? user.name : null;
    const role: string = user?.role ?? 'farmer';
    const isFarmer = role === 'farmer' || role === 'both';
    const isBuyer = role === 'buyer' || role === 'both';

    if (lang === 'french') {
      const greeting = name ? `Bonjour *${name}* ! 👋` : `Bonjour ! 👋`;
      if (isFarmer && isBuyer)
        return `${greeting} Content de vous revoir.\n\nVous voulez vendre votre récolte ou acheter quelque chose aujourd'hui?`;
      if (isFarmer)
        return `${greeting} Content de vous revoir.\n\nQuel produit voulez-vous vendre aujourd'hui?`;
      return `${greeting} Content de vous revoir.\n\nQue cherchez-vous à acheter aujourd'hui?`;
    }

    if (lang === 'pidgin') {
      const greeting = name ? `How you dey, *${name}*! 👋` : `How you dey! 👋`;
      if (isFarmer && isBuyer)
        return `${greeting} Welcome back.\n\nYou wan sell something or you wan buy today?`;
      if (isFarmer)
        return `${greeting} Welcome back.\n\nWetin you wan sell today?`;
      return `${greeting} Welcome back.\n\nWetin you dey find today?`;
    }

    // English
    const greeting = name ? `Hey *${name}*! 👋` : `Hey! 👋`;
    if (isFarmer && isBuyer)
      return `${greeting} Good to have you back.\n\nWhat do you want to do today — sell your produce or find something to buy?`;
    if (isFarmer)
      return `${greeting} Good to have you back.\n\nWhat are you selling today?`;
    return `${greeting} Good to have you back.\n\nWhat are you looking to buy today?`;
  }

  // ─── Handle correction intent ("actually my name is X") ──────
  private async handleCorrectionIntent(
    phone: string,
    text: string,
    parsed: ParsedIntent,
    lang: Language,
  ): Promise<string> {
    // Try to determine which field is being corrected
    const lower = text.toLowerCase();
    let field: string | null = null;
    let newValue: string | null = null;

    // Name correction signals
    if (/(?:name|nom|appelle)/i.test(lower) && parsed.name) {
      field = 'name';
      newValue = parsed.name;
    }
    // Location correction signals
    else if (/(?:location|town|city|ville|town|place)/i.test(lower) && parsed.location) {
      field = 'location';
      newValue = parsed.location;
    }
    // Location inferred from parsed location even without explicit signal
    else if (parsed.location && !parsed.name) {
      field = 'location';
      newValue = parsed.location;
    }
    // Name inferred from parsed name even without explicit signal
    else if (parsed.name && !parsed.location) {
      field = 'name';
      newValue = parsed.name;
    }
    // Use correctedField if the LLM detected it
    else if (parsed.correctedField && parsed.correctedField !== 'unknown' && parsed.correctedValue) {
      field = parsed.correctedField;
      newValue = parsed.correctedValue;
    }

    if (!field || !newValue) {
      // Can't determine what to correct — fall through to unknown
      return await this.aiService.reply('unknown_command', lang, {});
    }

    const updateDto: Record<string, string> = { [field]: newValue };
    await this.usersService.update(phone, updateDto);

    return await this.aiService.reply('field_corrected', lang, {
      field,
      newValue,
    });
  }

  // ─── Language switch ──────────────────────────────────────────
  private async handleLanguageSwitch(
    phone: string,
    newLang: Language,
    currentLang: Language,
  ): Promise<string> {
    await this.usersService.updateLanguage(phone, newLang);

    const confirms: Record<Language, string> = {
      english: `✅ Language set to *English*.`,
      french: `✅ Langue définie sur *Français*.`,
      pidgin: `✅ Language don change to *Pidgin*.`,
    };
    return confirms[newLang];
  }

  private async handleLanguageMenu(
    phone: string,
    text: string,
    currentLang: Language,
  ): Promise<string> {
    const input = text.trim().toLowerCase();

    let newLang: Language | null = null;
    if (input.includes('1') || input.includes('english')) newLang = 'english';
    else if (
      input.includes('2') ||
      input.includes('french') ||
      input.includes('français')
    )
      newLang = 'french';
    else if (input.includes('3') || input.includes('pidgin'))
      newLang = 'pidgin';

    if (!newLang) {
      return `🌐 Choose your language:\n\n1️⃣ English\n2️⃣ Français\n3️⃣ Pidgin`;
    }

    return this.handleLanguageSwitch(phone, newLang, currentLang);
  }

  // ─── Help message ─────────────────────────────────────────────
  private helpMessage(
    channel: 'sms' | 'whatsapp',
    lang: Language,
    name?: string,
  ): string {
    const nameGreet = name && name !== 'unknown' ? ` ${name}` : '';

    if (channel === 'sms') {
      const sms: Record<Language, string> = {
        english: `AgroLink${nameGreet}:\nSELL maize 10 bags\nBUY maize 20 bags\nLANGUAGE - change\nHELP - this menu`,
        french: `AgroLink${nameGreet}:\nVENDRE maïs 10 sacs\nACHETER maïs 20 sacs\nLANGUE - changer\nAIDE - ce menu`,
        pidgin: `AgroLink${nameGreet}:\nSELL maize 10 bags\nBUY maize 20 bags\nLANGUAGE - change\nHELP - this menu`,
      };
      return sms[lang];
    }

    const help: Record<Language, string> = {
      english: [
        `📋 *AgroLink Help*${nameGreet}\n`,
        `👨‍🌾 *Sell produce:*`,
        `SELL maize 10 bags`,
        `_Type the product, then quantity_\n`,
        `🏪 *Buy produce:*`,
        `BUY maize 20 bags`,
        `BUY maize 20 bags @yaounde`,
        `BUY maize 20 bags #10000-20000\n`,
        `🌐 *Language:* LANGUAGE`,
        `❓ *Help:* HELP`,
      ].join('\n'),
      french: [
        `📋 *Aide AgroLink*${nameGreet}\n`,
        `👨‍🌾 *Vendre:*`,
        `VENDRE maïs 10 sacs`,
        `_Produit puis quantité_\n`,
        `🏪 *Acheter:*`,
        `ACHETER maïs 20 sacs`,
        `ACHETER maïs 20 sacs @yaounde`,
        `ACHETER maïs 20 sacs #10000-20000\n`,
        `🌐 *Langue:* LANGUE`,
        `❓ *Aide:* AIDE`,
      ].join('\n'),
      pidgin: [
        `📋 *AgroLink Help*${nameGreet}\n`,
        `👨‍🌾 *Sell your thing:*`,
        `SELL maize 10 bags`,
        `_Product then number of bags_\n`,
        `🏪 *Buy something:*`,
        `BUY maize 20 bags`,
        `BUY maize 20 bags @yaounde`,
        `BUY maize 20 bags #10000-20000\n`,
        `🌐 *Language:* LANGUAGE`,
        `❓ *Help:* HELP`,
      ].join('\n'),
    };
    return help[lang];
  }

  // ─── Command normalizer ────────────────────────────────────────
  // Converts French/Pidgin command prefixes to canonical English forms
  // so the routing logic above stays simple.
  private normalizeCommand(input: string): string {
    // French command prefixes
    if (input.startsWith('VENDRE')) return 'SELL' + input.slice(6);
    if (input.startsWith('ACHETER')) return 'BUY' + input.slice(7);
    if (input.startsWith('OFFRE')) return 'OFFER' + input.slice(5);
    if (input.startsWith('LANGUE')) return 'LANGUAGE' + input.slice(6);
    // Pidgin shortcuts
    if (input.startsWith('I WAN SELL')) return 'SELL' + input.slice(10);
    if (input.startsWith('I DEY SELL')) return 'SELL' + input.slice(10);
    if (input.startsWith('I GET')) return 'SELL' + input.slice(5);
    if (input.startsWith('I WAN BUY')) return 'BUY' + input.slice(9);
    if (input.startsWith('I DEY FIND')) return 'BUY' + input.slice(10);
    if (input.startsWith('JE VENDS')) return 'SELL' + input.slice(8);
    if (input.startsWith('JE CHERCHE')) return 'BUY' + input.slice(10);
    // Short abbreviations
    if (input.startsWith('VND ')) return 'SELL' + input.slice(3);
    if (input.startsWith('VEND ')) return 'SELL' + input.slice(4);
    if (input.startsWith('ACH ')) return 'BUY' + input.slice(3);
    // Single-word French/Pidgin
    if (input === 'OUI') return 'YES';
    if (input === 'NON') return 'NO';
    if (input === 'AIDE') return 'HELP';
    if (input === 'SAUTER') return 'SKIP';
    if (input === 'ANNULER') return 'CANCEL';
    if (input === 'BONSOIR') return 'HELLO';
    if (input === 'SALUT') return 'HELLO';
    return input;
  }
}
