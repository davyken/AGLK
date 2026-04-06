import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import { BotService } from './bot.service';
import { MetaSenderService } from '../whatsapp/meta-sender.service';
import { AiService, Language } from '../ai/ai.service';
import { ListingFlowService } from '../bot/listing.flow';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';

@Controller('bot')
export class BotController {
  private readonly logger = new Logger(BotController.name);

  constructor(
    private readonly botService:     BotService,
    private readonly metaSender:     MetaSenderService,
    private readonly aiService:      AiService,
    private readonly listingFlow:    ListingFlowService,
    private readonly usersService:   UsersService,
    private readonly config:         ConfigService,
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

  // ─── POST /bot/webhook — All WhatsApp messages ────────────
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receiveWhatsApp(@Body() body: Record<string, any>) {
    try {
      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) return { status: 'no_message' };

      const phone       = message.from as string;
      const msgType     = message.type as string;
      const accessToken = this.config.get<string>('META_ACCESS_TOKEN')!;

      // ── Get user language for error messages ──────────────
      const user = await this.usersService.findByPhone(phone);
      const lang: Language = (user as any)?.language ?? 'english';

      // ─────────────────────────────────────────────────────
      // 1. TEXT MESSAGE
      // ─────────────────────────────────────────────────────
      if (msgType === 'text') {
        const text = message?.text?.body ?? '';
        if (!text) return { status: 'empty_text' };

        const reply = await this.botService.handleMessage({ phone, text, channel: 'whatsapp' });
        if (reply) await this.metaSender.send(phone, reply);
        return { status: 'ok' };
      }

      // ─────────────────────────────────────────────────────
      // 2. VOICE NOTE / AUDIO
      // ─────────────────────────────────────────────────────
      if (msgType === 'audio') {
        const mediaId  = message?.audio?.id;
        if (!mediaId) return { status: 'no_media_id' };

        // Step 1: Get download URL from Meta
        const mediaUrl = await this.getMediaUrl(mediaId, accessToken);
        if (!mediaUrl) {
          await this.metaSender.send(phone, this.aiService.reply('voice_failed', lang, {}));
          return { status: 'media_url_failed' };
        }

        // Step 2: Transcribe with Groq Whisper
        const { text: transcribed, language: detectedLang } =
          await this.aiService.transcribeVoiceNote(mediaUrl, accessToken);

        if (!transcribed) {
          await this.metaSender.send(phone, this.aiService.reply('voice_failed', detectedLang, {}));
          return { status: 'transcription_failed' };
        }

        this.logger.log(`Voice transcribed [${phone}]: "${transcribed}"`);

        // Step 3: Tell user what was heard
        await this.metaSender.send(
          phone,
          this.aiService.reply('voice_received', detectedLang, { text: transcribed }),
        );

        // Step 4: Update language if detected from voice
        if (user && detectedLang !== lang) {
          await this.usersService.updateLanguage(phone, detectedLang);
        }

        // Step 5: Process transcribed text like a normal message
        const reply = await this.botService.handleMessage({
          phone,
          text:    transcribed,
          channel: 'whatsapp',
        });
        if (reply) await this.metaSender.send(phone, reply);
        return { status: 'ok' };
      }

      // ─────────────────────────────────────────────────────
      // 3. IMAGE — farmer sending product photo
      // ─────────────────────────────────────────────────────
      if (msgType === 'image') {
        const mediaId  = message?.image?.id;
        const caption  = message?.image?.caption ?? '';

        if (!mediaId) return { status: 'no_image_id' };

        // Only handle if farmer is waiting for an image (sell_waiting_image state)
        if (!this.listingFlow.isInImageState(phone)) {
          // Not expecting an image — treat caption as text if it exists
          if (caption) {
            const reply = await this.botService.handleMessage({
              phone,
              text:    caption,
              channel: 'whatsapp',
            });
            if (reply) await this.metaSender.send(phone, reply);
          } else {
            const msgs: Record<Language, string> = {
              english: `📷 Photo received!\n\nTo list produce with a photo:\nSELL maize 10 bags\n(then send your photo)`,
              french:  `📷 Photo reçue!\n\nPour lister avec une photo:\nVENDRE maïs 10 sacs\n(puis envoyez la photo)`,
              pidgin:  `📷 Photo don reach!\n\nFor list with photo:\nSELL maize 10 bags\n(then send the photo)`,
            };
            await this.metaSender.send(phone, msgs[lang]);
          }
          return { status: 'image_not_expected' };
        }

        // Farmer is in sell_waiting_image state → attach image to listing
        const reply = await this.listingFlow.handleImage(phone, null, mediaId);
        if (reply) await this.metaSender.send(phone, reply);
        return { status: 'ok' };
      }

      // ─────────────────────────────────────────────────────
      // 4. UNSUPPORTED message type
      // ─────────────────────────────────────────────────────
      const unsupported: Record<Language, string> = {
        english: `❌ I can only process text, voice notes, and images.\n\nType HELP for options.`,
        french:  `❌ Je traite seulement les textes, messages vocaux et images.\n\nTapez AIDE pour les options.`,
        pidgin:  `❌ I only understand text, voice and photo.\n\nType HELP for options.`,
      };
      await this.metaSender.send(phone, unsupported[lang]);
      return { status: 'unsupported_type' };

    } catch (err) {
      this.logger.error('Webhook error', err);
      return { status: 'error_handled' };
    }
  }

  // ─── POST /bot/sms ────────────────────────────────────────
  @Post('sms')
  @HttpCode(HttpStatus.OK)
  async receiveSms(@Body() body: Record<string, any>) {
    try {
      const phone = body?.from ?? body?.From ?? '';
      const text  = body?.text ?? body?.Body ?? '';
      if (!phone || !text) return { status: 'invalid_payload' };

      const reply = await this.botService.handleMessage({ phone, text, channel: 'sms' });
      return { message: reply };
    } catch {
      return { status: 'error_handled' };
    }
  }

  // ─── Get media download URL from Meta ─────────────────────
  private async getMediaUrl(
    mediaId:     string,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const res  = await fetch(
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