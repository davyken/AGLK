import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

export type Language = 'english' | 'french' | 'pidgin';

export interface ParsedIntent {
  intent:    'register' | 'sell' | 'buy' | 'price' | 'help' | 'yes' | 'no' | 'unknown';
  language:  Language;
  product?:  string;
  quantity?: number;
  unit?:     string;
  price?:    number;
  raw:       string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openai: OpenAI;

  constructor(private readonly config: ConfigService) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY'),
    });
  }

  // ─── 1. Parse text intent (any language) ─────────────────
  async parseIntent(message: string): Promise<ParsedIntent> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini', // cheap + fast
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a parser for an agricultural marketplace bot in Cameroon.
Analyze the user message and return ONLY valid JSON.

Detect:
1. intent: one of [register, sell, buy, price, help, yes, no, unknown]
2. language: one of [english, french, pidgin]
3. product: crop name normalized to english lowercase ("maïs"→"maize", "tomate"→"tomatoes")
4. quantity: number if mentioned
5. unit: unit if mentioned, default "bags"
6. price: price number if mentioned

Pidgin examples: "I get maize plenty", "I wan sell", "I dey find tomatoes"
French examples: "j'ai du maïs", "je veux acheter", "quel est le prix"
Yes variants: YES, Oui, Yes na, Na so, D'accord
No variants: NO, Non, No be dat, Non merci

