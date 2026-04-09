import { Injectable, Logger } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegistrationFlowService } from '../bot/registration.flow';
import { ListingFlowService } from '../bot/listing.flow';
import { AiService, Language } from '../ai/ai.service';

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

    // ── Sell commands ─────────────────────────────────────────
    if (
      normalized.startsWith('SELL') ||
      upper.startsWith('VENDRE') ||
      upper.startsWith('I GET') ||
      upper.startsWith('I WAN SELL') ||
      upper.startsWith('I DEY SELL') ||
      upper.includes('FOR SELL') ||
      upper.startsWith('VND') ||
      upper.startsWith('VEND ')
    ) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    // ── Buy commands ──────────────────────────────────────────
    if (
      normalized.startsWith('BUY') ||
      upper.startsWith('ACHETER') ||
      upper.startsWith('ACH ') ||
      upper.startsWith('I WAN BUY') ||
      upper.startsWith('I DEY FIND') ||
      upper.includes('FOR BUY') ||
      upper.startsWith('JE CHERCHE') ||
      upper.startsWith('JE VEUX')
    ) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    // ── Offer ─────────────────────────────────────────────────
    if (normalized.startsWith('OFFER') || upper.startsWith('OFFRE ')) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    // ── Role selection (during registration only) ─────────────
    if (normalized === '1' || normalized === '2') {
      if (!isRegistered) {
        const reply = await this.registrationFlow.handle(
          phone,
          trimmed,
          channel,
        );
        if (reply) return reply;
      }
    }

    // ── YES / NO (context-sensitive) ──────────────────────────
    const isYes = [
      'YES',
      'OUI',
      'YES NA',
      'NA SO',
      'OK',
      'OKAY',
      "D'ACCORD",
    ].includes(upper);
    const isNo = [
      'NO',
      'NON',
      'NO BE DAT',
      'NON MERCI',
      'PAS DU TOUT',
      'NOPE',
    ].includes(upper);

    if (isYes || isNo) {
      // Only route YES/NO to listing flow if there is an active pending state
      if (
        this.listingFlow.hasPendingFarmerResponse(phone) ||
        this.listingFlow.isInPriceState(phone)
      ) {
        return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
      }
    }

    // ── AI intent parsing — last resort ───────────────────────
    try {
      const parsed = await this.aiService.parseIntent(trimmed);

      if (parsed.intent === 'sell')
        return this.listingFlow.handle(phone, trimmed, channel);
      if (parsed.intent === 'buy')
        return this.listingFlow.handle(phone, trimmed, channel);
      if (parsed.intent === 'price')
        return this.listingFlow.handle(phone, trimmed, channel);
      if (parsed.intent === 'help')
        return this.helpMessage(channel, lang, user?.name);
      if (
        parsed.intent === 'yes' &&
        this.listingFlow.hasPendingFarmerResponse(phone)
      )
        return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
      if (
        parsed.intent === 'no' &&
        this.listingFlow.hasPendingFarmerResponse(phone)
      )
        return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
      if (parsed.intent === 'register') {
        if (!isRegistered) {
          const reply = await this.registrationFlow.handle(
            phone,
            trimmed,
            channel,
          );
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
  // Instead of dumping the full help menu, give a short contextual reply.
  private handleRegisteredGreeting(
    user: any,
    lang: Language,
    channel: 'sms' | 'whatsapp',
  ): string {
    const name = user?.name && user.name !== 'unknown' ? user.name : null;
    const role: string = user?.role ?? 'farmer';
    const isFarmer = role === 'farmer' || role === 'both';
    // const isBuyer = role === 'buyer' || role === 'both';

    if (lang === 'french') {
      const greeting = name ? `Bonjour *${name}* ! 👋` : `Bonjour ! 👋`;
      const sellText = `Tapez *VENDRE [produit] [quantité]* pour créer une annonce.\nExemple: VENDRE maïs 10 sacs`;
      const buyText = `Tapez *ACHETER [produit] [quantité]* pour trouver des vendeurs.\nExemple: ACHETER maïs 20 sacs`;
      if (role === 'both') {
        return `${greeting}\n\n${sellText}\n\n${buyText}\n\n_AIDE pour plus d'options._`;
      }
      return isFarmer
        ? `${greeting}\n\n${sellText}\n\n_AIDE pour plus d'options._`
        : `${greeting}\n\n${buyText}\n\n_AIDE pour plus d'options._`;
    }

    if (lang === 'pidgin') {
      const greeting = name ? `How you dey, *${name}*! 👋` : `How you dey! 👋`;
      const sellText = `Type *SELL [product] [qty]* to list your produce.\nExample: SELL maize 10 bags`;
      const buyText = `Type *BUY [product] [qty]* to find sellers.\nExample: BUY maize 20 bags`;
      if (role === 'both') {
        return `${greeting}\n\n${sellText}\n\n${buyText}\n\n_Type HELP for more options._`;
      }
      return isFarmer
        ? `${greeting}\n\n${sellText}\n\n_Type HELP for more options._`
        : `${greeting}\n\n${buyText}\n\n_Type HELP for more options._`;
    }

    // English
    const greeting = name ? `Hey *${name}*! 👋` : `Hey! 👋`;
    const sellText = `Type *SELL [product] [qty]* to list your produce.\nExample: SELL maize 10 bags`;
    const buyText = `Type *BUY [product] [qty]* to find sellers.\nExample: BUY maize 20 bags`;
    if (role === 'both') {
      return `${greeting}\n\n${sellText}\n\n${buyText}\n\n_Type HELP for more options._`;
    }
    return isFarmer
      ? `${greeting}\n\n${sellText}\n\n_Type HELP for more options._`
      : `${greeting}\n\n${buyText}\n\n_Type HELP for more options._`;
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
