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
    private readonly botService:   BotService,
    private readonly metaSender:   MetaSenderService,
    private readonly aiService:    AiService,
    private readonly listingFlow:  ListingFlowService,
    private readonly usersService: UsersService,
    private readonly config:       ConfigService,
  ) {}

  // ─────────────────────────────────────────────────────────
  // GET /bot/webhook — Meta one-time verification
  // ─────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────
  // POST /bot/webhook — All incoming WhatsApp messages
  // ─────────────────────────────────────────────────────────
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async receiveWhatsApp(@Body() body: Record<string, any>) {
    try {
      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) return { status: 'no_message' };

      const phone       = message.from as string;
      const msgType     = message.type as string;
      const messageId   = message.id   as string;
      const accessToken = this.config.get<string>('META_ACCESS_TOKEN')!;

      // ── Load user for language ─────────────────────────────
      const user = await this.usersService.findByPhone(phone);
      const lang: Language = (user as any)?.language ?? 'english';

      // ── Mark as read + typing — always, immediately ────────
      await this.metaSender.markAsRead(messageId);
      this.metaSender.sendTypingIndicator(phone).catch(() => {});

      // ─────────────────────────────────────────────────────
      // 1. TEXT
      // ─────────────────────────────────────────────────────
      if (msgType === 'text') {
        const text = message?.text?.body ?? '';
        if (!text) return { status: 'empty_text' };

        const reply = await this.botService.handleMessage({
          phone,
          text,
          channel: 'whatsapp',
        });

        if (reply) await this.metaSender.send(phone, reply);
        return { status: 'ok' };
      }

      // ─────────────────────────────────────────────────────
      // 2. VOICE NOTE / AUDIO
      // ─────────────────────────────────────────────────────
      if (msgType === 'audio') {
        const mediaId = message?.audio?.id;
        if (!mediaId) return { status: 'no_media_id' };

        // Acknowledge immediately while Whisper runs (Whisper can take 3-5s)
        const ackMsgs: Record<Language, string> = {
          english: `🎤 Got your voice note! Processing...`,
          french:  `🎤 Message vocal reçu! Traitement en cours...`,
          pidgin:  `🎤 Voice note don reach! I dey process am...`,
        };
        await this.metaSender.send(phone, ackMsgs[lang]);

        // Get download URL from Meta
        const mediaUrl = await this.getMediaUrl(mediaId, accessToken);
        if (!mediaUrl) {
          // ✅ await reply() — it returns Promise<string>
          await this.metaSender.send(
            phone,
            await this.aiService.reply('voice_failed', lang, {}),
          );
          return { status: 'media_url_failed' };
        }

        // Transcribe with OpenAI Whisper
        const { text: transcribed, language: detectedLang } =
          await this.aiService.transcribeVoiceNote(mediaUrl, accessToken);

        if (!transcribed) {
          // ✅ await reply()
          await this.metaSender.send(
            phone,
            await this.aiService.reply('voice_failed', detectedLang, {}),
          );
          return { status: 'transcription_failed' };
        }

        this.logger.log(`Voice [${phone}] [${detectedLang}]: "${transcribed}"`);

        // Persist language if it changed
        if (user && detectedLang !== lang) {
          await this.usersService.updateLanguage(phone, detectedLang);
        }

        // Show user what was heard — ✅ await reply()
        await this.metaSender.send(
          phone,
          await this.aiService.reply('voice_received', detectedLang, {
            text: transcribed,
          }),
        );

        // Process transcribed text exactly like a text message
        const reply = await this.botService.handleMessage({
          phone,
          text:    transcribed,
          channel: 'whatsapp',
        });

        if (reply) await this.metaSender.send(phone, reply);
        return { status: 'ok' };
      }

      // ─────────────────────────────────────────────────────
      // 3. IMAGE — farmer uploading product photo
      // ─────────────────────────────────────────────────────
      if (msgType === 'image') {
        const mediaId = message?.image?.id;
        const caption = message?.image?.caption ?? '';

        if (!mediaId) return { status: 'no_image_id' };

        // Farmer is mid-listing and waiting to upload a photo
        if (this.listingFlow.isInImageState(phone)) {
          const reply = await this.listingFlow.handleImage(phone, null, mediaId);
          if (reply) await this.metaSender.send(phone, reply);
          return { status: 'ok' };
        }

        // Not expecting an image
        if (caption) {
          const reply = await this.botService.handleMessage({
            phone,
            text:    caption,
            channel: 'whatsapp',
          });
          if (reply) await this.metaSender.send(phone, reply);
        } else {
          const msgs: Record<Language, string> = {
            english: `📷 Photo received!\n\nTo attach a photo to your listing:\n1. Send: SELL maize 10 bags\n2. Then send your photo`,
            french:  `📷 Photo reçue!\n\nPour ajouter une photo à votre annonce:\n1. Envoyez: VENDRE maïs 10 sacs\n2. Puis envoyez votre photo`,
            pidgin:  `📷 Photo don reach!\n\nFor attach photo to listing:\n1. Send: SELL maize 10 bags\n2. Then send the photo`,
          };
          await this.metaSender.send(phone, msgs[lang]);
        }
        return { status: 'image_not_expected' };
      }

      // ─────────────────────────────────────────────────────
      // 4. INTERACTIVE BUTTON REPLY
      // Fires when user taps a WhatsApp button
      // ─────────────────────────────────────────────────────
      if (msgType === 'interactive') {
        const buttonId    = message?.interactive?.button_reply?.id    ?? '';
        const buttonTitle = message?.interactive?.button_reply?.title ?? '';
        const text        = buttonId || buttonTitle;

        const reply = await this.botService.handleMessage({
          phone,
          text,
          channel: 'whatsapp',
        });
        if (reply) await this.metaSender.send(phone, reply);
        return { status: 'ok' };
      }

      // ─────────────────────────────────────────────────────
      // 5. UNSUPPORTED TYPE
      // ─────────────────────────────────────────────────────
      const unsupported: Record<Language, string> = {
        english: `❓ I can handle text, voice notes, and photos.\n\nType HELP for options.`,
        french:  `❓ Je traite les textes, messages vocaux et photos.\n\nTapez AIDE pour les options.`,
        pidgin:  `❓ I fit handle text, voice and photo.\n\nType HELP for options.`,
      };
      await this.metaSender.send(phone, unsupported[lang]);
      return { status: 'unsupported_type' };

    } catch (err) {
      this.logger.error('Webhook error', err);
      return { status: 'error_handled' };
    }
  }

  // ─────────────────────────────────────────────────────────
  // POST /bot/sms — Incoming SMS
  // ─────────────────────────────────────────────────────────
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

  // ─────────────────────────────────────────────────────────
  // PRIVATE: fetch media download URL from Meta
  // ─────────────────────────────────────────────────────────
  private async getMediaUrl(
    mediaId:     string,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const apiVersion = this.config.get<string>('META_API_VERSION') ?? 'v19.0';
      const res  = await fetch(
        `https://graph.facebook.com/${apiVersion}/${mediaId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      const data = await res.json() as { url?: string };
      return data?.url ?? null;
    } catch {
      return null;
    }
  }
}