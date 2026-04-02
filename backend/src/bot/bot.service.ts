import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { RegistrationFlowService } from './registration.flow';
import { ListingFlowService } from './listing.flow';
import { TranslationService } from '../ai/translation.service';

export interface IncomingMessage {
  phone: string;
  text: string;
  channel: 'sms' | 'whatsapp';
}

@Injectable()
export class BotService {
  constructor(
    private readonly usersService: UsersService,
    private readonly registrationFlow: RegistrationFlowService,
    private readonly listingFlow: ListingFlowService,
    private readonly translation: TranslationService,
  ) {}

  async handleMessage(msg: IncomingMessage): Promise<string> {
    const { phone, text, channel } = msg;
    const input = text.trim().toUpperCase();

    // Get user to check preferred language
    const user = await this.usersService.findByPhone(phone);

    // Auto-detect language from message if user not registered
    let detectedLang = user?.preferredLanguage || 'english';
    if (!user || user.conversationState !== 'REGISTERED') {
      detectedLang = this.translation.detectLanguage(text);
    }

    // ── HELP command (works at any stage) ─────────────────
    if (input === 'HELP' || input === 'AIDE') {
      return this.helpMessage(channel, detectedLang);
    }

    // ── AWAITING_LANGUAGE state → process selection ──────
    if (user?.conversationState === 'AWAITING_LANGUAGE') {
      return this.handleLanguageCommand(phone, text, channel, detectedLang);
    }

    // ── LANGUAGE command (works at any stage) ───────────────
    if (input.startsWith('LANGUAGE') || input.startsWith('LANG')) {
      return this.handleLanguageCommand(phone, text, channel, detectedLang);
    }

    // ── Normalized input (French → English) ────────────
    const normalizedInput = this.normalizeCommand(input);

    // ── CANCEL command (works at any stage) ────────────────
    if (normalizedInput === 'CANCEL') {
      // Clear pending listing state if any
      if (this.listingFlow.isInPriceState(phone)) {
        return this.listingFlow.handle(phone, 'CANCEL', channel);
      }
      // If mid-registration, reset to start
      if (user && user.conversationState !== 'REGISTERED') {
        return this.translation.t(detectedLang, 'somethingWrong');
      }
      return this.translation.t(detectedLang, 'somethingWrong');
    }

    const isRegistered = user?.conversationState === 'REGISTERED';

    // ── Not registered or mid-registration → registration flow
    if (!user || !isRegistered) {
      const reply = await this.registrationFlow.handle(phone, text, channel);
      // If reply is null, user is fully registered → continue to listing flow
      if (!reply) {
        // User is registered, proceed to main command router
        await this.usersService.updateChannel(phone, channel);

        // Check if user is in pending price state (waiting for price choice)
        if (this.listingFlow.isInPriceState(phone)) {
          return this.listingFlow.handle(phone, text, channel);
        }

        // Route to listing flow
        if (normalizedInput.startsWith('SELL')) {
          return await this.listingFlow.handle(phone, text, channel);
        }

        if (normalizedInput.startsWith('BUY')) {
          return await this.listingFlow.handle(phone, text, channel);
        }

        if (normalizedInput.startsWith('OFFER')) {
          return await this.listingFlow.handle(phone, text, channel);
        }

        // YES/NO response from farmer - check if they have pending interest
        if (normalizedInput === 'YES' || normalizedInput === 'NO') {
          return this.listingFlow.handleFarmerResponse(
            phone,
            normalizedInput,
            channel,
          );
        }

        // No command recognized, show help
        return this.helpMessage(channel, detectedLang);
      }
      return reply;
    }

    // ── Registered → main command router ──────────────────
    await this.usersService.updateChannel(phone, channel);

    // Check if user is in pending price state (waiting for price choice)
    if (this.listingFlow.isInPriceState(phone)) {
      return this.listingFlow.handle(phone, text, channel);
    }

    if (normalizedInput.startsWith('SELL')) {
      return await this.listingFlow.handle(phone, text, channel);
    }

    if (normalizedInput.startsWith('BUY')) {
      return await this.listingFlow.handle(phone, text, channel);
    }

    if (normalizedInput.startsWith('OFFER')) {
      return await this.listingFlow.handle(phone, text, channel);
    }

    // YES/NO response from farmer - check if they have pending interest
    if (normalizedInput === 'YES' || normalizedInput === 'NO') {
      return this.listingFlow.handleFarmerResponse(
        phone,
        normalizedInput,
        channel,
      );
    }

    // ── Unrecognised command ───────────────────────────────
    return this.unknownCommand(user.role, channel);
  }

