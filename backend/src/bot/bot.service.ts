import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegistrationFlowService } from '../bot/registration.flow';
import { ListingFlowService } from '../bot/listing.flow';
import { AiService, Language } from '../ai/ai.service';

export interface IncomingMessage {
  phone:   string;
  text:    string;
  channel: 'sms' | 'whatsapp';
}

@Injectable()
export class BotService {
  constructor(
    private readonly usersService:     UsersService,
    private readonly registrationFlow: RegistrationFlowService,
    private readonly listingFlow:      ListingFlowService,
    private readonly aiService:        AiService,
  ) {}

  async handleMessage(msg: IncomingMessage): Promise<string> {
    const { phone, text, channel } = msg;

    // ── Load user ─────────────────────────────────────────
    const user = await this.usersService.findByPhone(phone);

    // ── Resolve language ──────────────────────────────────
    let lang: Language = (user as any)?.language ?? 'english';
    if (!user || user.conversationState !== 'REGISTERED') {
      const parsed = await this.aiService.parseIntent(text);
      lang = parsed.language ?? 'english';
    }

    const parsedFirst = await this.aiService.parseIntent(text);

  // ── HELP (any stage, any language) ────────────────────
    if (parsed.intent === 'help') {
      return this.aiService.reply('help', lang);
    }

    // ── LANGUAGE switch ───────────────────────────────────
    if (parsedFirst.intent === 'unknown' && (text.toLowerCase().includes('lang') || text.toLowerCase().includes('language') || text.toLowerCase().includes('langue'))) {
      return this.handleLanguageSwitch(phone, text, channel, lang);
    }

    // ── CANCEL ────────────────────────────────────────────
    if (parsedFirst.intent === 'no') {
      if (this.listingFlow.isInPriceState(phone)) {
        return this.listingFlow.handle(phone, text, channel);
      }
      return this.aiService.reply('unknown_command', lang);
    }

    // ── Not registered / mid-registration ─────────────────
    const isRegistered = user?.conversationState === 'REGISTERED';

    if (!user || !isRegistered) {
      const reply = await this.registrationFlow.handle(phone, text, channel);
      if (reply) return reply;
      // null = registration just completed, fall through to commands
    }

    // ── Update last channel used ──────────────────────────
    await this.usersService.updateChannel(phone, channel);

    // ── Pending listing state takes full priority ─────────
    if (this.listingFlow.isInPriceState(phone)) {
      return this.listingFlow.handle(phone, text, channel);
    }

    // ── Farmer YES/NO response ────────────────────────────
    if (this.listingFlow.hasPendingFarmerResponse(phone)) {
      return this.listingFlow.handleFarmerResponse(phone, text, channel);
    }

    // ── AI-powered command routing ────────────────────────
    // Full reliance on aiService.parseIntent()
    if (parsedFirst.intent === 'sell')  return this.listingFlow.handle(phone, text, channel);
    if (parsedFirst.intent === 'buy')   return this.listingFlow.handle(phone, text, channel);
    if (parsedFirst.intent === 'price') return this.listingFlow.handle(phone, text, channel);
    if (parsedFirst.intent === 'yes')   return this.listingFlow.handleFarmerResponse(phone, text, channel);
    if (parsedFirst.intent === 'no')    return this.listingFlow.handleFarmerResponse(phone, text, channel);

    // ── Unknown ───────────────────────────────────────────
    return this.aiService.reply('unknown_command', lang, {});

    // ── Unknown ───────────────────────────────────────────
    return this.aiService.reply('unknown_command', lang, {});
  }

  // ─── Language switch ──────────────────────────────────────
  private async handleLanguageSwitch(
    phone:       string,
    text:        string,
    channel:     'sms' | 'whatsapp',
    currentLang: Language,
  ): Promise<string> {
    const input = text.trim().toLowerCase();

    let newLang: Language | null = null;
    if (input.includes('1') || input.includes('english'))                                  newLang = 'english';
    else if (input.includes('2') || input.includes('french') || input.includes('français')) newLang = 'french';
    else if (input.includes('3') || input.includes('pidgin'))                              newLang = 'pidgin';

    if (!newLang) {
      await this.usersService.updateState(phone, 'AWAITING_LANGUAGE');
      return `🌐 Choose your language:\n\n1️⃣ English\n2️⃣ Français\n3️⃣ Pidgin`;
    }

    await this.usersService.update(phone, {
      conversationState: 'REGISTERED',
    });
    // Save language field separately
    await (this.usersService as any).updateLanguage?.(phone, newLang)
      ?? this.usersService.update(phone, { language: newLang } as any);

    const confirms: Record<Language, string> = {
      english: `✅ Language set to English.`,
      french:  `✅ Langue définie sur Français.`,
      pidgin:  `✅ Language don change to Pidgin.`,
    };
    return confirms[newLang];
  }

  // ─── Help message (3 languages) ───────────────────────────
  private helpMessage(channel: 'sms' | 'whatsapp', lang: Language): string {
    if (channel === 'sms') {
      const sms: Record<Language, string> = {
        english: `AgroLink Help:\nSELL maize 10 bags\nBUY maize 20 bags\nLANGUAGE - change language\nHELP - this menu`,
        french:  `AgroLink Aide:\nVENDRE maïs 10 sacs\nACHETER maïs 20 sacs\nLANGUE - changer langue\nAIDE - ce menu`,
        pidgin:  `AgroLink Help:\nSELL maize 10 bags\nBUY maize 20 bags\nLANGUAGE - change language\nHELP - this menu`,
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
        `Type HELP anytime for this menu.`,
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

  // ─── Normalize French/Pidgin → English commands ───────────
  private normalizeCommand(input: string): string {
    if (input.startsWith('VENDRE'))  return 'SELL'     + input.slice(6);
    if (input.startsWith('ACHETER')) return 'BUY'      + input.slice(7);
    if (input.startsWith('OFFRE'))   return 'OFFER'    + input.slice(5);
    if (input.startsWith('LANGUE'))  return 'LANGUAGE' + input.slice(6);
    if (input === 'OUI')             return 'YES';
    if (input === 'NON')             return 'NO';
    if (input === 'AIDE')            return 'HELP';
    if (input === 'SAUTER')          return 'SKIP';
    if (input === 'ANNULER')         return 'CANCEL';
    return input;
  }
}