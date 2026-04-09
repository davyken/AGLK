import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface InteractiveButton {
  type: 'reply';
  id: string;
  title: string;
}

export interface InteractiveMessage {
  type: 'button';
  header?: {
    type: 'text' | 'image' | 'video';
    text?: string;
    image?: { id: string } | { link: string };
    video?: { id: string } | { link: string };
  };
  body: {
    text: string;
  };
  footer?: {
    text: string;
  };
  action: {
    buttons: InteractiveButton[];
  };
}

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

  async sendInteractive(
    to: string,
    interactive: InteractiveMessage,
  ): Promise<void> {
    const phoneNumberId = this.config.get<string>('META_PHONE_NUMBER_ID');
    const accessToken = this.config.get<string>('META_ACCESS_TOKEN');
    const apiVersion = this.config.get<string>('META_API_VERSION') || 'v19.0';
    const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive,
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
        this.logger.error(`Meta API interactive error for ${to}: ${err}`);
      }
    } catch (err) {
      this.logger.error(`Failed to send WhatsApp interactive to ${to}`, err);
    }
  }

  async sendWithButtons(
    to: string,
    bodyText: string,
    buttons: { id: string; title: string }[],
    headerText?: string,
    footerText?: string,
  ): Promise<void> {
    const interactive: InteractiveMessage = {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: buttons.map((btn) => ({
          type: 'reply',
          id: btn.id,
          title: btn.title.substring(0, 20),
        })),
      },
    };

    if (headerText) {
      interactive.header = { type: 'text', text: headerText };
    }
    if (footerText) {
      interactive.footer = { text: footerText };
    }

    await this.sendInteractive(to, interactive);
  }

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
