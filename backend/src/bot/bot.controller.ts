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
import { VoltAgentService } from '../voltagent/voltagent.service';
import { MetaSenderService } from '../whatsapp/meta-sender.service';
import { AiService, Language } from '../ai/ai.service';
import { ListingFlowService } from '../bot/listing.flow';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';

@Controller('bot')
export class BotController {
  private readonly logger = new Logger(BotController.name);

  constructor(
    private readonly voltAgent:    VoltAgentService,
    private readonly metaSender:   MetaSenderService,
    private readonly aiService:    AiService,
    private readonly listingFlow:  ListingFlowService,
    private readonly usersService: UsersService,
    private readonly config:       ConfigService,
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
      const message = body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
      if (!message) return { status: 'no_message' };

      const phone       = message.from as string;
      const msgType     = message.type as string;
      const messageId   = message.id   as string;
      const accessToken = this.config.get<string>('META_ACCESS_TOKEN')!;

      const user = await this.usersService.findByPhone(phone);
      const lang: Language = (user as any)?.language ?? 'english';

      await this.metaSender.markAsRead(messageId);
      this.metaSender.sendTypingIndicator(phone).catch(() => {});

      if (msgType === 'text') {
        const text = message?.text?.body ?? '';
        if (!text) return { status: 'empty_text' };

        const reply = await this.voltAgent.handle(text, phone);

        if (reply) await this.metaSender.send(phone, reply);
        return { status: 'ok' };
      }

      if (msgType === 'audio') {
        const mediaId = message?.audio?.id;
        if (!mediaId) return { status: 'no_media_id' };

        const ackMsgs: Record<Language, string> = {
          english: `Got your voice note! Processing...`,
          french:  `Message vocal recu! Traitement en cours...`,
          pidgin:  `Voice note don reach! I dey process am...`,
        };
        await this.metaSender.send(phone, ackMsgs[lang]);

        const mediaUrl = await this.getMediaUrl(mediaId, accessToken);
        if (!mediaUrl) {
          await this.metaSender.send(
            phone,
            await this.aiService.reply('voice_failed', lang, {}),
          );
          return { status: 'media_url_failed' };
        }

        const { text: transcribed, language: detectedLang } =
          await this.aiService.transcribeVoiceNote(mediaUrl, accessToken);

        if (!transcribed) {
          await this.metaSender.send(
            phone,
            await this.aiService.reply('voice_failed', detectedLang, {}),
          );
          return { status: 'transcription_failed' };
        }

        this.logger.log(`Voice [${phone}] [${detectedLang}]: "${transcribed}"`);

        if (user && detectedLang !== lang) {
          await this.usersService.updateLanguage(phone, detectedLang);
        }

        await this.metaSender.send(
          phone,
          await this.aiService.reply('voice_received', detectedLang, {
            text: transcribed,
          }),
        );

        const reply = await this.voltAgent.handle(transcribed, phone);

        if (reply) await this.metaSender.send(phone, reply);
        return { status: 'ok' };
      }

      if (msgType === 'image') {
        const mediaId = message?.image?.id;
        const caption = message?.image?.caption ?? '';

        if (!mediaId) return { status: 'no_image_id' };

        if (this.listingFlow.isInImageState(phone)) {
          const reply = await this.listingFlow.handleImage(phone, null, mediaId);
          if (reply) await this.metaSender.send(phone, reply);
          return { status: 'ok' };
        }

        if (caption) {
          const reply = await this.voltAgent.handle(caption, phone);
          if (reply) await this.metaSender.send(phone, reply);
        } else {
          const msgs: Record<Language, string> = {
            english: `Photo received!\n\nTo attach a photo to your listing:\n1. Send: SELL maize 10 bags\n2. Then send your photo`,
            french:  `Photo recue!\n\nPour ajouter une photo a votre annonce:\n1. Envoyez: VENDRE mais 10 sacs\n2. Puis envoyez votre photo`,
            pidgin:  `Photo don reach!\n\nFor attach photo to listing:\n1. Send: SELL maize 10 bags\n2. Then send the photo`,
          };
          await this.metaSender.send(phone, msgs[lang]);
        }
        return { status: 'image_not_expected' };
      }

      if (msgType === 'interactive') {
        const buttonId    = message?.interactive?.button_reply?.id    ?? '';
        const buttonTitle = message?.interactive?.button_reply?.title ?? '';
        const text        = buttonId || buttonTitle;

        const reply = await this.voltAgent.handle(text, phone);
        if (reply) await this.metaSender.send(phone, reply);
        return { status: 'ok' };
      }

      const unsupported: Record<Language, string> = {
        english: `I can handle text, voice notes, and photos.\n\nType HELP for options.`,
        french:  `Je traite les textes, messages vocaux et photos.\n\nTapez AIDE pour les options.`,
        pidgin:  `I fit handle text, voice and photo.\n\nType HELP for options.`,
      };
      await this.metaSender.send(phone, unsupported[lang]);
      return { status: 'unsupported_type' };

    } catch (err) {
      this.logger.error('Webhook error', err);
      return { status: 'error_handled' };
    }
  }

  @Post('sms')
  @HttpCode(HttpStatus.OK)
  async receiveSms(@Body() body: Record<string, any>) {
    try {
      const phone = body?.from ?? body?.From ?? '';
      const text  = body?.text ?? body?.Body ?? '';
      if (!phone || !text) return { status: 'invalid_payload' };

      const reply = await this.voltAgent.handle(text, phone);

      return { message: reply };
    } catch {
      return { status: 'error_handled' };
    }
  }

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