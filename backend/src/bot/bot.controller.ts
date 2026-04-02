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
import { MetaSenderService } from '../whatsapp/meta-sender.service';
import { AiService } from '../ai/ai.service';
import { ConfigService } from '@nestjs/config';

@Controller('bot')
export class BotController {
  constructor(
    private readonly botService: BotService,
    private readonly metaSender: MetaSenderService,
    private readonly aiService: AiService,
    private readonly config: ConfigService,
  ) {}

  // ─── GET /bot/webhook — Meta verification ─────────────────
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

  // ─── POST /bot/webhook — Receive WhatsApp messages ────────
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receiveWhatsApp(@Body() body: Record<string, any>) {
    try {
      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) return { status: 'no_message' };

      const phone = message.from;
      const msgType = message.type; // 'text' | 'audio'

      let text = '';

      // ── TEXT message ──────────────────────────────────────
      if (msgType === 'text') {
        text = message?.text?.body ?? '';
      }

      // ── VOICE NOTE / AUDIO message ────────────────────────
      if (msgType === 'audio') {
        const mediaId = message?.audio?.id;
        const accessToken = this.config.get<string>('META_ACCESS_TOKEN');

        if (!mediaId || !accessToken) {
          await this.metaSender.send(
            phone,
            this.aiService.reply('voice_failed', 'english', {}),
          );
          return { status: 'media_url_failed' };
        }

        // Step 1: Get the download URL from Meta
        const mediaUrl = await this.getMediaUrl(mediaId, accessToken);

        if (!mediaUrl) {
          // Could not get URL — ask user to type instead
          await this.metaSender.send(
            phone,
            this.aiService.reply('voice_failed', 'english', {}),
          );
          return { status: 'media_url_failed' };
        }

        // Step 2: Transcribe with Whisper
        const { text: transcribed, language } =
          await this.aiService.transcribeVoiceNote(mediaUrl, accessToken);

        if (!transcribed) {
          await this.metaSender.send(
            phone,
            this.aiService.reply('voice_failed', language, {}),
          );
          return { status: 'transcription_failed' };
        }

        // Step 3: Show user what was heard then process it
        await this.metaSender.send(
          phone,
          this.aiService.reply('voice_received', language, { text: transcribed }),
        );

        text = transcribed; // treat transcribed text like a normal message
      }

      if (!text) return { status: 'unsupported_message_type' };

      // ── Process through bot ───────────────────────────────
      const reply = await this.botService.handleMessage({
        phone,
        text,
        channel: 'whatsapp',
      });

      if (reply) await this.metaSender.send(phone, reply);

      return { status: 'ok' };
    } catch {
      return { status: 'error_handled' };
    }
  }

  // ─── POST /bot/sms — Receive SMS ──────────────────────────
  @Post('sms')
  @HttpCode(HttpStatus.OK)
  async receiveSms(@Body() body: Record<string, any>) {
    try {
      const phone = body?.from ?? body?.From ?? '';
      const text  = body?.text ?? body?.Body ?? '';
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

  // ─── Get Media Download URL from Meta ─────────────────────
  private async getMediaUrl(
    mediaId: string,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(
        `https://graph.facebook.com/v18.0/${mediaId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = await res.json() as { url?: string };
      return data?.url ?? null;
    } catch {
      return null;
    }
  }
}