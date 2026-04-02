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
import { UsersService } from '../users/users.service';
import { ListingFlowService } from './listing.flow';
import { SpeechToTextService } from '../ai/speech-to-text.service';

@Controller('bot')
export class BotController {
  constructor(
    private readonly botService: BotService,
    private readonly metaSender: MetaSenderService,
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
    private readonly listingFlow: ListingFlowService,
    private readonly speechToText: SpeechToTextService,
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
      const image = message?.image;
      const audio = message?.audio;

      // Handle image message - farmer sending product photo
      if (image) {
        const imageUrl = image.link; // Direct URL if available
        const imageMediaId = image.id; // Media ID for uploaded images

        return this.handleMediaMessage(phone, 'image', imageUrl, imageMediaId);
      }

      // Handle audio/voice note
      if (audio) {
        const audioMediaId = audio.id;

        return this.handleMediaMessage(phone, 'audio', null, audioMediaId);
      }

      // Handle regular text message
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

  /**
   * Handle media messages (images, voice notes)
   */
  private async handleMediaMessage(
    phone: string,
    mediaType: 'image' | 'audio',
    mediaUrl: string | null,
    mediaId: string | null,
  ): Promise<{ status: string }> {
    try {
      // Check if user is registered
      const user = await this.usersService.findByPhone(phone);

      if (!user || user.conversationState !== 'REGISTERED') {
        const reply = 'Please register first. Reply Hi to start.';
        await this.metaSender.send(phone, reply);
        return { status: 'not_registered' };
      }

      if (mediaType === 'image') {
        // Handle image - check if user is in pending sell state
        if (this.listingFlow.isInImageState(phone)) {
          await this.listingFlow.handleImage(phone, mediaUrl, mediaId);
          return { status: 'image_processed' };
        }

        // Otherwise, ask if they want to add image to a new listing
        const reply =
          '📷 Image received!\n\nTo add this image to your listing, use:\nSELL maize 10 bags\n\nThen reply with this image after entering the price.\n\nOr type HELP for options.';
        await this.metaSender.send(phone, reply);
        return { status: 'image_received' };
      }

      if (mediaType === 'audio') {
        // Handle voice note - transcribe using AI
        try {
          const transcription = await this.speechToText.transcribe(
            mediaUrl || undefined,
            mediaId || undefined,
          );

          if (!transcription) {
            const reply =
              '🎤 Sorry, I could not understand the voice note.\n\n' +
              'Please type your message or:\n' +
              '- SELL maize 10 bags\n' +
              '- BUY maize 20 bags\n\n' +
              'Type HELP for options.';
            await this.metaSender.send(phone, reply);
            return { status: 'transcription_failed' };
          }

          // Process the transcribed text as a command
          const reply = await this.botService.handleMessage({
            phone,
            text: transcription,
            channel: 'whatsapp',
          });

          await this.metaSender.send(phone, reply);
          return { status: 'voice_processed' };
        } catch (error) {
          console.error('Voice transcription error:', error);
          const reply =
            '🎤 Sorry, I could not process the voice note.\n\n' +
            'Please try typing your message.';
          await this.metaSender.send(phone, reply);
          return { status: 'transcription_error' };
        }
      }

      return { status: 'ok' };
    } catch (error) {
      console.error('Media handling error:', error);
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
