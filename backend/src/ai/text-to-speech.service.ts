import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { gTTS } from 'gtts';
import * as fs from 'fs';
import * as path from 'path';
import FormData from 'form-data';
import type { Language } from './language-detection.service';

@Injectable()
export class TextToSpeechService {
  private readonly logger = new Logger(TextToSpeechService.name);
  private readonly metaAccessToken: string;
  private readonly metaPhoneNumberId: string;
  private readonly metaApiVersion: string;

  constructor(private readonly config: ConfigService) {
    this.metaAccessToken = this.config.get<string>('META_ACCESS_TOKEN') || '';
    this.metaPhoneNumberId =
      this.config.get<string>('META_PHONE_NUMBER_ID') || '';
    this.metaApiVersion = this.config.get<string>('META_API_VERSION') || 'v19.0';
  }

  /**
   * Convert text to speech and upload to WhatsApp media server.
   * Returns the media ID for sending via audio message.
   *
   * @param text The text to convert to speech
   * @param lang The language (english, french, pidgin)
   * @returns Media ID for WhatsApp, or null if generation failed
   */
  async generateAndUpload(text: string, lang: Language): Promise<string | null> {
    if (!text.trim()) {
      return null;
    }

    try {
      // Map Language type to gTTS language codes
      // Pidgin falls back to English with accent
      const ttsLang = this.mapLanguageToTTSCode(lang);

      // Generate audio file
      const audioPath = await this.generateAudioFile(text, ttsLang);
      if (!audioPath) {
        return null;
      }

      // Upload to WhatsApp and get media ID
      const mediaId = await this.uploadToWhatsApp(audioPath);

      // Clean up temporary file
      try {
        fs.unlinkSync(audioPath);
      } catch (err) {
        this.logger.warn(`Failed to clean up temp file: ${audioPath}`);
      }

      return mediaId;
    } catch (error) {
      this.logger.error(`TTS generation/upload failed for lang=${lang}`, error);
      return null;
    }
  }

  /**
   * Generate audio file from text using gTTS.
   * Saves as MP3 in /tmp directory.
   */
  private async generateAudioFile(
    text: string,
    lang: string,
  ): Promise<string | null> {
    try {
      const tempDir = '/tmp';
      const fileName = `agrolink_tts_${Date.now()}_${Math.random().toString(36).substring(7)}.mp3`;
      const filePath = path.join(tempDir, fileName);

      const tts = new gTTS(text, lang);

      // Generate and save the audio file
      await new Promise<void>((resolve, reject) => {
        tts.save(filePath, (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      this.logger.debug(`Audio file generated: ${filePath}`);
      return filePath;
    } catch (error) {
      this.logger.error('Failed to generate audio file', error);
      return null;
    }
  }

  /**
   * Upload audio file to WhatsApp media server and return media ID.
   */
  private async uploadToWhatsApp(filePath: string): Promise<string | null> {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const form = new FormData();
      form.append('file', fs.createReadStream(filePath));
      form.append('type', 'audio');
      form.append('messaging_product', 'whatsapp');

      const uploadUrl = `https://graph.facebook.com/${this.metaApiVersion}/${this.metaPhoneNumberId}/media`;

      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.metaAccessToken}`,
          ...form.getHeaders(),
        },
        body: form as any,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`WhatsApp upload failed: ${error}`);
      }

      const data = (await response.json()) as { id?: string };
      const mediaId = data.id;

      if (!mediaId) {
        throw new Error('No media ID returned from WhatsApp');
      }

      this.logger.log(`Audio uploaded to WhatsApp, media ID: ${mediaId}`);
      return mediaId;
    } catch (error) {
      this.logger.error('Failed to upload audio to WhatsApp', error);
      return null;
    }
  }

  /**
   * Map our Language type to gTTS language codes.
   */
  private mapLanguageToTTSCode(lang: Language): string {
    switch (lang) {
      case 'french':
        return 'fr';
      case 'pidgin':
        // Pidgin isn't a standard gTTS language, use English
        // with the understanding that it will sound accented
        return 'en';
      case 'english':
      default:
        return 'en';
    }
  }
}
