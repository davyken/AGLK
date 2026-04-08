import { Module, Global } from '@nestjs/common';
import { AiService } from './ai.service';
import { SpeechToTextService } from './speech-to-text.service';
import { TranslationService } from './translation.service';
import { LanguageDetectionService } from './language-detection.service';
import { ResponseGenerationService } from './response-generation.service';
import { ConversationService } from './conversation.service';
import { UsersModule } from '../users/users.module';

@Global()
@Module({
  imports: [
    // ConversationService needs UsersService for language persistence
    UsersModule,
  ],
  providers: [
    LanguageDetectionService,
    ResponseGenerationService,
    ConversationService,
    AiService,
    SpeechToTextService,
    TranslationService,
  ],
  exports: [
    LanguageDetectionService,
    ResponseGenerationService,
    ConversationService,
    AiService,
    SpeechToTextService,
    TranslationService,
  ],
})
export class AiModule {}
