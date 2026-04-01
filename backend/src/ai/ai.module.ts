import { Module, Global } from '@nestjs/common';
import { SpeechToTextService } from './speech-to-text.service';

@Global()
@Module({
  providers: [SpeechToTextService],
  exports: [SpeechToTextService],
})
export class AiModule {}
