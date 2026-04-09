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

    const detectedLang: Language = await this.aiService.detectLanguage(trimmed);
    const savedLang: Language = (user as any)?.language ?? 'english';
    const lang: Language =
      detectedLang !== 'english' ? detectedLang : savedLang;

    if (user && lang !== savedLang) {
      await this.usersService.updateLanguage(phone, lang);
    }

    if (normalized.startsWith('ROLE_FARMER') || normalized === '1') {
      if (user?.conversationState !== 'REGISTERED') {
        const reply = await this.registrationFlow.handle(
          phone,
          'farmer',
          channel,
        );
        if (reply) return reply;
      }
      return this.helpMessage(channel, lang);
    }
    if (normalized.startsWith('ROLE_BUYER') || normalized === '2') {
      if (user?.conversationState !== 'REGISTERED') {
        const reply = await this.registrationFlow.handle(
          phone,
          'buyer',
          channel,
        );
        if (reply) return reply;
      }
      return this.helpMessage(channel, lang);
    }

    if (normalized.startsWith('PRICE_ACCEPT') || normalized === '1') {
      return this.listingFlow.handle(phone, '1', channel);
    }
    if (normalized.startsWith('PRICE_CUSTOM') || normalized === '2') {
      return this.listingFlow.handle(phone, '2', channel);
    }

    if (normalized.startsWith('MATCH_YES') || normalized === 'YES') {
      return this.listingFlow.handleFarmerResponse(phone, 'YES', channel);
    }
    if (normalized.startsWith('MATCH_NO') || normalized === 'NO') {
      return this.listingFlow.handleFarmerResponse(phone, 'NO', channel);
    }

    if (
      normalized.startsWith('LANG_ENGLISH') ||
      normalized.includes('ENGLISH')
    ) {
      return this.handleLanguageSwitch(phone, 'english', channel, lang);
    }
    if (normalized.startsWith('LANG_FRENCH') || normalized.includes('FRENCH')) {
      return this.handleLanguageSwitch(phone, 'french', channel, lang);
    }
    if (normalized.startsWith('LANG_PIDGIN') || normalized.includes('PIDGIN')) {
      return this.handleLanguageSwitch(phone, 'pidgin', channel, lang);
    }

    if (normalized === 'HELP' || normalized === 'AIDE') {
      return this.helpMessage(channel, lang);
    }

    if (
      normalized.startsWith('LANGUAGE') ||
      normalized.startsWith('LANG') ||
      normalized.startsWith('LANGUE')
    ) {
      return this.handleLanguageSwitch(phone, trimmed, channel, lang);
    }

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

    if (this.listingFlow.isInPriceState(phone)) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    if (this.listingFlow.hasPendingFarmerResponse(phone)) {
      if (
        ['YES', 'OUI', 'YES NA', 'NA SO'].includes(upper) ||
        ['NO', 'NON', 'NO BE DAT'].includes(upper)
      ) {
        return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
      }
    }

    const isRegistered = user?.conversationState === 'REGISTERED';

    if (!user || !isRegistered) {
      const reply = await this.registrationFlow.handle(phone, trimmed, channel);
      if (reply) return reply;
    }

    await this.usersService.updateChannel(phone, channel);

    if (
      normalized.startsWith('SELL') ||
      upper.startsWith('VENDRE') ||
      upper.startsWith('I GET') ||
      upper.startsWith('I WAN SELL') ||
      upper.includes('FOR SELL')
    ) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    if (
      normalized.startsWith('BUY') ||
      upper.startsWith('ACHETER') ||
      upper.startsWith('I WAN BUY') ||
      upper.startsWith('I DEY FIND') ||
      upper.includes('FOR BUY')
    ) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    if (normalized.startsWith('OFFER') || upper.startsWith('OFFRE')) {
      return this.listingFlow.handle(phone, trimmed, channel);
    }

    if (['YES', 'OUI', 'YES NA', 'NA SO', 'OK', 'OKAY'].includes(upper)) {
      return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
    }
    if (['NO', 'NON', 'NO BE DAT', 'NON MERCI'].includes(upper)) {
      return this.listingFlow.handleFarmerResponse(phone, trimmed, channel);
    }

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
    } catch {
      this.logger.warn('AI unavailable, using direct matching only');
    }

    return await this.aiService.reply('unknown_command', lang, {});
  }

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
