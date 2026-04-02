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

    const user = await this.usersService.findByPhone(phone);

    let detectedLang = user?.preferredLanguage || 'english';
    if (!user || user.conversationState !== 'REGISTERED') {
      detectedLang = this.translation.detectLanguage(text);
    }

    if (input === 'HELP' || input === 'AIDE') {
      return this.helpMessage(channel, detectedLang);
    }

    if (user?.conversationState === 'AWAITING_LANGUAGE') {
      return this.handleLanguageCommand(phone, text, channel, detectedLang);
    }

    if (input.startsWith('LANGUAGE') || input.startsWith('LANG')) {
      return this.handleLanguageCommand(phone, text, channel, detectedLang);
    }

    const normalizedInput = this.normalizeCommand(input);

    if (normalizedInput === 'CANCEL') {
      if (this.listingFlow.isInPriceState(phone)) {
        return this.listingFlow.handle(phone, 'CANCEL', channel);
      }
      if (user && user.conversationState !== 'REGISTERED') {
        return this.translation.t(detectedLang, 'somethingWrong');
      }
      return this.translation.t(detectedLang, 'somethingWrong');
    }

    const isRegistered = user?.conversationState === 'REGISTERED';

    if (!user || !isRegistered) {
      const reply = await this.registrationFlow.handle(phone, text, channel);
      if (!reply) {
        await this.usersService.updateChannel(phone, channel);

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
        if (normalizedInput === 'YES' || normalizedInput === 'NO') {
          return this.listingFlow.handleFarmerResponse(
            phone,
            normalizedInput,
            channel,
          );
        }

        return this.helpMessage(channel, detectedLang);
      }
      return reply;
    }

    await this.usersService.updateChannel(phone, channel);

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
    if (normalizedInput === 'YES' || normalizedInput === 'NO') {
      return this.listingFlow.handleFarmerResponse(
        phone,
        normalizedInput,
        channel,
      );
    }

    return this.unknownCommand(user.role, channel);
  }

  private async handleLanguageCommand(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
    currentLang: string,
  ): Promise<string> {
    const input = text.trim().toLowerCase();
    const currentUser = await this.usersService.findByPhone(phone);
    const previousState =
      currentUser?.conversationState &&
      currentUser.conversationState !== 'AWAITING_LANGUAGE'
        ? currentUser.conversationState
        : undefined;

    if (input.includes('1') || input.includes('english')) {
      const update: any = { preferredLanguage: 'english' };
      update.conversationState = previousState || 'REGISTERED';
      await this.usersService.update(phone, update);
      if (previousState) {
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

    await this.usersService.update(phone, {
      conversationState: 'AWAITING_LANGUAGE',
    });
    return this.translation.t(currentLang, 'selectLanguage');
  }

  private helpMessage(channel: 'sms' | 'whatsapp', language?: string): string {
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

  private normalizeCommand(input: string): string {
    const normalized = input.toUpperCase();
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
