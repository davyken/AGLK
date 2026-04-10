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
import { TwilioSmsService } from '../whatsapp/twilio-sms.service';
import { TextToSpeechService } from '../ai/text-to-speech.service';
import { AiService, Language } from '../ai/ai.service';
import { ListingFlowService } from '../bot/listing.flow';
import { UsersService } from '../users/users.service';
import { ConfigService } from '@nestjs/config';

@Controller('bot')
export class BotController {
  private readonly logger = new Logger(BotController.name);

  constructor(
    private readonly botService: BotService,
    private readonly metaSender: MetaSenderService,
    private readonly twilioSms: TwilioSmsService,
    private readonly aiService: AiService,
    private readonly textToSpeech: TextToSpeechService,
    private readonly listingFlow: ListingFlowService,
    private readonly usersService: UsersService,
    private readonly config: ConfigService,
  ) {}

  private async sendReply(
    phone: string,
    message: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<void> {
    if (channel === 'sms') {
      await this.twilioSms.send(phone, message);
    } else {
      await this.metaSender.send(phone, message);
    }
  }

  /**
   * Send a voice reply (audio) along with optional text fallback.
   * Used when user sends voice input — bot replies with voice.
   */
  private async sendVoiceReply(
    phone: string,
    message: string,
    lang: Language,
    sendText: boolean = true,
  ): Promise<void> {
    // Generate voice response
    const audioMediaId = await this.textToSpeech.generateAndUpload(
      message,
      lang,
    );

    if (audioMediaId) {
      // Send audio
      await this.metaSender.sendAudio(phone, audioMediaId);
      this.logger.log(`Voice reply sent to ${phone} (media ID: ${audioMediaId})`);
    } else {
      // Fallback to text if TTS failed
      this.logger.warn(`TTS failed for ${phone}, sending text instead`);
      if (sendText) {
        await this.metaSender.send(phone, message);
      }
    }
  }

  private async sendInteractiveReply(
    phone: string,
    bodyText: string,
    buttons: { id: string; title: string }[],
    channel: 'sms' | 'whatsapp',
    headerText?: string,
  ): Promise<void> {
    if (channel === 'sms') {
      const buttonText = buttons.map((b) => `🔘 ${b.title}`).join('\n');
      await this.twilioSms.send(phone, `${bodyText}\n\n${buttonText}`);
    } else {
      await this.metaSender.sendWithButtons(
        phone,
        bodyText,
        buttons,
        headerText,
      );
    }
  }

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

      const phone = message.from as string;
      const msgType = message.type as string;
      const accessToken = this.config.get<string>('META_ACCESS_TOKEN')!;

      const user = await this.usersService.findByPhone(phone);
      const lang: Language = (user as any)?.language ?? 'english';

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

      if (msgType === 'audio') {
        const mediaId = message?.audio?.id;
        if (!mediaId) return { status: 'no_media_id' };

        // Step 1 — immediate acknowledgement (before the slow Whisper call)
        await this.metaSender.send(
          phone,
          await this.aiService.reply('voice_processing', lang, {}),
        );

        const mediaUrl = await this.getMediaUrl(mediaId, accessToken);
        if (!mediaUrl) {
          const failureMsg = await this.aiService.reply('voice_failed', lang, {});
          await this.sendVoiceReply(phone, failureMsg, lang, true);
          return { status: 'media_url_failed' };
        }

        const { text: transcribed, language: detectedLang } =
          await this.aiService.transcribeVoiceNote(mediaUrl, accessToken);

        if (!transcribed) {
          const failureMsg = await this.aiService.reply('voice_failed', detectedLang, {});
          await this.sendVoiceReply(phone, failureMsg, detectedLang, true);
          return { status: 'transcription_failed' };
        }

        this.logger.log(`Voice transcribed [${phone}]: "${transcribed}"`);

<<<<<<< HEAD
        // Send confirmation that voice was received (as voice)
        const confirmMsg = await this.aiService.reply('voice_received', detectedLang, {
          text: transcribed,
        });
        await this.sendVoiceReply(phone, confirmMsg, detectedLang, true);

        if (user && detectedLang !== lang) {
          await this.usersService.updateLanguage(phone, detectedLang);
        }

        // Process the transcribed text and get bot reply
=======
        if (user && detectedLang !== lang) {
          await this.usersService.updateLanguage(phone, detectedLang);
        }

        // Step 2 — show what was heard, then process
        await this.sendReply(
          phone,
          await this.aiService.reply('voice_received', detectedLang, {
            text: transcribed,
          }),
          'whatsapp',
        );

>>>>>>> ec1d005c4267d4ff113acacc67d32bf5e569ba0a
        const reply = await this.botService.handleMessage({
          phone,
          text: transcribed,
          channel: 'whatsapp',
        });

        // Send bot reply as voice (since user sent voice)
        if (reply) {
          await this.sendVoiceReply(phone, reply, detectedLang, true);
        }

        return { status: 'ok' };
      }

      if (msgType === 'image') {
        const mediaId = message?.image?.id;
        const caption = message?.image?.caption ?? '';

        if (!mediaId) return { status: 'no_image_id' };

        if (!this.listingFlow.isInImageState(phone)) {
          if (caption) {
            const reply = await this.botService.handleMessage({
              phone,
              text: caption,
              channel: 'whatsapp',
            });
            if (reply) await this.sendReply(phone, reply, 'whatsapp');
          } else {
            const msgs: Record<Language, string> = {
              english: `📷 Photo received!\n\nTo list produce with a photo:\nSELL maize 10 bags\n(then send your photo)`,
              french: `📷 Photo reçue!\n\nPour lister avec une photo:\nVENDRE maïs 10 sacs\n(puis envoyez la photo)`,
              pidgin: `📷 Photo don reach!\n\nFor list with photo:\nSELL maize 10 bags\n(then send the photo)`,
            };
            await this.sendReply(phone, msgs[lang], 'whatsapp');
          }
          return { status: 'image_not_expected' };
        }

        const reply = await this.listingFlow.handleImage(phone, null, mediaId);
        if (reply) await this.sendReply(phone, reply, 'whatsapp');
        return { status: 'ok' };
      }

      const unsupported: Record<Language, string> = {
        english: `❌ I can only process text, voice notes, and images.\n\nType HELP for options.`,
        french: `❌ Je traite seulement les textes, messages vocaux et images.\n\nTapez AIDE pour les options.`,
        pidgin: `❌ I only understand text, voice and photo.\n\nType HELP for options.`,
      };
      await this.sendReply(phone, unsupported[lang], 'whatsapp');
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

  private async getMediaUrl(
    mediaId: string,
    accessToken: string,
  ): Promise<string | null> {
    try {
      const res = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const data = (await res.json()) as { url?: string };
      return data?.url ?? null;
    } catch {
      return null;
    }
  }
}
