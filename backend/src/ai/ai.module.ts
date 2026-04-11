import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { TextToSpeechService } from './text-to-speech.service';
import { LanguageDetectionService } from './language-detection.service';
import { ResponseGenerationService } from './response-generation.service';

@Global()
@Module({
  providers: [
    LanguageDetectionService,
    ResponseGenerationService,
    AiService,
    TextToSpeechService,
  ],
  exports: [
    LanguageDetectionService,
    ResponseGenerationService,
    AiService,
    TextToSpeechService,
  ],
})
export class AiModule {}
