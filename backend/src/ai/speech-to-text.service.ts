import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class SpeechToTextService {
  private readonly logger = new Logger(SpeechToTextService.name);
  private readonly openaiApiKey: string;

  constructor(private readonly config: ConfigService) {
    this.openaiApiKey = this.config.get<string>('OPENAI_API_KEY') || '';
  }

  async transcribe(audioUrl?: string, audioMediaId?: string): Promise<string> {
    if (!this.openaiApiKey) {
      this.logger.warn('OpenAI API key not configured');
      return '';
    }

    try {
      let audioBuffer: Buffer | null = null;

      if (audioMediaId) {
        audioBuffer = await this.downloadWhatsAppMedia(audioMediaId);
      } else if (audioUrl) {
        const response = await fetch(audioUrl);
        if (response.ok) {
          const arrayBuffer = await response.arrayBuffer();
          audioBuffer = Buffer.from(arrayBuffer);
        }
      }

      if (!audioBuffer) {
        this.logger.error('No audio data available');
        return '';
      }

      const base64Audio = audioBuffer.toString('base64');

      const response = await fetch(
        'https://api.openai.com/v1/audio/transcriptions',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.openaiApiKey}`,
            'Content-Type': 'multipart/form-data',
          },
          body: JSON.stringify({
            file: base64Audio,
            model: 'whisper-1',
            language: 'en',
            response_format: 'text',
          }),
        },
      );

      if (!response.ok) {
        const error = await response.text();
        this.logger.error(`Whisper API error: ${error}`);
        return '';
      }

      const transcription = await response.text();
      this.logger.log(`Transcription: ${transcription}`);
      return transcription.trim();
    } catch (error) {
      this.logger.error('Speech-to-text error:', error);
      return '';
    }
  }

  private async downloadWhatsAppMedia(mediaId: string): Promise<Buffer | null> {
    try {
      const accessToken = this.config.get<string>('META_ACCESS_TOKEN');
      const apiVersion = this.config.get<string>('META_API_VERSION') || 'v19.0';

      const mediaResponse = await fetch(
        `https://graph.facebook.com/${apiVersion}/${mediaId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!mediaResponse.ok) {
        this.logger.error('Failed to get media info');
        return null;
      }

      const mediaData = await mediaResponse.json();
      const mediaUrl = mediaData.url;

      const audioResponse = await fetch(mediaUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!audioResponse.ok) {
        this.logger.error('Failed to download audio');
        return null;
      }

      const arrayBuffer = await audioResponse.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      this.logger.error('Error downloading WhatsApp media:', error);
      return null;
    }
  }
}
