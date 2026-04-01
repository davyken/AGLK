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
    const { messages, contacts } = this.whatsAppService.processWebhook(body);

    for (const message of messages) {
      this.logger.log(`Message from ${message.from}: ${message.type}`);

      if (message.id) {
        this.whatsAppService.markMessageAsRead(message.id).catch((err) => {
          this.logger.error(`Failed to mark message ${message.id} as read`, err);
        });
      }

      if (message.type === 'text' && message.text?.body) {
        await this.whatsAppService.handleIncomingMessage(message.from, message.text.body, contacts);
      } else if (message.type === 'interactive') {
        await this.whatsAppService.handleInteractiveMessage(message);
      } else if (message.type === 'location') {
        await this.whatsAppService.handleLocationMessage(message);
      }
    }

    return { success: true, message: 'OK' };
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
