import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Twilio from 'twilio';

@Injectable()
export class TwilioSmsService {
  private readonly logger = new Logger(TwilioSmsService.name);
  private readonly client: Twilio.Twilio | null = null;
  private readonly twilioPhoneNumber: string;

  constructor(private readonly config: ConfigService) {
    const accountSid = this.config.get<string>('TWILIO_ACCOUNT_SID');
    const authToken = this.config.get<string>('TWILIO_AUTH_TOKEN');
    this.twilioPhoneNumber =
      this.config.get<string>('TWILIO_PHONE_NUMBER') || '';

    if (accountSid && authToken) {
      this.client = Twilio(accountSid, authToken);
      this.logger.log('Twilio SMS service initialized');
    } else {
      this.logger.warn(
        'Twilio credentials not configured - SMS will be disabled',
      );
    }
  }

  async send(to: string, message: string): Promise<boolean> {
    if (!this.client) {
      this.logger.warn('Twilio client not initialized, skipping SMS');
      return false;
    }

    try {
      const formattedNumber = this.formatPhoneNumber(to);

      await this.client.messages.create({
        body: message,
        from: this.twilioPhoneNumber,
        to: formattedNumber,
      });

      this.logger.log(`SMS sent to ${formattedNumber}`);
      return true;
    } catch (err: unknown) {
      this.logger.error(
        `Failed to send SMS to ${to}`,
        err instanceof Error ? err.message : String(err),
      );
      return false;
    }
  }

  private formatPhoneNumber(phone: string): string {
    const digits = phone.replace(/\D/g, '');

    if (digits.startsWith('+')) {
      return digits;
    }

    if (digits.length === 9 && /^[67]/.test(digits)) {
      return `+237${digits}`;
    }

    if (digits.startsWith('237') && digits.length === 12) {
      return `+${digits}`;
    }

    if (digits.length >= 8) {
      return `+${digits}`;
    }

    return `+237${digits}`;
  }
}
