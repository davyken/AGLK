import { Module, Global } from '@nestjs/common';
import { MetaSenderService } from './meta-sender.service';
import { TwilioSmsService } from './twilio-sms.service';

@Global()
@Module({
  providers: [MetaSenderService, TwilioSmsService],
  exports: [MetaSenderService, TwilioSmsService],
})
export class WhatsappModule {}
