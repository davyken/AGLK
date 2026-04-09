import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as https from 'https';
import { LanguageDetectionService } from './language-detection.service';
import type { Language } from './language-detection.service';
import { ResponseGenerationService } from './response-generation.service';

export type { Language } from './language-detection.service';

export interface ParsedIntent {
  intent:
    | 'register'
    | 'sell'
    | 'buy'
    | 'price'
    | 'help'
    | 'yes'
    | 'no'
    | 'unknown';
  language: Language;
  product?: string;
  quantity?: number;
  unit?: string;
  price?: number;
  raw: string;
}

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly openai: OpenAI;

  constructor(
    private readonly config: ConfigService,
    private readonly langDetect: LanguageDetectionService,
    private readonly responseGen: ResponseGenerationService,
  ) {
    this.openai = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY'),
    });
  }

  async parseIntent(message: string): Promise<ParsedIntent> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a message parser for an agricultural marketplace in Cameroon.
Return ONLY valid JSON. No explanation.

Fields:
- intent: register | sell | buy | price | help | yes | no | unknown
- language: english | french | pidgin
- product: crop name in english lowercase (maïs→maize, tomate→tomatoes, manioc→cassava)
- quantity: number or null
- unit: bags/kg/tonnes/sacs, default "bags"
- price: number or null

Language rules:
- french: bonjour, salut, oui, non, je, j'ai, vendre, acheter, maíz, sacs, combien, prix
- pidgin: i get, i wan, i dey, na so, abeg, wetin, plenty, for sell, for buy, wey

Intent rules:
- register: hi, hello, bonjour, salut, start, hey
- yes: yes, oui, ok, okay, na so, d'accord, yep
- no: no, non, nope, no be dat
- sell: any message about having/selling produce
- buy: any message about wanting/needing produce
- price: asking about price/cost
- help: help, aide, options

