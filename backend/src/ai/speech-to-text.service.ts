import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as https from 'https';
import * as path from 'path';
import FormData from 'form-data';

@Injectable()
export class SpeechToTextService {
  private readonly logger = new Logger(SpeechToTextService.name);
  private readonly openaiApiKey: string;

  constructor(private readonly config: ConfigService) {
    this.openaiApiKey = this.config.get<string>('OPENAI_API_KEY') || '';
  }

  /**
   * Transcribe audio from a WhatsApp media URL or media ID.
   * Uses OpenAI's Whisper API with proper multipart form data.
   */
  async transcribe(audioUrl?: string, audioMediaId?: string): Promise<string> {
    if (!this.openaiApiKey) {
      this.logger.warn('OpenAI API key not configured');
      return '';
    }

    let audioBuffer: Buffer | null = null;

    try {
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

      // Save to temp file for multipart upload
      const tempPath = `/tmp/whisper_${Date.now()}.ogg`;
      fs.writeFileSync(tempPath, audioBuffer);

      try {
        // Create form data with proper multipart format
        const form = new FormData();
        form.append(
          'file',
          fs.createReadStream(tempPath),
          {
            filename: 'audio.ogg',
            contentType: 'audio/ogg',
          },
        );
        form.append('model', 'whisper-1');
        form.append(
          'prompt',
          'Agricultural marketplace terms in Cameroon: maize, bags, sell, buy, farmer, buyer, price, quantity, tomato, cassava, plantain, Cameroon, pidgin, french. Also use common African names and locations: Douala, Yaoundé, Bafoussam, Buea, village, farm, harvest.',
        );
        form.append('response_format', 'text');
        form.append('language', 'en'); // Will be auto-detected by Whisper

        const response = await fetch(
          'https://api.openai.com/v1/audio/transcriptions',
          {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${this.openaiApiKey}`,
              ...form.getHeaders(),
            },
            body: form as any,
          },
        );

        if (!response.ok) {
          const error = await response.text();
          this.logger.error(`Whisper API error: ${error}`);
          return '';
        }

        const transcription = await response.text();
        this.logger.log(`Transcription result: "${transcription}"`);
        return transcription.trim();
      } finally {
        // Clean up temp file
        try {
          fs.unlinkSync(tempPath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      this.logger.error('Speech-to-text error:', error);
      return '';
    }
  }

  /**
   * Download WhatsApp media and return as Buffer
   */
  private async downloadWhatsAppMedia(mediaId: string): Promise<Buffer | null> {
    try {
      const accessToken = this.config.get<string>('META_ACCESS_TOKEN');
      const apiVersion = this.config.get<string>('META_API_VERSION') || 'v19.0';

      // First get the media URL from Meta API
      const mediaResponse = await fetch(
        `https://graph.facebook.com/${apiVersion}/${mediaId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      );

      if (!mediaResponse.ok) {
        this.logger.error('Failed to get media info from Meta');
        return null;
      }

      const mediaData = await mediaResponse.json();
      const mediaUrl = mediaData.url;

      if (!mediaUrl) {
        this.logger.error('No media URL in response');
        return null;
      }

      // Download the actual audio file
      const audioResponse = await fetch(mediaUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!audioResponse.ok) {
        this.logger.error('Failed to download audio from media URL');
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
