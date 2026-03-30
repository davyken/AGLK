import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';

@Controller('webhook')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(private readonly whatsAppService: WhatsAppService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  verifyWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.challenge') challenge: string,
    @Query('hub.verify_token') token: string,
  ): string {
    this.logger.log(`Webhook verification: mode=${mode}`);
    return this.whatsAppService.verifyWebhook(mode, token, challenge);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async handleWebhook(@Body() body: any): Promise<{ success: boolean; message: string }> {
    this.logger.log('Webhook received from WhatsApp');

    try {
      const { messages, contacts } = this.whatsAppService.processWebhook(body);

      for (const message of messages) {
        this.logger.log(`Message from ${message.from}: ${message.type}`);

        if (message.id) {
          await this.whatsAppService.markMessageAsRead(message.id);
        }

        if (message.type === 'text' && message.text?.body) {
          await this.handleIncomingMessage(message.from, message.text.body, contacts);
        } else if (message.type === 'interactive') {
          await this.handleInteractiveMessage(message);
        } else if (message.type === 'location') {
          await this.handleLocationMessage(message);
        }
      }

      return { success: true, message: 'OK' };
    } catch (error) {
      this.logger.error('Error processing webhook', error);
      return { success: false, message: 'Error processing webhook' };
    }
  }

  private async handleIncomingMessage(from: string, text: string, contacts: any[]): Promise<void> {
    const contact = contacts.find((c) => c.wa_id === from);
    const userName = contact?.profile?.name || 'User';

    const welcomeMessage = `Hello ${userName}! 👋

Welcome to Agrolink.

You can:
• List agricultural products
• Search for buyers/sellers
• Get market prices
• And more!

Type "help" for available commands.`;
    
    await this.whatsAppService.sendMessage(from, welcomeMessage);
  }

  private async handleInteractiveMessage(message: any): Promise<void> {
    const from = message.from;
    const interactive = message.interactive;

    if (interactive.type === 'button_reply') {
      const buttonId = interactive.button_reply.id;
      const buttonText = interactive.button_reply.title;

      let response = '';
      switch (buttonId) {
        case 'VIEW_PRODUCTS':
          response = 'Here are the available products...';
          break;
        case 'ADD_LISTING':
          response = 'To add a listing, please visit our app or website.';
          break;
        case 'CONTACT_SUPPORT':
          response = 'Our support team will contact you shortly.';
          break;
        default:
          response = `You clicked: ${buttonText}`;
      }

      await this.whatsAppService.sendMessage(from, response);
    } else if (interactive.type === 'list_reply') {
      const listTitle = interactive.list_reply.title;
      await this.whatsAppService.sendMessage(from, `You selected: ${listTitle}`);
    }
  }

  private async handleLocationMessage(message: any): Promise<void> {
    const from = message.from;
    const location = message.location;

    const response = `Thank you for sharing your location!

Latitude: ${location.latitude}
Longitude: ${location.longitude}`;
    await this.whatsAppService.sendMessage(from, response);
  }

  @Get('status')
  @HttpCode(HttpStatus.OK)
  getWebhookStatus(): { status: string; timestamp: string } {
    return {
      status: 'active',
      timestamp: new Date().toISOString(),
    };
  }
}
