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
    sendText: boolean = false,
  ): Promise<void> {
    // Generate voice response
    const audioMediaId = await this.textToSpeech.generateAndUpload(
      message,
      lang,
    );

    if (audioMediaId) {
      // Send audio only - no text fallback needed for voice input
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

        // Mark message as read immediately (shows blue checkmarks)
        await this.metaSender.markAsRead(phone, message.id);

        const reply = await this.botService.handleMessage({
          phone,
          text,
          channel: 'whatsapp',
        });
        if (reply) {
          // Natural typing delay proportional to reply length
          await new Promise((r) =>
            setTimeout(r, MetaSenderService.typingDelay(reply.length)),
          );
          await this.metaSender.send(phone, reply);
        }
        return { status: 'ok' };
      }

      if (msgType === 'audio') {
        const mediaId = message?.audio?.id;
        if (!mediaId) return { status: 'no_media_id' };

        // Get media URL - skip the "voice_processing" text message
        // User expects direct voice reply after their voice input
        // Mark as read immediately
        await this.metaSender.markAsRead(phone, message.id);

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

        // Transcribe voice note with enhanced context for agricultural terms
        const { text: transcribed, language: detectedLang } =
          await this.aiService.transcribeVoiceNote(mediaUrl, accessToken);

        if (!transcribed) {
          const failureMsg = await this.aiService.reply('voice_failed', lang, {});
          await this.sendVoiceReply(phone, failureMsg, lang, true);
          return { status: 'transcription_failed' };
        }

        this.logger.log(`Voice transcribed [${phone}]: "${transcribed}"`);

        // Update user's language if detected language differs
        if (user && detectedLang !== lang) {
          await this.usersService.updateLanguage(phone, detectedLang);
        }

        // Process the transcribed text and get bot reply
        // Send reply as VOICE ONLY - no text confirmation needed
        const reply = await this.botService.handleMessage({
          phone,
          text: transcribed,
          channel: 'whatsapp',
        });

        // Send bot reply as voice only (since user sent voice)
        if (reply) {
          await this.sendVoiceReply(phone, reply, detectedLang, false);
        }

        return { status: 'ok' };
      }

      if (msgType === 'image') {
        const mediaId = message?.image?.id;
        const caption = message?.image?.caption ?? '';

        if (!mediaId) return { status: 'no_image_id' };

        // Mark as read immediately
        await this.metaSender.markAsRead(phone, message.id);

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
              english: `📷 Got your photo! To attach it to a listing, first tell me what you're selling — like "I want to sell 10 bags of maize" — then send the photo.`,
              french: `📷 Photo reçue ! Pour l'ajouter à une annonce, dites-moi d'abord ce que vous vendez — par exemple "Je veux vendre 10 sacs de maïs" — puis envoyez la photo.`,
              pidgin: `📷 Photo don reach! To add am to listing, first tell me wetin you dey sell — like "I wan sell 10 bags maize" — then send the photo.`,
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
        english: `I can handle text messages, voice notes, and photos. What would you like to do?`,
        french: `Je peux traiter les messages texte, les notes vocales et les photos. Que voulez-vous faire?`,
        pidgin: `I fit handle text, voice note and photo. Wetin you wan do?`,
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
