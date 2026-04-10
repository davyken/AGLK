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
    | 'confirm'
    | 'cancel'
    | 'correct'
    | 'yes'
    | 'no'
    | 'unknown';
  language: Language;
  /** How certain the parser is of the intent — drives clarification logic */
  confidence: 'high' | 'medium' | 'low';
  // listing fields
  product?: string;
  productOriginal?: string; // user's original spelling (e.g. "manioc")
  quantity?: number;
  unit?: string;
  price?: number;
  priceMin?: number; // lower bound of a price range ("between 10000 and 15000")
  priceMax?: number; // upper bound of a price range
  // user profile fields — extracted from free-form text
  name?: string; // "I'm Paul Biya" → "Paul Biya"
  location?: string; // "in Douala" or "à Bafoussam"
  role?: 'farmer' | 'buyer' | 'both'; // "I sell" → farmer
  availableAt?: string; // when produce is available (e.g. "2024-10-25" or "in 2 weeks")
  // correction signals — "actually it's 20 bags not 10"
  correctedField?: string; // e.g. "quantity", "name", "location"
  correctedValue?: string; // the new value
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
            content: `You are a message parser for AgroLink, an agricultural marketplace WhatsApp chatbot in Cameroon.
Return ONLY valid JSON. No explanation. No markdown.

=== FIELDS TO EXTRACT ===
- intent: register | sell | buy | price | help | confirm | cancel | correct | yes | no | unknown
- language: english | french | pidgin
- confidence: "high" | "medium" | "low"  — how certain you are of the intent
- product: crop name in English lowercase (maïs→maize, tomate→tomatoes, manioc→cassava, igname→yam, arachide→groundnuts, piment→pepper, gombo→okra, macabo→macabo)
- productOriginal: exact word the user typed for the crop (null if none)
- quantity: numeric value (null if not present). "une tonne"→1, "dix sacs"→10, "plenty"→null
- unit: bags|kg|tonnes|crates|bunches|litres|sacs — default "bags" if unclear
- price: XAF number (null if absent). "15 mille"→15000, "15k"→15000, "15000 XAF"→15000
- priceMin: lower bound if user gives a price range (null if not a range)
- priceMax: upper bound if user gives a price range (null if not a range)
- name: full name if user introduced themselves ("I'm Paul Biya"→"Paul Biya", "je suis Marie"→"Marie", null if absent)
- location: city/region if mentioned — extract city only ("in Douala"→"Douala", "à Bafoussam"→"Bafoussam", null if absent)
- availableAt: when produce will be ready — human-readable string (null if not mentioned)
- role: "farmer" | "buyer" | "both" | null
- correctedField: if user corrects a previous fact, which field (e.g. "name", "quantity", "location", "product") — null otherwise
- correctedValue: the corrected value as a string — null otherwise

=== LANGUAGE SIGNALS ===
- french: bonjour, salut, oui, non, je, j'ai, vendre, acheter, sacs, combien, prix, vous, êtes
- pidgin: i get, i wan, i dey, na so, abeg, wetin, plenty, for sell, for buy, wey, na me, sabi, oga, dis, dat
- Code-switching (mixed languages): set language to whichever has more markers

=== INTENT RULES ===
- sell: any message containing produce + sell/have/grow signal → role: "farmer"
- buy: any message containing produce + want/need/buy signal → role: "buyer"
- register: hi/hello/bonjour/salut/start/hey with NO sell/buy signal → confidence: "high"
- confirm: yes, oui, ok, okay, na so, d'accord, correct, sure, yep, exactly → confidence: "high"
- cancel: cancel, annuler, stop, no more, forget it, never mind
- correct: "actually", "I meant", "not X but Y", "no it's", "sorry I said", "I made a mistake" → set correctedField + correctedValue
- price: asking about price/cost/market rate without sell/buy intent
- help: help, aide, options, what can I do
- yes/no: standalone affirmative/negative not tied to a new action

=== CONFIDENCE RULES ===
- high: clear sell/buy/confirm/no signal, or clear greeting only
- medium: inferred intent, partial signals
- low: guessing from very little text

CRITICAL: If a message contains BOTH identity info AND a sell/buy intent, set intent to "sell" or "buy" — NOT "register". Extract name and location too.
CRITICAL: Never invent data. If a field is unclear, set it to null.
CRITICAL: A message with only a product name and no intent signal → intent "unknown", confidence "low".

JSON format: {"intent":"","language":"","confidence":"high","product":null,"productOriginal":null,"quantity":null,"unit":"bags","price":null,"priceMin":null,"priceMax":null,"name":null,"location":null,"availableAt":null,"role":null,"correctedField":null,"correctedValue":null}`,
          },
          { role: 'user', content: message },
        ],
      });

      const text = completion.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(text.trim());
      // Ensure confidence is always set (LLM may omit it)
      if (!parsed.confidence) parsed.confidence = 'medium';
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

    // ── Extract name (I'm X / je suis X / na me X) ────────────
    const nameMatch = lower.match(
      /(?:i[''']?m|my name is|je suis|je m'appelle|na me)\s+([a-záàâäéèêëíîïóôùûüç][a-záàâäéèêëíîïóôùûüç\s]{1,40}?)(?:\s+(?:in|from|at|à|de|for|and|,|$))/i,
    );
    const name = nameMatch
      ? nameMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase())
      : undefined;

    // ── Extract location (in X / à X / for X / from X) ────────
    const locationMatch = lower.match(
      /(?:\bin\b|\bfrom\b|\bat\b|\bà\b|\bde\b|\bfor\b)\s+([a-záàâäéèêëíîïóôùûüç][a-záàâäéèêëíîïóôùûüç\s]{1,30}?)(?:\s+(?:and|,|$|\.|i |je ))/i,
    );
    const location = locationMatch
      ? locationMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase())
      : undefined;

    // ── Extract price range ("between X and Y", "X-Y") ────────
    const rangeMatch = lower.match(
      /(?:between|entre|de)\s+(\d[\d\s]*)\s+(?:and|et|à|-)\s+(\d[\d\s]*)/i,
    );
    const priceMin = rangeMatch
      ? parseInt(rangeMatch[1].replace(/\s/g, ''), 10)
      : undefined;
    const priceMax = rangeMatch
      ? parseInt(rangeMatch[2].replace(/\s/g, ''), 10)
      : undefined;

    // ── Correction signal ──────────────────────────────────────
    const correctionMatch = lower.match(
      /(?:actually|i meant|not \w+ but|no it'?s|sorry i said|i made a mistake|correction)/i,
    );
    const correctedField = correctionMatch ? 'unknown' : undefined;

    // ── Extract role from intent signals ──────────────────────
    const isFarmerSignal =
      /\b(sell|vend|i get|i have|i dey sell|wan sell|for sell|je cultive|je vends|agriculteur|farmer)\b/i.test(
        lower,
      );
    const isBuyerSignal =
      /\b(buy|achet|i wan buy|i dey find|je cherche|je veux|looking for|need|buyer|acheteur)\b/i.test(
        lower,
      );
    const role: 'farmer' | 'buyer' | undefined = isFarmerSignal
      ? 'farmer'
      : isBuyerSignal
        ? 'buyer'
        : undefined;

    if (
      /^(yes|oui|ok|okay|na so|yep|d'accord|yes na|correct|sure)$/i.test(lower)
    ) {
      return { intent: 'yes', language, confidence: 'high', raw };
    }
    if (/^(no|non|nope|no be dat|non merci|pas du tout)$/i.test(lower)) {
      return { intent: 'no', language, confidence: 'high', raw };
    }
    if (/^(cancel|annuler|stop|forget it|never mind)$/i.test(lower)) {
      return { intent: 'cancel', language, confidence: 'high', raw };
    }
    if (/^(help|aide|aidez|options)$/i.test(lower)) {
      return { intent: 'help', language, confidence: 'high', raw };
    }
    if (correctedField) {
      return { intent: 'correct', language, confidence: 'medium', correctedField, raw };
    }
    if (
      /^(hi|hello|bonjour|salut|bonsoir|hey|start|begin)$/i.test(lower) &&
      !isFarmerSignal &&
      !isBuyerSignal
    ) {
      return { intent: 'register', language, confidence: 'high', name, location, role, raw };
    }
    if (isFarmerSignal) {
      const { product, productOriginal, quantity, unit } =
        this.extractProductQty(lower);
      return {
        intent: 'sell',
        language,
        confidence: 'high',
        product,
        productOriginal,
        quantity,
        unit,
        priceMin,
        priceMax,
        name,
        location,
        role: 'farmer',
        raw,
      };
    }
    if (isBuyerSignal) {
      const { product, productOriginal, quantity, unit } =
        this.extractProductQty(lower);
      return {
        intent: 'buy',
        language,
        confidence: 'high',
        product,
        productOriginal,
        quantity,
        unit,
        priceMin,
        priceMax,
        name,
        location,
        role: 'buyer',
        raw,
      };
    }
    if (
      /\b(price|prix|how much|combien|quel est le prix|cost)\b/i.test(lower)
    ) {
      const { product } = this.extractProductQty(lower);
      return { intent: 'price', language, confidence: 'medium', product, raw };
    }
    if (/^\d+$/.test(lower.trim())) {
      return {
        intent: 'unknown',
        language,
        confidence: 'medium',
        price: parseInt(lower.trim(), 10),
        raw,
      };
    }

    return { intent: 'unknown', language, confidence: 'low', name, location, role, raw };
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
