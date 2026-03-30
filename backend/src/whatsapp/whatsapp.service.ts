import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { ConfigService } from '@nestjs/config';

export interface WhatsAppMessage {
  messaging_product: string;
  to: string;
  type: string;
  text?: { body: string };
  template?: any;
}

export interface WhatsAppWebhookMessage {
  from: string;
  id: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  image?: any;
  audio?: any;
  video?: any;
  document?: any;
  location?: any;
}

export interface WhatsAppContact {
  profile: { name: string };
  wa_id: string;
}

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly http: AxiosInstance;
  private readonly phoneNumberId: string;
  private readonly accessToken: string;
  private readonly apiVersion: string;
  private readonly verifyToken: string;

  constructor(private readonly configService: ConfigService) {
    this.phoneNumberId = this.configService.get<string>('META_PHONE_NUMBER_ID') || '';
    this.accessToken = this.configService.get<string>('META_ACCESS_TOKEN') || '';
    this.apiVersion = this.configService.get<string>('META_API_VERSION') || 'v19.0';
    this.verifyToken = this.configService.get<string>('META_VERIFY_TOKEN') || '';

    this.http = axios.create({
      baseURL: `https://graph.facebook.com/${this.apiVersion}`,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode === 'subscribe' && token === this.verifyToken) {
      this.logger.log('Webhook verified successfully');
      return challenge;
    }
    throw new HttpException('Forbidden', HttpStatus.FORBIDDEN);
  }

  processWebhook(body: any): {
    messages: WhatsAppWebhookMessage[];
    contacts: WhatsAppContact[];
  } {
    const messages: WhatsAppWebhookMessage[] = [];
    const contacts: WhatsAppContact[] = [];

    try {
      if (body.entry && body.entry.length > 0) {
        for (const entry of body.entry) {
          if (entry.changes && entry.changes.length > 0) {
            for (const change of entry.changes) {
              if (change.value && change.value.messages) {
                messages.push(...change.value.messages);
              }
              if (change.value && change.value.contacts) {
                contacts.push(...change.value.contacts);
              }
            }
          }
        }
      }
    } catch (error) {
      this.logger.error('Error processing webhook', error);
    }

    return { messages, contacts };
  }

  async sendMessage(to: string, message: string): Promise<any> {
    const payload: WhatsAppMessage = {
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body: message },
    };

    try {
      const response = await this.http.post(`/${this.phoneNumberId}/messages`, payload);
      this.logger.log(`Message sent to ${to}`);
      return response.data;
    } catch (error) {
      this.logger.error('Error sending message', error.response?.data || error.message);
      throw new HttpException('Failed to send WhatsApp message', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async sendTemplateMessage(to: string, templateName: string, components?: any[]): Promise<any> {
    const payload: WhatsAppMessage = {
      messaging_product: 'whatsapp',
      to,
      type: 'template',
      template: {
        name: templateName,
        language: { code: 'en_US' },
        components,
      },
    };

    try {
      const response = await this.http.post(`/${this.phoneNumberId}/messages`, payload);
      this.logger.log(`Template message sent to ${to}`);
      return response.data;
    } catch (error) {
      this.logger.error('Error sending template', error.response?.data || error.message);
      throw new HttpException('Failed to send template message', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async sendImageMessage(to: string, imageUrl: string, caption?: string): Promise<any> {
    const payload = {
      messaging_product: 'whatsapp',
      to,
      type: 'image',
      image: { link: imageUrl, caption },
    };

    try {
      const response = await this.http.post(`/${this.phoneNumberId}/messages`, payload);
      this.logger.log(`Image message sent to ${to}`);
      return response.data;
    } catch (error) {
      this.logger.error('Error sending image', error.response?.data || error.message);
      throw new HttpException('Failed to send image message', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async markMessageAsRead(messageId: string): Promise<any> {
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    };

    try {
      const response = await this.http.post(`/${this.phoneNumberId}/messages`, payload);
      return response.data;
    } catch (error) {
      this.logger.error('Error marking message read', error.response?.data || error.message);
      throw new HttpException('Failed to mark message read', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async getPhoneNumberDetails(): Promise<any> {
    try {
      const response = await this.http.get(`/${this.phoneNumberId}`);
      return response.data;
    } catch (error) {
      this.logger.error('Error getting phone details', error.response?.data || error.message);
      throw new HttpException('Failed to get phone details', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