Return JSON: { "intent": "", "language": "", "product": null, "quantity": null, "unit": "bags", "price": null }`,
          },
          { role: 'user', content: message },
        ],
      });

      const text = completion.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(text);
      return { ...parsed, raw: message };
    } catch (err) {
      this.logger.error('parseIntent failed', err);
      return { intent: 'unknown', language: 'english', raw: message };
    }
  }

  // ─── 2. Transcribe voice note using Whisper ───────────────
  // Meta sends audio as a media URL — we download it, then transcribe
  async transcribeVoiceNote(
    mediaUrl: string,
    accessToken: string,
  ): Promise<{ text: string; language: Language }> {
    const tmpPath = path.join('/tmp', `voice_${Date.now()}.ogg`);

    try {
      // Step 1: Download the audio file from Meta
      await this.downloadFile(mediaUrl, accessToken, tmpPath);

      // Step 2: Send to OpenAI Whisper
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: 'whisper-1',
        // Whisper auto-detects language — works for French, English, Pidgin
      });

      const text = transcription.text ?? '';

      // Step 3: Detect language from transcribed text
      const parsed = await this.parseIntent(text);

      this.logger.log(`Voice transcribed: "${text}" [${parsed.language}]`);

      return { text, language: parsed.language };
    } catch (err) {
      this.logger.error('Voice transcription failed', err);
      return { text: '', language: 'english' };
    } finally {
      // Clean up temp file
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  // ─── 3. Download audio from Meta CDN ─────────────────────
  private downloadFile(
    url: string,
    accessToken: string,
    dest: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https.get(
        url,
        { headers: { Authorization: `Bearer ${accessToken}` } },
        (res) => {
          res.pipe(file);
          file.on('finish', () => { file.close(); resolve(); });
        },
      ).on('error', (err) => {
        fs.unlink(dest, () => {});
        reject(err);
      });
    });
  }

  // ─── 4. Reply templates in all 3 languages ────────────────
  reply(
    templateKey: string,
    language: Language,
    data: Record<string, string | number> = {},
  ): string {
    const t = this.templates();
    const template = t[templateKey];
    if (!template) return t['unknown_command'][language];

    let msg = template[language] ?? template['english'];

    // Replace placeholders like ${name}, ${product}
    Object.entries(data).forEach(([key, val]) => {
      msg = msg.replace(new RegExp(`\\$\\{${key}\\}`, 'g'), String(val));
    });

    return msg;
  }

  // ─── 5. All message templates ─────────────────────────────
  private templates(): Record<string, Record<Language, string>> {
    return {
      welcome: {
        english: `👋 Welcome to FarmerConnect!\n\nAre you a:\n1️⃣ Farmer (I sell produce)\n2️⃣ Buyer (I buy produce)\n\nReply 1 or 2`,
        french:  `👋 Bienvenue sur FarmerConnect!\n\nÊtes-vous:\n1️⃣ Agriculteur (je vends)\n2️⃣ Acheteur (j'achète)\n\nRépondez 1 ou 2`,
        pidgin:  `👋 Welcome for FarmerConnect!\n\nYou be:\n1️⃣ Farmer (I dey sell)\n2️⃣ Buyer (I dey buy)\n\nSend 1 or 2`,
      },
      ask_name: {
        english: `What is your full name?`,
        french:  `Quel est votre nom complet?`,
        pidgin:  `Wetin be your full name?`,
      },
      ask_location: {
        english: `📍 What is your location? (e.g. Yaoundé, Bafoussam)`,
        french:  `📍 Quelle est votre localité? (ex: Yaoundé, Bafoussam)`,
        pidgin:  `📍 For which side you dey? (e.g. Yaoundé, Bafoussam)`,
      },
      ask_produces: {
        english: `🌱 What do you grow? Separate by commas.\nExample: maize, cassava, tomatoes`,
        french:  `🌱 Qu'est-ce que vous cultivez? Séparez par virgules.\nExemple: maïs, manioc, tomates`,
        pidgin:  `🌱 Wetin you dey farm? Separate am with comma.\nExample: maize, cassava, tomatoes`,
      },
      ask_business: {
        english: `🏪 What is your business name?`,
        french:  `🏪 Quel est le nom de votre entreprise?`,
        pidgin:  `🏪 Wetin be your business name?`,
      },
      ask_needs: {
        english: `🛒 What products do you need? Separate by commas.`,
        french:  `🛒 Quels produits cherchez-vous? Séparez par virgules.`,
        pidgin:  `🛒 Wetin you dey find? Separate am with comma.`,
      },
      registered_farmer: {
        english: `✅ Registered as Farmer!\n\nWelcome ${`\${name}`} 👨‍🌾\n\nTo list produce:\nSELL maize 10 bags\n\nType HELP for options.`,
        french:  `✅ Enregistré comme Agriculteur!\n\nBienvenue ${`\${name}`} 👨‍🌾\n\nPour lister vos produits:\nVENDRE maïs 10 sacs\n\nTapez AIDE pour options.`,
        pidgin:  `✅ You don register as Farmer!\n\nWelcome ${`\${name}`} 👨‍🌾\n\nFor list your things:\nSELL maize 10 bags\n\nType HELP for options.`,
      },
      registered_buyer: {
        english: `✅ Registered as Buyer!\n\nWelcome ${`\${name}`} 🏪\n\nTo find produce:\nBUY maize 20 bags\n\nType HELP for options.`,
        french:  `✅ Enregistré comme Acheteur!\n\nBienvenue ${`\${name}`} 🏪\n\nPour trouver des produits:\nACHETER maïs 20 sacs\n\nTapez AIDE pour options.`,
        pidgin:  `✅ You don register as Buyer!\n\nWelcome ${`\${name}`} 🏪\n\nFor find farm things:\nBUY maize 20 bags\n\nType HELP for options.`,
      },
      voice_received: {
        english: `🎤 Voice note received. I heard: "\${text}"\n\nIs this correct? YES or NO`,
        french:  `🎤 Message vocal reçu. J'ai entendu: "\${text}"\n\nC'est correct? OUI ou NON`,
        pidgin:  `🎤 I hear your voice. You talk: "\${text}"\n\nCorrect? YES or NO`,
      },
      voice_failed: {
        english: `❌ Could not understand your voice note. Please type your message instead.`,
        french:  `❌ Je n'ai pas compris votre message vocal. Veuillez taper votre message.`,
        pidgin:  `❌ I no hear the voice well. Abeg type your message.`,
      },
      price_suggestion: {
        english: `📊 Current \${product} prices:\nMin: \${min} FCFA\nAvg: \${avg} FCFA\nMax: \${max} FCFA\n\nSuggested: \${suggested} FCFA\n\nReply with your price or type AUTO`,
        french:  `📊 Prix actuels du \${product}:\nMin: \${min} FCFA\nMoy: \${avg} FCFA\nMax: \${max} FCFA\n\nSuggéré: \${suggested} FCFA\n\nRépondez avec votre prix ou tapez AUTO`,
        pidgin:  `📊 \${product} price nowadays:\nSmall: \${min} FCFA\nNormal: \${avg} FCFA\nBig: \${max} FCFA\n\nWe suggest: \${suggested} FCFA\n\nSend your price or type AUTO`,
      },
      listing_confirmed: {
        english: `✅ \${product} (\${quantity} \${unit}) listed at \${price} FCFA!\nBuyers will be notified.`,
        french:  `✅ \${product} (\${quantity} \${unit}) listé à \${price} FCFA!\nLes acheteurs seront notifiés.`,
        pidgin:  `✅ \${product} (\${quantity} \${unit}) don list for \${price} FCFA!\nBuyers go see am.`,
      },
      match_found_farmer: {
        english: `🔔 A buyer in \${location} wants \${product} (\${quantity} \${unit}).\n\nInterested? Reply YES or NO`,
        french:  `🔔 Un acheteur à \${location} cherche \${product} (\${quantity} \${unit}).\n\nIntéressé? Répondez OUI ou NON`,
        pidgin:  `🔔 One buyer for \${location} wan \${product} (\${quantity} \${unit}).\n\nYou wan sell? Reply YES or NO`,
      },
      connected: {
        english: `✅ Deal confirmed!\n\nChat directly here:\n\${link}\n\nProduct: \${quantity} \${unit} of \${product} @ \${price} FCFA`,
        french:  `✅ Accord confirmé!\n\nDiscutez directement ici:\n\${link}\n\nProduit: \${quantity} \${unit} de \${product} à \${price} FCFA`,
        pidgin:  `✅ Deal don set!\n\nGo chat here:\n\${link}\n\nThing: \${quantity} \${unit} \${product} for \${price} FCFA`,
      },
      unknown_command: {
        english: `❓ I didn't understand that.\n\nTry:\nSELL maize 10 bags\nBUY maize 20 bags\nType HELP for options.`,
        french:  `❓ Je n'ai pas compris.\n\nEssayez:\nVENDRE maïs 10 sacs\nACHETER maïs 20 sacs\nTapez AIDE pour options.`,
        pidgin:  `❓ I no understand.\n\nTry:\nSELL maize 10 bags\nBUY maize 20 bags\nType HELP for options.`,
      },
    };
  }
}