  // ─── Handle LANGUAGE command ────────────────────────────
  private async handleLanguageCommand(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
    currentLang: string,
  ): Promise<string> {
    const input = text.trim().toLowerCase();
    const currentUser = await this.usersService.findByPhone(phone);
    // Preserve registration state if user is mid-registration
    const previousState =
      currentUser?.conversationState &&
      currentUser.conversationState !== 'AWAITING_LANGUAGE'
        ? currentUser.conversationState
        : undefined;

    // Parse language selection
    if (input.includes('1') || input.includes('english')) {
      const update: any = { preferredLanguage: 'english' };
      update.conversationState = previousState || 'REGISTERED';
      await this.usersService.update(phone, update);
      if (previousState) {
        // User is mid-registration, show language set then resume registration
        return (
          this.translation.t('english', 'languageSet') +
          '\n\n' +
          this.registrationFlow.resumeMessage(phone, 'english', channel)
        );
      }
      return this.translation.t('english', 'languageSet');
    }

    if (
      input.includes('2') ||
      input.includes('french') ||
      input.includes('français')
    ) {
      const update: any = { preferredLanguage: 'french' };
      update.conversationState = previousState || 'REGISTERED';
      await this.usersService.update(phone, update);
      if (previousState) {
        return (
          this.translation.t('french', 'languageSet') +
          '\n\n' +
          this.registrationFlow.resumeMessage(phone, 'french', channel)
        );
      }
      return this.translation.t('french', 'languageSet');
    }

    if (input.includes('3') || input.includes('pidgin')) {
      const update: any = { preferredLanguage: 'pidgin' };
      update.conversationState = previousState || 'REGISTERED';
      await this.usersService.update(phone, update);
      if (previousState) {
        return (
          this.translation.t('pidgin', 'languageSet') +
          '\n\n' +
          this.registrationFlow.resumeMessage(phone, 'pidgin', channel)
        );
      }
      return this.translation.t('pidgin', 'languageSet');
    }

    // No valid selection → set state and show language menu
    await this.usersService.update(phone, {
      conversationState: 'AWAITING_LANGUAGE',
    });
    return this.translation.t(currentLang, 'selectLanguage');
  }

  // ─── HELP message ────────────────────────────────────────
  private helpMessage(channel: 'sms' | 'whatsapp', language?: string): string {
    // Use translation service if language is specified
    if (language && channel === 'whatsapp') {
      return this.translation.getHelpText(language);
    }

    if (channel === 'sms') {
      return [
        'Agro-link Help:',
        'SELL maize 10 bags',
        'BUY maize 20 bags',
        'BUY maize 20 bags @yaounde (filter by city)',
        'BUY maize 20 bags #10000-20000 (filter by price)',
        'LANGUAGE - change language',
        'HELP - show this menu',
      ].join('\n');
    }

    return [
      '📋 *Agro-link Help*',
      '',
      '👨‍🌾 *Farmer commands:*',
      'SELL maize 10 bags',
      '  Then send an image of your product!',
      '',
      '🏪 *Buyer commands:*',
      'BUY maize 20 bags',
      'BUY maize 20 bags @yaounde (filter by city)',
      'BUY maize 20 bags #10000-20000 (price range)',
      'BUY maize 20 bags @yaounde #15000-25000 (city + price)',
      '',
      '🌐 *Language:*',
      'LANGUAGE - change language (English/French/Pidgin)',
      '',
      '💡 *Tips:*',
      '- Use @ before city name to filter by location',
      '- Use #min-max for price range (e.g. #10000-20000)',
      '- Add an image when selling to attract buyers!',
      '',
      'Reply HELP anytime to see this menu.',
    ].join('\n');
  }

  private unknownCommand(role: string, channel: 'sms' | 'whatsapp'): string {
    if (channel === 'sms') {
      return role === 'farmer'
        ? 'Unknown command. Try: SELL maize 10 bags'
        : 'Unknown command. Try: BUY maize 20 bags';
    }

    return role === 'farmer'
      ? `❓ Unknown command.\n\nTry:\nSELL maize 10 bags\n\nType HELP for all options.`
      : `❓ Unknown command.\n\nTry:\nBUY maize 20 bags\n\nType HELP for all options.`;
  }

  // ─── Normalize French/Pidgin commands to English ────────
  private normalizeCommand(input: string): string {
    const normalized = input.toUpperCase();

    // Preserve original text after the command keyword for parsing (e.g. "VENDRE mais 10 sacs" → "SELL mais 10 sacs")
    if (normalized.startsWith('VENDRE')) return 'SELL' + normalized.slice(6);
    if (normalized.startsWith('ACHETER')) return 'BUY' + normalized.slice(7);
    if (normalized.startsWith('OFFRE')) return 'OFFER' + normalized.slice(5);
    if (normalized === 'OUI') return 'YES';
    if (normalized === 'NON') return 'NO';
    if (normalized === 'AIDE') return 'HELP';
    if (normalized === 'SAUTER') return 'SKIP';
    if (normalized === 'ANNULER') return 'CANCEL';

    return normalized;
  }
}
