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

    // ── Load user ─────────────────────────────────────────
    const user = await this.usersService.findByPhone(phone);

    // ── Language Resolution ──────────────────────────────
    // 1. Detect from current message via LLM + statistical analysis
    // 2. If high-confidence signal found → use it and save to DB
    // 3. If low-confidence (e.g. user typed "1" or "20") → use saved language
    // This means once a user speaks French, ALL replies stay French
    const detectedLang: Language = await this.aiService.detectLanguage(trimmed);
    const savedLang: Language = (user as any)?.language ?? 'english';

    // Only override saved language if we found a clear non-English signal
    const lang: Language =
      detectedLang !== 'english' ? detectedLang : savedLang;

    // Save language to DB if it changed
    if (user && lang !== savedLang) {
      await this.usersService.updateLanguage(phone, lang);
    }

    // ─────────────────────────────────────────────────────
    // PRIORITY 1: Direct string checks — NO AI needed
    // These must ALWAYS work regardless of Groq status
    // ─────────────────────────────────────────────────────

    // HELP
    if (normalized === 'HELP' || normalized === 'AIDE') {
      return this.helpMessage(channel, lang);
    }

    // LANGUAGE switch
    if (
      normalized.startsWith('LANGUAGE') ||
      normalized.startsWith('LANG') ||
      normalized.startsWith('LANGUE')
    ) {
      return this.handleLanguageSwitch(phone, trimmed, channel, lang);
    }

    // CANCEL
    if (normalized === 'CANCEL' || normalized === 'ANNULER') {
      if (this.listingFlow.isInPriceState(phone)) {
        return this.listingFlow.handle(phone, 'CANCEL', channel);
      }
      const msgs: Record<Language, string> = {
        english: `❌ Nothing to cancel. Type HELP for options.`,
        french: `❌ Rien à annuler. Tapez AIDE.`,
        pidgin: `❌ Nothing dey cancel. Type HELP.`,
      };
      return msgs[lang];
    }

    // ─────────────────────────────────────────────────────
    // PRIORITY 2: Pending state — takes over everything
    // ─────────────────────────────────────────────────────
    if (this.listingFlow.isInPriceState(phone)) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    if (this.listingFlow.hasPendingFarmerResponse(phone)) {
      // YES / NO check directly — no AI needed
      if (
        ['YES', 'OUI', 'YES NA', 'NA SO'].includes(upper) ||
        ['NO', 'NON', 'NO BE DAT'].includes(upper)
      ) {
        return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
      }
    }

    // ─────────────────────────────────────────────────────
    // PRIORITY 3: Registration check
    // ─────────────────────────────────────────────────────
    const isRegistered = user?.conversationState === 'REGISTERED';

    if (!user || !isRegistered) {
      const reply = await this.registrationFlow.handle(phone, trimmed, channel);
      if (reply) return reply;
      // null = just finished registering → fall through
    }

    await this.usersService.updateChannel(phone, channel);

    // ─────────────────────────────────────────────────────
    // PRIORITY 4: Direct command matching — NO AI needed
    // ─────────────────────────────────────────────────────

    // SELL (English + French + Pidgin variants)
    if (
      normalized.startsWith('SELL') ||
      upper.startsWith('VENDRE') ||
      upper.startsWith('I GET') ||
      upper.startsWith('I WAN SELL') ||
      upper.includes('FOR SELL')
    ) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    // BUY (English + French + Pidgin variants)
    if (
      normalized.startsWith('BUY') ||
      upper.startsWith('ACHETER') ||
      upper.startsWith('I WAN BUY') ||
      upper.startsWith('I DEY FIND') ||
      upper.includes('FOR BUY')
    ) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    // OFFER
    if (normalized.startsWith('OFFER') || upper.startsWith('OFFRE')) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    // YES / NO (farmer response)
    if (['YES', 'OUI', 'YES NA', 'NA SO', 'OK', 'OKAY'].includes(upper)) {
      return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
    }
    if (['NO', 'NON', 'NO BE DAT', 'NON MERCI'].includes(upper)) {
      return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
    }

    // GREETINGS → re-registration or menu
    if (['HI', 'HELLO', 'BONJOUR', 'SALUT', 'HEY', 'START'].includes(upper)) {
      if (!isRegistered) {
        const reply = await this.registrationFlow.handle(
          phone,
          trimmed,
          channel,
        );
        if (reply) return reply;
      }
      return this.helpMessage(channel, lang);
    }

    // ─────────────────────────────────────────────────────
    // PRIORITY 5: AI enhancement — only for ambiguous input
    // "I get maize plenty" / "j'ai 10 sacs de maïs"
    // ─────────────────────────────────────────────────────
    try {
      const parsed = await this.aiService.parseIntent(trimmed);

      if (parsed.intent === 'sell')
        return this.listingFlow.handle(phone, trimmed, channel);
      if (parsed.intent === 'buy')
        return this.listingFlow.handle(phone, trimmed, channel);
      if (parsed.intent === 'price')
        return this.listingFlow.handle(phone, trimmed, channel);
      if (parsed.intent === 'help') return this.helpMessage(channel, lang);
      if (parsed.intent === 'yes')
        return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
      if (parsed.intent === 'no')
        return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
      if (parsed.intent === 'register') {
        const reply = await this.registrationFlow.handle(
          phone,
          trimmed,
          channel,
        );
        if (reply) return reply;
        return this.helpMessage(channel, lang);
      }
    } catch (err) {
      this.logger.warn('AI unavailable, using direct matching only');
    }

    // ─────────────────────────────────────────────────────
    // FALLBACK: unknown command
    // ─────────────────────────────────────────────────────
    return await this.aiService.reply('unknown_command', lang, {});
  }

  // ─── Language switch ──────────────────────────────────────
  private async handleLanguageSwitch(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
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
      await this.usersService.updateState(phone, 'AWAITING_LANGUAGE');
      return `🌐 Choose your language:\n\n1️⃣ English\n2️⃣ Français\n3️⃣ Pidgin`;
    }

    await this.usersService.update(phone, { conversationState: 'REGISTERED' });
    await this.usersService.updateLanguage(phone, newLang);

    const confirms: Record<Language, string> = {
      english: `✅ Language set to English.`,
      french: `✅ Langue définie sur Français.`,
      pidgin: `✅ Language don change to Pidgin.`,
    };
    return confirms[newLang];
  }

  // ─── Help message ─────────────────────────────────────────
  private helpMessage(channel: 'sms' | 'whatsapp', lang: Language): string {
    if (channel === 'sms') {
      const sms: Record<Language, string> = {
        english: `AgroLink Help:\nSELL maize 10 bags\nBUY maize 20 bags\nLANGUAGE - change language\nHELP - this menu`,
        french: `AgroLink Aide:\nVENDRE maïs 10 sacs\nACHETER maïs 20 sacs\nLANGUE - changer langue\nAIDE - ce menu`,
        pidgin: `AgroLink Help:\nSELL maize 10 bags\nBUY maize 20 bags\nLANGUAGE - change language\nHELP - this menu`,
      };
      return sms[lang];
    }

    const help: Record<Language, string> = {
      english: [
        `📋 *AgroLink Help*\n`,
        `👨‍🌾 *Farmer:*`,
        `SELL maize 10 bags`,
        `(send a photo after listing!)\n`,
        `🏪 *Buyer:*`,
        `BUY maize 20 bags`,
        `BUY maize 20 bags @yaounde`,
        `BUY maize 20 bags #10000-20000\n`,
        `🌐 *Language:* LANGUAGE\n`,
        `Type HELP anytime.`,
      ].join('\n'),
      french: [
        `📋 *Aide AgroLink*\n`,
        `👨‍🌾 *Agriculteur:*`,
        `VENDRE maïs 10 sacs`,
        `(envoyez une photo après!)\n`,
        `🏪 *Acheteur:*`,
        `ACHETER maïs 20 sacs`,
        `ACHETER maïs 20 sacs @yaounde`,
        `ACHETER maïs 20 sacs #10000-20000\n`,
        `🌐 *Langue:* LANGUE\n`,
        `Tapez AIDE pour ce menu.`,
      ].join('\n'),
      pidgin: [
        `📋 *AgroLink Help*\n`,
        `👨‍🌾 *Farmer:*`,
        `SELL maize 10 bags`,
        `(send photo of your thing!)\n`,
        `🏪 *Buyer:*`,
        `BUY maize 20 bags`,
        `BUY maize 20 bags @yaounde`,
        `BUY maize 20 bags #10000-20000\n`,
        `🌐 *Language:* LANGUAGE\n`,
        `Type HELP anytime.`,
      ].join('\n'),
    };
    return help[lang];
  }

  // ─── Normalize French/Pidgin → English ───────────────────
  private normalizeCommand(input: string): string {
    if (input.startsWith('VENDRE')) return 'SELL' + input.slice(6);
    if (input.startsWith('ACHETER')) return 'BUY' + input.slice(7);
    if (input.startsWith('OFFRE')) return 'OFFER' + input.slice(5);
    if (input.startsWith('LANGUE')) return 'LANGUAGE' + input.slice(6);
    if (input === 'OUI') return 'YES';
    if (input === 'NON') return 'NO';
    if (input === 'AIDE') return 'HELP';
    if (input === 'SAUTER') return 'SKIP';
    if (input === 'ANNULER') return 'CANCEL';
    return input;
  }
}
