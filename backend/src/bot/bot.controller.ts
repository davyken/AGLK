import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { BotService } from './bot.service';
import { MetaSenderService } from './meta-sender.service';
import { ConfigService } from '@nestjs/config';

@Controller('bot')
export class BotController {
  constructor(
    private readonly botService: BotService,
    private readonly metaSender: MetaSenderService,
    private readonly config: ConfigService,
  ) {}

  @Get('webhook')
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ) {
    const verifyToken = this.config.get<string>('META_VERIFY_TOKEN');

    if (mode === 'subscribe' && token === verifyToken) {
      return res.status(200).send(challenge);
    }

    return res.status(403).send('Forbidden');
  }

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receiveWhatsApp(@Body() body: Record<string, any>) {
    try {
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const messages = value?.messages;

      if (!messages || messages.length === 0) {
        return { status: 'no_message' };
      }

      const message = messages[0];
      const phone = message.from;
      const text = message?.text?.body ?? '';

      if (!text) return { status: 'non_text_message' };

      const reply = await this.botService.handleMessage({
        phone,
        text,
        channel: 'whatsapp',
      });

      await this.metaSender.send(phone, reply);

      return { status: 'ok' };
    } catch {
      return { status: 'error_handled' };
    }
  }

  @Post('sms')
  @HttpCode(HttpStatus.OK)
  async receiveSms(@Body() body: Record<string, any>) {
    try {
      const phone = body?.from ?? body?.From ?? '';
      const text = body?.text ?? body?.Body ?? '';

      if (!phone || !text) return { status: 'invalid_payload' };

      const reply = await this.botService.handleMessage({
        phone,
        text,
        channel: 'sms',
      });

      return { message: reply };
    } catch {
      return { status: 'error_handled' };
    }
  }
}
