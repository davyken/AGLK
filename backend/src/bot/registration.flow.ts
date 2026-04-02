import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { TranslationService } from '../ai/translation.service';

@Injectable()
export class RegistrationFlowService {
  constructor(
    private readonly usersService: UsersService,
    private readonly translation: TranslationService,
  ) {}

  resumeMessage(
    phone: string,
    language: string,
    channel: 'sms' | 'whatsapp',
  ): string {
    return this.msg(
      channel,
      this.translation.t(language, 'welcome') +
        '\n\n' +
        this.translation.t(language, 'chooseRole') +
        '\n\nReply 1 or 2',
    );
  }

  async handle(
    phone: string,
    text: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<string | null> {
    const input = text.trim();
    const user = await this.usersService.findByPhone(phone);

    if (user?.conversationState === 'REGISTERED') {
      await this.usersService.updateChannel(phone, channel);
      return null;
    }

    const lang = user?.preferredLanguage || 'english';

    if (!user) {
      await this.usersService.createStub(phone, channel);
      return this.msg(
        channel,
        this.translation.t(lang, 'welcome') +
          '\n\n' +
          this.translation.t(lang, 'chooseRole') +
          '\n\nReply 1 or 2',
      );
    }

    await this.usersService.updateChannel(phone, channel);
    return this.resume(phone, input, user.conversationState, channel, lang);
  }

  private async resume(
    phone: string,
    input: string,
    state: string,
    channel: 'sms' | 'whatsapp',
    lang: string,
  ): Promise<string> {
    switch (state) {
      case 'AWAITING_ROLE':
        return this.handleRole(phone, input, channel, lang);
      case 'AWAITING_NAME':
        return this.handleName(phone, input, channel, lang);
      case 'AWAITING_LOCATION':
        return this.handleLocation(phone, input, channel, lang);
      case 'AWAITING_PRODUCES':
        return this.handleProduces(phone, input, channel, lang);
      case 'AWAITING_BUSINESS':
        return this.handleBusiness(phone, input, channel, lang);
      case 'AWAITING_NEEDS':
        return this.handleNeeds(phone, input, channel, lang);
      default:
        return this.msg(
          channel,
          '❌ Something went wrong. Reply Hi to restart.',
        );
    }
  }

  private async handleRole(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
    lang: string,
  ): Promise<string> {
    const lower = input.toLowerCase();
    const frenchFarmer = ['agriculteur', 'fermier', 'paysan'];
    const frenchBuyer = ['acheteur', 'commerçant', 'commercant'];
    const isFarmer = ['1', 'farmer', ...frenchFarmer].includes(lower);
    const isBuyer = ['2', 'buyer', ...frenchBuyer].includes(lower);

    if (!isFarmer && !isBuyer) {
      return this.msg(channel, this.translation.t(lang, 'invalidRole'));
    }

    const role = isFarmer ? 'farmer' : 'buyer';
    await this.usersService.update(phone, {
      role,
      conversationState: 'AWAITING_NAME',
    });
    return this.msg(channel, this.translation.t(lang, 'enterName'));
  }

  private async handleName(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
    lang: string,
  ): Promise<string> {
    if (input.length < 2) {
      return this.msg(channel, this.translation.t(lang, 'invalidName'));
    }

    await this.usersService.update(phone, {
      name: input,
      conversationState: 'AWAITING_LOCATION',
    });
    return this.msg(channel, this.translation.t(lang, 'enterLocation'));
  }

  private async handleLocation(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
    lang: string,
  ): Promise<string> {
    if (input.length < 2) {
      return this.msg(channel, this.translation.t(lang, 'invalidLocation'));
    }

    const user = await this.usersService.findByPhone(phone);
    await this.usersService.update(phone, {
      location: input,
      conversationState:
        user?.role === 'farmer' ? 'AWAITING_PRODUCES' : 'AWAITING_BUSINESS',
    });

    if (user?.role === 'farmer') {
      return this.msg(channel, this.translation.t(lang, 'enterProduces'));
    }
    return this.msg(channel, this.translation.t(lang, 'enterBusiness'));
  }

  private async handleProduces(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
    lang: string,
  ): Promise<string> {
    const produces = input
      .split(',')
      .map((p) => p.trim().toLowerCase())
      .filter((p) => p.length > 0);

    if (produces.length === 0) {
      return this.msg(channel, '❌ Please list at least one product.');
    }

    const user = await this.usersService.update(phone, {
      produces,
      conversationState: 'REGISTERED',
    });

    return this.msg(
      channel,
      this.translation.t(lang, 'registeredFarmer', user.name),
    );
  }

  private async handleBusiness(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
    lang: string,
  ): Promise<string> {
    if (input.length < 2) {
      return this.msg(channel, '❌ Please enter a valid business name.');
    }

    await this.usersService.update(phone, {
      businessName: input,
      conversationState: 'AWAITING_NEEDS',
    });
    return this.msg(channel, this.translation.t(lang, 'enterNeeds'));
  }

  private async handleNeeds(
    phone: string,
    input: string,
    channel: 'sms' | 'whatsapp',
    lang: string,
  ): Promise<string> {
    const needs = input
      .split(',')
      .map((n) => n.trim().toLowerCase())
      .filter((n) => n.length > 0);

    if (needs.length === 0) {
      return this.msg(channel, '❌ Please list at least one product.');
    }

    const user = await this.usersService.update(phone, {
      needs,
      conversationState: 'REGISTERED',
    });

    return this.msg(
      channel,
      this.translation.t(lang, 'registeredBuyer', user.name),
    );
  }

  private msg(channel: 'sms' | 'whatsapp', message: string): string {
    if (channel === 'sms') {
      return message
        .replace(
          /[\u{1F300}-\u{1FFFF}|\u{2600}-\u{26FF}|\u{2700}-\u{27BF}]/gu,
          '',
        )
        .trim();
    }
    return message;
  }
}
