import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as https from 'https';
import { LanguageDetectionService } from './language-detection.service';
import type { Language } from './language-detection.service';
import { ResponseGenerationService } from './response-generation.service';

export type { Language } from './language-detection.service';

// ─── Entity extraction result ──────────────────────────────────────
export interface ExtractedEntities {
  product: string | null;
  /** Normalised English name (e.g. "manioc" → "cassava") */
  productNormalized: string | null;
  quantity: number | null;
  unit: string | null;
  location: string | null;
  price: number | null;
  priceMin: number | null;
  priceMax: number | null;
  timeframe: string | null;
}

// ─── Conversation state (merged from prior state + new intents + entities) ──
export interface ConversationStateEntities {
  product?: string | null;
  quantity?: number | null;
  unit?: string | null;
  location?: string | null;
  price?: number | null;
  priceMin?: number | null;
  priceMax?: number | null;
  timeframe?: string | null;
}

export interface ConversationState {
  /** The currently active intent, e.g. BUY or SELL. Null when idle/cancelled. */
  active_intent: IntentLabel | null;
  entities: ConversationStateEntities;
  /** Required fields that are still missing for the active intent */
  missing_fields: string[];
  /** ready = all required fields present; missing_info = waiting for more; cancelled = user cancelled; idle = no active task */
  status: 'ready' | 'missing_info' | 'cancelled' | 'idle';
}

// ─── Multi-intent classification types ─────────────────────────────
export type IntentLabel =
  | 'BUY'
  | 'SELL'
  | 'UPDATE'
  | 'CANCEL'
  | 'INQUIRY'
  | 'GREETING'
  | 'UNKNOWN';

/** One intent slot extracted from a multi-intent message */
export interface IntentSlot {
  intent: IntentLabel;
  product?: string;
  quantity?: number;
  unit?: string;
  location?: string;
  price?: number;
  priceMin?: number;
  priceMax?: number;
  timeframe?: string;
}

/** Full multi-intent classification result */
export interface ClassifiedMessage {
  intents: IntentSlot[];
  language: Language;
  confidence: 'high' | 'medium' | 'low';
  name?: string;
  location?: string; // global location (applies to all intents if not per-slot)
  raw: string;
}

// ─── Legacy single-intent type (still used internally for routing) ──
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
  /** All intents detected — populated when >1 found (e.g. sell+buy) */
  intents?: IntentSlot[];
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
  role?: 'farmer' | 'buyer' | 'both'; // kept for backward compat
  availableAt?: string; // when produce is ready (e.g. "2024-10-25" or "in 2 weeks")
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
- correct: "actually", "I meant", "not X but Y", "no it\'s", "sorry I said", "I made a mistake" → set correctedField + correctedValue
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
      if (!parsed.confidence) parsed.confidence = 'medium';

      // Detect dual-intent (sell AND buy in one message) and populate intents[]
      const hasSell = /\b(sell|vend|wan sell|dey sell|for sell)\b/i.test(message);
      const hasBuy = /\b(buy|achet|wan buy|dey find|looking for|je cherche)\b/i.test(message);
      if (hasSell && hasBuy) {
        parsed.intents = [
          { intent: 'SELL', product: parsed.product, quantity: parsed.quantity, unit: parsed.unit, location: parsed.location },
          { intent: 'BUY' },
        ];
      }

      return { ...parsed, raw: message };
    } catch (err) {
      this.logger.warn(`OpenAI parseIntent failed — using regex`);
      return this.regexFallback(message);
    }
  }

  /**
   * Focused entity extractor — pulls only structured data from a message.
   * Does NOT classify intent; use classifyIntents() for that.
   * Call this when you already know the intent and just need the fields.
   *
   * Rules (enforced at prompt level):
   *  - Extracts ONLY what is explicitly stated
   *  - Never infers or hallucinates missing values
   *  - Returns null for any field not present in the message
   */
  async extractEntities(message: string): Promise<ExtractedEntities> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 150,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an information extraction engine for AgroLink, a WhatsApp agricultural marketplace in Cameroon.

Extract structured data from the user's message.

