import { Module, Global } from '@nestjs/common';
import { MetaSenderService } from './meta-sender.service';

@Global()
@Module({
  providers: [MetaSenderService],
  exports: [MetaSenderService],
})
export class WhatsappModule {}