JSON format: {"intent":"","language":"","product":null,"quantity":null,"unit":"bags","price":null}`,
          },
          { role: 'user', content: message },
        ],
      });

      const text = completion.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(text.trim());
      return { ...parsed, raw: message };
    } catch (err) {
      this.logger.warn(`OpenAI parseIntent failed — using regex`);
      return this.regexFallback(message);
    }
  }

  async detectLanguage(text: string): Promise<Language> {
    const result = await this.langDetect.detect(text);
    return result.language === 'unknown' ? 'english' : result.language;
  }

  detectLanguageSync(text: string): Language {
    const result = this.langDetect.detectStatistical(text);
    return result.language === 'unknown' ? 'english' : result.language;
  }

  async transcribeVoiceNote(
    mediaUrl: string,
    accessToken: string,
  ): Promise<{ text: string; language: Language }> {
    const tmpPath = `/tmp/voice_${Date.now()}.ogg`;

    try {
      await this.downloadFile(mediaUrl, accessToken, tmpPath);

      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: 'whisper-1',
      });

      const text = transcription.text ?? '';
      const language = this.detectLanguageSync(text);

      this.logger.log(`Whisper transcribed [${language}]: "${text}"`);
      return { text, language };
    } catch (err) {
      this.logger.error(
        `Whisper failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { text: '', language: 'english' };
    } finally {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    }
  }

  private regexFallback(message: string): ParsedIntent {
    const raw = message;
    const lower = message.toLowerCase().trim();
    const language = this.detectLanguageSync(lower);

    if (/^(yes|oui|ok|okay|na so|yep|d'accord|yes na)$/i.test(lower)) {
      return { intent: 'yes', language, raw };
    }
    if (/^(no|non|nope|no be dat|non merci)$/i.test(lower)) {
      return { intent: 'no', language, raw };
    }
    if (/^(help|aide|aidez|options)$/i.test(lower)) {
      return { intent: 'help', language, raw };
    }
    if (/^(hi|hello|bonjour|salut|bonsoir|hey|start|begin)$/i.test(lower)) {
      return { intent: 'register', language, raw };
    }
    if (
      /\b(sell|vendre|vend|for sell|wan sell|dey sell|i get.+sell|i have.+sell)\b/i.test(
        lower,
      )
    ) {
      const { product, quantity, unit } = this.extractProductQty(lower);
      return { intent: 'sell', language, product, quantity, unit, raw };
    }
    if (
      /\b(buy|acheter|achet|for buy|wan buy|dey find|je cherche|je veux|looking for|need)\b/i.test(
        lower,
      )
    ) {
      const { product, quantity, unit } = this.extractProductQty(lower);
      return { intent: 'buy', language, product, quantity, unit, raw };
    }
    if (
      /\b(price|prix|how much|combien|quel est le prix|cost)\b/i.test(lower)
    ) {
      const { product } = this.extractProductQty(lower);
      return { intent: 'price', language, product, raw };
    }
    if (/^\d+$/.test(lower.trim())) {
      return {
        intent: 'unknown',
        language,
        price: parseInt(lower.trim(), 10),
        raw,
      };
    }

    return { intent: 'unknown', language, raw };
  }

  private extractProductQty(text: string): {
    product?: string;
    productOriginal?: string;
    quantity?: number;
    unit: string;
  } {
    const unitWords = [
      'bags',
      'bag',
      'sacs',
      'sac',
      'kg',
      'kilogrammes',
      'kilogramme',
      'tonnes',
      'tonne',
      'crates',
      'crate',
      'cageots',
      'cageot',
      'régimes',
      'régime',
      'bunches',
      'bunch',
      'litres',
      'litre',
      'pieces',
      'piece',
      'pièces',
      'pièce',
    ];
    const stopWords = [
      'sell',
      'buy',
      'vendre',
      'acheter',
      'i',
      'get',
      'wan',
      'dey',
      'for',
      'have',
      'je',
      'du',
      "j'ai",
      'la',
      'le',
      'les',
      'des',
      'want',
      'need',
      'plenty',
      'some',
      'available',
      'fresh',
      'good',
      'quality',
      'fraîches',
      'fraîche',
      'à',
      'vente',
      'cherche',
      'besoin',
      'veux',
      'voudrais',
      'ai',
    ];
    const frenchToEnglish: Record<string, string> = {
      maïs: 'maize',
      mais: 'maize',
      tomate: 'tomatoes',
      tomates: 'tomatoes',
      manioc: 'cassava',
      igname: 'yam',
      ignames: 'yam',
      plantain: 'plantain',
      plantains: 'plantain',
      gombo: 'okra',
      haricot: 'beans',
      haricots: 'beans',
      arachide: 'groundnuts',
      arachides: 'groundnuts',
      poisson: 'fish',
      poulet: 'chicken',
      macabo: 'macabo',
      njama: 'njama njama',
      palmier: 'palm oil',
      palme: 'palm oil',
      concombre: 'cucumber',
      concombres: 'cucumber',
      aubergine: 'eggplant',
      aubergines: 'eggplant',
      piment: 'pepper',
      piments: 'pepper',
      oignon: 'onion',
      oignons: 'onion',
      ail: 'garlic',
    };

    const parts = text.toLowerCase().split(/\s+/);
    let product: string | undefined;
    let productOriginal: string | undefined;
    let quantity: number | undefined;
    let unit = '';

    for (const p of parts) {
      if (unitWords.includes(p)) {
        unit = p;
        continue;
      }
      if (/^\d+$/.test(p)) {
        quantity = parseInt(p, 10);
        continue;
      }
      if (frenchToEnglish[p]) {
        productOriginal = p;
        product = frenchToEnglish[p];
        continue;
      }
      if (stopWords.includes(p)) continue;
      if (p.length > 2) {
        productOriginal = p;
        product = p;
      }
    }

    if (!unit) {
      unit = this.defaultUnitForProduct(product ?? productOriginal ?? '');
    }

    return { product, productOriginal, quantity, unit };
  }

  defaultUnitForProduct(product: string): string {
    const lower = product.toLowerCase();

    const byCrate = [
      'tomatoes',
      'tomato',
      'pepper',
      'piment',
      'eggplant',
      'aubergine',
      'cucumber',
      'concombre',
      'okra',
      'gombo',
    ];
    if (byCrate.some((p) => lower.includes(p))) return 'crates';

    const byKg = [
      'garlic',
      'ail',
      'onion',
      'oignon',
      'ginger',
      'gingembre',
      'groundnuts',
      'arachide',
    ];
    if (byKg.some((p) => lower.includes(p))) return 'kg';

    const byBunch = ['plantain', 'banana', 'banane'];
    if (byBunch.some((p) => lower.includes(p))) return 'bunches';

    const byLitre = ['palm oil', 'palme', 'oil', 'huile', 'milk', 'lait'];
    if (byLitre.some((p) => lower.includes(p))) return 'litres';

    return 'bags';
  }

  private downloadFile(
    url: string,
    accessToken: string,
    dest: string,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const file = fs.createWriteStream(dest);
      https
        .get(
          url,
          { headers: { Authorization: `Bearer ${accessToken}` } },
          (res) => {
            res.pipe(file);
            file.on('finish', () => {
              file.close();
              resolve();
            });
          },
        )
        .on('error', (err) => {
          fs.unlink(dest, () => {});
          reject(err);
        });
    });
  }

  async reply(
    key: string,
    lang: Language,
    data: Record<string, string | number> = {},
  ): Promise<string> {
    return this.responseGen.generate(key, lang, data);
  }
}
