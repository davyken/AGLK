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

  // ─── GET /bot/webhook — Meta verification (one-time) ─────
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

  // ─── POST /bot/webhook — Receive WhatsApp messages ───────
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receiveWhatsApp(@Body() body: Record<string, any>) {
    try {
      // Extract message from Meta payload
      const entry = body?.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const messages = value?.messages;

      if (!messages || messages.length === 0) {
        return { status: 'no_message' };
      }

      const message = messages[0];
      const phone = message.from;           // e.g. "237650000000"
      const text = message?.text?.body ?? '';

      if (!text) return { status: 'non_text_message' };

      // Process through bot
      const reply = await this.botService.handleMessage({
        phone,
        text,
        channel: 'whatsapp',
      });

      // Send reply back via Meta
      await this.metaSender.send(phone, reply);

      return { status: 'ok' };
    } catch {
      // Always return 200 to Meta — never let webhook fail
      return { status: 'error_handled' };
    }
  }

  // ─── POST /bot/sms — Receive SMS (Africa's Talking etc.) ──
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

      // SMS reply handled by gateway (return text in body for some providers)
      return { message: reply };
    } catch {
      return { status: 'error_handled' };
    }
  }
}