import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MetaSenderService {
  private readonly logger = new Logger(MetaSenderService.name);

  constructor(private readonly config: ConfigService) {}

  async send(to: string, message: string): Promise<void> {
    const phoneNumberId = this.config.get<string>('META_PHONE_NUMBER_ID');
    const accessToken = this.config.get<string>('META_ACCESS_TOKEN');
    const apiVersion = this.config.get<string>('META_API_VERSION') || 'v19.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        this.logger.error(`Meta API error for ${to}: ${err}`);
      }
    } catch (err) {
      this.logger.error(`Failed to send WhatsApp message to ${to}`, err);
    }
  }

  /**
   * Send an image via WhatsApp
   * @param to - Recipient phone number
   * @param imageUrl - URL to the image or media ID from WhatsApp
   * @param caption - Optional caption for the image
   */
  async sendImage(
    to: string,
    imageUrl: string,
    caption?: string,
  ): Promise<void> {
    const phoneNumberId = this.config.get<string>('META_PHONE_NUMBER_ID');
    const accessToken = this.config.get<string>('META_ACCESS_TOKEN');
    const apiVersion = this.config.get<string>('META_API_VERSION') || 'v19.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: {
        link: imageUrl,
        caption: caption || '',
      },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        this.logger.error(`Meta API error for ${to}: ${err}`);
      }
    } catch (err) {
      this.logger.error(`Failed to send WhatsApp image to ${to}`, err);
    }
  }

  /**
   * Send an image using a media ID (for pre-uploaded images)
   */
  async sendImageByMediaId(
    to: string,
    mediaId: string,
    caption?: string,
  ): Promise<void> {
    const phoneNumberId = this.config.get<string>('META_PHONE_NUMBER_ID');
    const accessToken = this.config.get<string>('META_ACCESS_TOKEN');
    const apiVersion = this.config.get<string>('META_API_VERSION') || 'v19.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: {
        id: mediaId,
        caption: caption || '',
      },
    };

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.text();
        this.logger.error(`Meta API error for ${to}: ${err}`);
      }
    } catch (err) {
      this.logger.error(`Failed to send WhatsApp image to ${to}`, err);
    }
  }
}