=== FIELDS TO EXTRACT (if explicitly present) ===
- product: the crop or agricultural product name, exactly as stated (null if absent)
- productNormalized: English lowercase canonical name (maïs→maize, manioc→cassava, tomates→tomatoes, igname→yam, arachide→groundnuts, piment→pepper, gombo→okra, mais→maize, plantains→plantain) — null if no product
- quantity: numeric value only (null if absent). "une tonne"→1, "dix sacs"→10, "plenty"→null
- unit: bags|kg|tonnes|crates|bunches|litres|sacs — null if not stated. Do NOT guess.
- location: city or region exactly as stated (null if absent)
- price: XAF numeric value (null if absent). "15 mille"→15000, "15k"→15000, "15,000"→15000
- priceMin: lower bound if user gives a range (null otherwise)
- priceMax: upper bound if user gives a range (null otherwise)
- timeframe: when (as human-readable string, e.g. "next week", "tomorrow", "in 2 weeks") — null if absent

=== CRITICAL RULES ===
- Extract ONLY what is explicitly mentioned in the message
- Do NOT infer, guess, or hallucinate any value
- If a field is not present in the message, set it to null
- Keep values exactly as stated where possible

Return ONLY valid JSON. No explanation. No markdown.
{"product":null,"productNormalized":null,"quantity":null,"unit":null,"location":null,"price":null,"priceMin":null,"priceMax":null,"timeframe":null}`,
          },
          { role: 'user', content: message },
        ],
      });

      const text = completion.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(text.trim()) as ExtractedEntities;

      // Guarantee all fields exist (LLM may omit null fields)
      return {
        product: parsed.product ?? null,
        productNormalized: parsed.productNormalized ?? null,
        quantity: parsed.quantity ?? null,
        unit: parsed.unit ?? null,
        location: parsed.location ?? null,
        price: parsed.price ?? null,
        priceMin: parsed.priceMin ?? null,
        priceMax: parsed.priceMax ?? null,
        timeframe: parsed.timeframe ?? null,
      };
    } catch {
      this.logger.warn('extractEntities LLM call failed — using regex fallback');
      return this.extractEntitiesFallback(message);
    }
  }

  /** Regex fallback for extractEntities when LLM is unavailable */
  private extractEntitiesFallback(message: string): ExtractedEntities {
    const lower = message.toLowerCase().trim();
    const { product, productOriginal, quantity, unit } = this.extractProductQty(lower);

    // Location: "in X", "at X", "à X", "for X (city)"
    const locationMatch = lower.match(
      /(?:\bin\b|\bat\b|\bfrom\b|\bà\b)\s+([a-z][a-z\s]{1,20}?)(?:\s|$|,|\.|and)/i,
    );
    const location = locationMatch
      ? locationMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase())
      : null;

    // Single price: 15000, 15k, 15 mille
    const priceRangeMatch = lower.match(
      /(?:between|entre|de)\s+(\d[\d\s]*)\s+(?:and|et|à|-)\s+(\d[\d\s]*)/i,
    );
    const singlePriceMatch = lower.match(/\b(\d[\d\s]{0,8})\s*(?:xaf|fcfa|f\b|mille\b|k\b)?/i);

    const priceMin = priceRangeMatch
      ? parseInt(priceRangeMatch[1].replace(/\s/g, ''), 10)
      : null;
    const priceMax = priceRangeMatch
      ? parseInt(priceRangeMatch[2].replace(/\s/g, ''), 10)
      : null;

    let price: number | null = null;
    if (!priceRangeMatch && singlePriceMatch) {
      const raw = singlePriceMatch[1].replace(/\s/g, '');
      const num = parseInt(raw, 10);
      if (num > 100) price = lower.includes('mille') ? num * 1000 : lower.includes('k') ? num * 1000 : num;
    }

    // Timeframe: "next week", "tomorrow", "in 2 days", "next month"
    const timeframeMatch = lower.match(
      /\b(tomorrow|next week|next month|today|in \d+ days?|in \d+ weeks?|demain|la semaine prochaine|le mois prochain)\b/i,
    );
    const timeframe = timeframeMatch ? timeframeMatch[1] : null;

    return {
      product: productOriginal ?? product ?? null,
      productNormalized: product ?? null,
      quantity: quantity ?? null,
      unit: unit || null,
      location,
      price,
      priceMin,
      priceMax,
      timeframe,
    };
  }

  /**
   * Multi-intent classifier — detects one or more intents from a single message.
   * Handles cases like "I want to sell maize and also buy tomatoes" → [SELL, BUY].
   * Use this as the primary entry point; falls back to parseIntent for routing.
   */
  async classifyIntents(message: string): Promise<ClassifiedMessage> {
    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 300,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are an intent classification engine for AgroLink, a WhatsApp agricultural marketplace in Cameroon.

Return ONLY valid JSON. No explanation. No markdown.

=== INTENT LABELS ===
BUY      → user wants to purchase a product
SELL     → user wants to sell a product
UPDATE   → modify an existing listing (change price, quantity, etc.)
CANCEL   → cancel, stop, withdraw, not interested
INQUIRY  → asking a question (price check, how it works, availability)
GREETING → hi, hello, bonjour, salut, hey
UNKNOWN  → unclear intent

=== RULES ===
- Do NOT assume roles — no buyer/seller profiles
- Detect ALL intents present (a message may have multiple)
- Base classification ONLY on the current message
- Be strict: only classify what is clearly expressed
- Each intent slot captures its own product/quantity/location if specified

=== ENTITY FIELDS (per intent slot) ===
- product: English lowercase crop name (maïs→maize, manioc→cassava, tomates→tomatoes)
- quantity: numeric value or null
- unit: bags|kg|tonnes|crates|bunches|litres — or null
- location: city name if mentioned for this specific intent
- price: XAF number or null
- priceMin / priceMax: for price ranges
- timeframe: when (e.g. "next week", "in 2 days") or null

=== GLOBAL FIELDS ===
- language: english | french | pidgin
- confidence: high | medium | low
- name: extracted full name if user introduced themselves
- location: global location applying to all intents (if not per-slot)

=== EXAMPLES ===
"I want to sell maize and also buy tomatoes"
→ intents: [{intent:"SELL",product:"maize"},{intent:"BUY",product:"tomatoes"}]

"Do you have tomatoes?"
→ intents: [{intent:"INQUIRY",product:"tomatoes"}]

"I'm no longer interested"
→ intents: [{intent:"CANCEL"}]

"Hi"
→ intents: [{intent:"GREETING"}]

=== OUTPUT FORMAT ===
{"intents":[{"intent":"SELL","product":null,"quantity":null,"unit":null,"location":null,"price":null,"priceMin":null,"priceMax":null,"timeframe":null}],"language":"english","confidence":"high","name":null,"location":null}`,
          },
          { role: 'user', content: message },
        ],
      });

      const text = completion.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(text.trim());
      if (!parsed.confidence) parsed.confidence = 'medium';
      if (!Array.isArray(parsed.intents) || parsed.intents.length === 0) {
        parsed.intents = [{ intent: 'UNKNOWN' }];
      }
      return { ...parsed, raw: message };
    } catch {
      this.logger.warn('classifyIntents LLM call failed — using regex fallback');
      return this.classifyIntentsFallback(message);
    }
  }

  /** Regex-based fallback for classifyIntents when LLM is unavailable */
  private classifyIntentsFallback(message: string): ClassifiedMessage {
    const lower = message.toLowerCase().trim();
    const language = this.detectLanguageSync(lower);

    const nameMatch = lower.match(
      /(?:i[''']?m|my name is|je suis|je m'appelle|na me)\s+([a-z][a-z\s]{1,30}?)(?:\s+(?:in|from|at|à|,|$))/i,
    );
    const name = nameMatch
      ? nameMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase())
      : undefined;

    const locationMatch = lower.match(
      /(?:\bin\b|\bfrom\b|\bat\b|\bà\b)\s+([a-z][a-z\s]{1,20}?)(?:\s|$|,)/i,
    );
    const location = locationMatch
      ? locationMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase())
      : undefined;

    const cancelSignals = /\b(cancel|stop|not interested|no longer|never mind|forget it|annuler)\b/i;
    const sellSignals = /\b(sell|vend|i get|i have|for sell|wan sell|dey sell|je cultive|je vends)\b/i;
    const buySignals = /\b(buy|achet|i wan buy|i dey find|looking for|je cherche|je veux|need)\b/i;
    const inquirySignals = /\b(how much|price|prix|combien|what is|do you have|avez-vous|is there)\b/i;
    const greetingSignals = /^(hi|hello|bonjour|salut|bonsoir|hey|start)$/i;

    if (cancelSignals.test(lower)) {
      return { intents: [{ intent: 'CANCEL' }], language, confidence: 'high', raw: message };
    }
    if (greetingSignals.test(lower)) {
      return { intents: [{ intent: 'GREETING' }], language, confidence: 'high', name, raw: message };
    }

    const slots: IntentSlot[] = [];

    if (sellSignals.test(lower)) {
      const { product, quantity, unit } = this.extractProductQty(lower);
      slots.push({ intent: 'SELL', product, quantity, unit: unit || undefined, location });
    }
    if (buySignals.test(lower)) {
      const { product, quantity, unit } = this.extractProductQty(lower);
      slots.push({ intent: 'BUY', product, quantity, unit: unit || undefined, location });
    }
    if (slots.length === 0 && inquirySignals.test(lower)) {
      const { product } = this.extractProductQty(lower);
      slots.push({ intent: 'INQUIRY', product, location });
    }
    if (slots.length === 0) {
      slots.push({ intent: 'UNKNOWN' });
    }

    const confidence: 'high' | 'medium' | 'low' =
      slots.length > 0 && slots[0].intent !== 'UNKNOWN' ? 'high' : 'low';

    return { intents: slots, language, confidence, name, location, raw: message };
  }

  async detectLanguage(text: string): Promise<Language> {
    const result = await this.langDetect.detect(text);
    return result.language === 'unknown' ? 'english' : result.language;
  }

  detectLanguageSync(text: string): Language {
    const result = this.langDetect.detectStatistical(text);
    return result.language === 'unknown' ? 'english' : result.language;
  }

  /**
   * Transcribe a voice note using Whisper with enhanced context for agricultural marketplace.
   * Detects language and returns both transcription and detected language.
   */
  async transcribeVoiceNote(
    mediaUrl: string,
    accessToken: string,
  ): Promise<{ text: string; language: Language }> {
    const tmpPath = `/tmp/voice_${Date.now()}.ogg`;

    try {
      await this.downloadFile(mediaUrl, accessToken, tmpPath);

      // Enhanced prompt with agricultural terms and Cameroon-specific context
      // This helps Whisper understand the domain better
      const prompt = `You are transcribing a WhatsApp voice message for an agricultural marketplace in Cameroon.

IMPORTANT CONTEXT:
- This is a marketplace connecting farmers and buyers
- Products include: maize, cassava, tomatoes, plantain, groundnuts, yam, pepper, okra, beans, cocoa, coffee
- Common terms: bags, sell, buy, price, farmer, buyer, quantity
- Common locations in Cameroon: Douala, Yaoundé, Bafoussam, Buea, Bamenda, Limbe, Kribi
- Languages: English, French, and Cameroonian Pidgin (e.g., "i get", "i wan", "i dey", "na so", "abeg", "wetin")
- Currency: XAF (Central African CFA franc), prices often mentioned like "15k", "15000", "15 mille"
- Units: bags, kg, tonnes, crates, bunches

TRANSCRIPTION GUIDELINES:
- Keep the original language (English, French, or Pidgin)
- Use common agricultural terms in the original language
- Preserve product names as spoken (e.g., "maïs" stays "maïs" in French, but "maize" in English/Pidgin)
- Keep numbers as spoken
- If unsure between English/Pidgin, lean towards Pidgin if contains "dey", "don", "wan", "na"
`;

      // Use the SDK's transcription method with enhanced prompt
      const transcription = await this.openai.audio.transcriptions.create({
        file: fs.createReadStream(tmpPath),
        model: 'whisper-1',
        prompt: prompt, 
        response_format: 'text',
      });

      const text = (typeof transcription === 'string' ? transcription : '').trim();
      
      if (!text) {
        this.logger.warn('Whisper returned empty transcription');
        return { text: '', language: 'english' };
      }

      // Detect language from transcribed text for accurate response
      const language = this.detectLanguageSync(text);

      this.logger.log(`Whisper transcribed [${language}]: "${text}"`);
      return { text, language };
    } catch (err) {
      this.logger.error(
        `Whisper failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { text: '', language: 'english' };
    } finally {
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch (e) {
          // Ignore cleanup errors
        }
      }
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

    // ── Correction signal ─────────────────────────────────────
    const correctionMatch = lower.match(
      /(?:actually|i meant|not \w+ but|no it'?s|sorry i said|i made a mistake|correction)/i,
    );
    const correctedField = correctionMatch ? 'unknown' : undefined;

    // ── Extract role from intent signals ─────────────────────
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
      maíz: 'maize',
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

  /**
   * Conversation state manager — merges prior state, newly classified intents,
   * and newly extracted entities into a single updated ConversationState.
   *
   * Rules:
   *  - Do NOT overwrite existing data unless explicitly changed
   *  - Allow intent switching (SELL → BUY, etc.)
   *  - CANCEL intent resets the active task
   *  - BUY / SELL require: product. quantity and location are optional.
   *  - status = 'ready' when all required fields are present
   *  - Supports multiple parallel intents (first actionable intent wins as active)
   */
  mergeConversationState(
    previous: ConversationState | null,
    classified: ClassifiedMessage,
    extracted: ExtractedEntities,
  ): ConversationState {
    // ── Cancel detected → reset ─────────────────────────────────────
    const hasCancelIntent = classified.intents.some((s) => s.intent === 'CANCEL');
    if (hasCancelIntent) {
      return {
        active_intent: null,
        entities: {},
        missing_fields: [],
        status: 'cancelled',
      };
    }

    // ── Find the primary actionable intent ──────────────────────────
    const actionableOrder: IntentLabel[] = ['SELL', 'BUY', 'UPDATE', 'INQUIRY'];
    const primarySlot = classified.intents.find((s) =>
      actionableOrder.includes(s.intent),
    );
    const newIntent: IntentLabel | null = primarySlot?.intent ?? null;

    // ── Determine active intent (allow switching) ───────────────────
    // A new SELL/BUY/UPDATE replaces the old one; GREETING/UNKNOWN keeps the old
    const nonSwitchingIntents: (IntentLabel | null)[] = ['GREETING', 'UNKNOWN', null];
    const activeIntent: IntentLabel | null = nonSwitchingIntents.includes(newIntent)
      ? (previous?.active_intent ?? null)
      : newIntent;

    // ── Merge entities — new non-null values override old ──────────
    const prev = previous?.entities ?? {};

    // Slot-level entities (from the primary intent slot) take priority,
    // then the focused extractor, then whatever was in the classified global fields,
    // then prior state — never overwrite with null.
    const merged: ConversationStateEntities = {
      product:
        extracted.productNormalized ??
        primarySlot?.product ??
        classified.intents[0]?.product ??
        prev.product ??
        null,
      quantity:
        extracted.quantity ??
        primarySlot?.quantity ??
        prev.quantity ??
        null,
      unit:
        extracted.unit ??
        primarySlot?.unit ??
        prev.unit ??
        null,
      location:
        extracted.location ??
        primarySlot?.location ??
        classified.location ??
        prev.location ??
        null,
      price:
        extracted.price ??
        primarySlot?.price ??
        prev.price ??
        null,
      priceMin:
        extracted.priceMin ??
        primarySlot?.priceMin ??
        prev.priceMin ??
        null,
      priceMax:
        extracted.priceMax ??
        primarySlot?.priceMax ??
        prev.priceMax ??
        null,
      timeframe:
        extracted.timeframe ??
        primarySlot?.timeframe ??
        prev.timeframe ??
        null,
    };

    // ── Determine missing required fields ───────────────────────────
    // BUY and SELL only strictly require product; quantity/location are helpful but optional
    const missing: string[] = [];
    if (activeIntent === 'BUY' || activeIntent === 'SELL') {
      if (!merged.product) missing.push('product');
    }

    // ── Determine status ────────────────────────────────────────────
    let status: ConversationState['status'];
    if (!activeIntent) {
      status = 'idle';
    } else if (missing.length > 0) {
      status = 'missing_info';
    } else {
      status = 'ready';
    }

    return {
      active_intent: activeIntent,
      entities: merged,
      missing_fields: missing,
      status,
    };
  }

  /**
   * Generates a natural, human-like reply from a ConversationState + the raw user message.
   * Follows the rules:
   *  - Conversational and concise; no commands or menus
   *  - Never repeats questions for data already in state
   *  - Missing required fields → ask naturally (one question at a time)
   *  - Ready state → confirm and proceed
   *  - Cancelled → acknowledge and stop
   *  - Falls back to deterministic templates when LLM is unavailable
   */
  async generateConversationalResponse(
    state: ConversationState,
    userMessage: string,
    lang: Language,
  ): Promise<string> {
    const stateJson = JSON.stringify(state, null, 2);

    try {
      const completion = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 180,
        messages: [
          {
            role: 'system',
            content: `You are a conversational assistant for AgroLink, a WhatsApp agricultural marketplace in Cameroon.

Generate a natural, human-like response based on the conversation state and user message.

=== RULES ===
1. Be conversational, friendly, and concise (1-3 sentences max)
2. Never use command-based instructions (e.g., "type BUY maize 10 bags")
3. Never repeat questions for data that already exists in the state
4. If missing_fields is non-empty → ask naturally for ONE missing field only
5. If status is "ready" → confirm you understood and say you are proceeding
6. If status is "cancelled" → acknowledge warmly and stop
7. If status is "idle" or "missing_info" → ask a gentle clarifying question
8. Maintain the user's language: english | french | pidgin (see state.language from context)
9. Use emojis sparingly — one per message is fine

=== EXAMPLES ===
status=ready, intent=BUY, product=maize, quantity=10:
"Great 👍 I found a few maize sellers near Mokolo. Let me show you the best options."

status=missing_info, missing=["product"]:
"Got it! What product are you looking for?"

status=cancelled:
"No problem 👍 I've stopped that. Just let me know when you need something."

status=ready, intent=SELL, product=tomatoes, quantity=5, unit=crates:
"Perfect — 5 crates of tomatoes. I'll post that listing for you now."

=== LANGUAGE VARIANTS ===
french example (status=missing_info): "D'accord ! Quel produit vous cherchez ?"
pidgin example (status=ready, BUY): "Alright 👍 I go find maize sellers for you now."

Return ONLY the plain text response. No JSON. No markdown.`,
          },
          {
            role: 'user',
            content: `Conversation state:\n${stateJson}\n\nUser message: "${userMessage}"`,
          },
        ],
      });

      return (
        completion.choices[0]?.message?.content?.trim() ??
        this.generateConversationalResponseFallback(state, lang)
      );
    } catch {
      this.logger.warn('generateConversationalResponse LLM failed — using fallback');
      return this.generateConversationalResponseFallback(state, lang);
    }
  }

  /** Deterministic fallback for generateConversationalResponse */
  private generateConversationalResponseFallback(
    state: ConversationState,
    lang: Language,
  ): string {
    const { status, active_intent, missing_fields, entities } = state;
    const product = entities.product ?? '';
    const qty = entities.quantity;
    const unit = entities.unit ?? 'bags';

    // ── Cancelled ─────────────────────────────────────────────────
    if (status === 'cancelled') {
      return {
        english: `No problem 👍 I've stopped that. Just let me know when you need something.`,
        french: `Pas de problème 👍 C'est annulé. Faites-moi signe quand vous avez besoin de quelque chose.`,
        pidgin: `No wahala 👍 I don stop am. Just tell me when you need something.`,
      }[lang];
    }

    // ── Missing product ────────────────────────────────────────────
    if (missing_fields.includes('product')) {
      if (active_intent === 'BUY') {
        return {
          english: `What product are you looking to buy?`,
          french: `Quel produit vous cherchez à acheter ?`,
          pidgin: `Wetin you wan buy?`,
        }[lang];
      }
      if (active_intent === 'SELL') {
        return {
          english: `What product are you selling?`,
          french: `Quel produit vous vendez ?`,
          pidgin: `Wetin you wan sell?`,
        }[lang];
      }
    }

    // ── Ready — BUY ───────────────────────────────────────────────
    if (status === 'ready' && active_intent === 'BUY') {
      const qtyStr = qty ? `${qty} ${unit} of ` : '';
      return {
        english: `Got it 👍 Searching for ${qtyStr}${product} sellers now…`,
        french: `Compris 👍 Je cherche des vendeurs de ${qtyStr}${product}…`,
        pidgin: `Alright 👍 I go find ${qtyStr}${product} sellers now…`,
      }[lang];
    }

    // ── Ready — SELL ──────────────────────────────────────────────
    if (status === 'ready' && active_intent === 'SELL') {
      const qtyStr = qty ? `${qty} ${unit} of ` : '';
      return {
        english: `Perfect 👍 Posting your listing for ${qtyStr}${product} now…`,
        french: `Parfait 👍 Je publie votre annonce pour ${qtyStr}${product}…`,
        pidgin: `Correct 👍 I go post your listing for ${qtyStr}${product} now…`,
      }[lang];
    }

    // ── Idle / fallthrough ─────────────────────────────────────────
    return {
      english: `I'm not sure I fully got that. Are you trying to buy or sell something?`,
      french: `Je ne suis pas sûr de bien comprendre. Vous voulez acheter ou vendre quelque chose ?`,
      pidgin: `I no fully catch am. You wan buy or sell something?`,
    }[lang];
  }

async reply(
  key:  string,
  lang: Language,
  data: Record<string, string | number> = {},
): Promise<string> {
  return await this.responseGen.generate(key, lang, data);
}
}
