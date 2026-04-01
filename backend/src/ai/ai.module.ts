import { Module, Global } from '@nestjs/common';
import { SpeechToTextService } from './speech-to-text.service';
import { TranslationService } from './translation.service';

@Global()
@Module({
  providers: [SpeechToTextService, TranslationService],
  exports: [SpeechToTextService, TranslationService],
})
export class AiModule {}
