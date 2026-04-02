import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { SpeechToTextService } from './speech-to-text.service';
import { TranslationService } from './translation.service';

@Global()
@Module({
providers: [AiService, SpeechToTextService, TranslationService],
exports: [AiService, SpeechToTextService, TranslationService],
})
export class AiModule {}
