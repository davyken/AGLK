import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  RouterOutput,
  IntentLabel,
  AgentLanguage,
  AgentLog,
} from './agents.types';

/** Agent 1 — Router
 *
 * Lightweight, fast intent classifier using gpt-4o-mini.
 * Classifies the user's message and extracts named entities.
 * Designed to be cheap and fast — a single, focused prompt.
 */
@Injectable()
export class RouterAgentService {
  private readonly logger = new Logger(RouterAgentService.name);
  private readonly client: OpenAI;

  /** Model: gpt-4o-mini — optimised for speed and cost */
  private readonly MODEL = 'gpt-4o-mini';

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY'),
    });
  }

  async run(
    message: string,
    state: { language?: AgentLanguage },
  ): Promise<{ output: RouterOutput; log: AgentLog }> {
    const start = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: this.MODEL,
        max_tokens: 256,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: this.systemPrompt() },
          { role: 'user', content: message },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      const output = this.parse(raw, message);
      const latencyMs = Date.now() - start;

      this.logger.debug(
        `[Router] intent=${output.intent} confidence=${output.confidence} lang=${output.language} (${latencyMs}ms)`,
      );

      return {
        output,
        log: {
          agent: 'Router',
          model: this.MODEL,
          inputSummary: message.slice(0, 80),
          outputSummary: `intent=${output.intent} conf=${output.confidence}`,
          latencyMs,
          success: true,
        },
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const fallback = this.fallback(message, state.language ?? 'en');
      this.logger.warn(`[Router] LLM failed — using regex fallback: ${String(err)}`);

      return {
        output: fallback,
        log: {
          agent: 'Router',
          model: this.MODEL,
          inputSummary: message.slice(0, 80),
          outputSummary: `fallback intent=${fallback.intent}`,
          latencyMs,
          success: false,
          error: String(err),
        },
      };
    }
  }

  private systemPrompt(): string {
    return `You are a fast intent classifier for AgroLink, a WhatsApp agricultural marketplace in Cameroon.

Classify the user message and extract named entities. Return ONLY valid JSON — no explanation, no markdown.

=== INTENT LABELS ===
list_produce   → farmer wants to sell / list produce
buy_produce    → buyer wants to purchase produce
check_price    → asking about market price
negotiate      → making or responding to an offer
register_farmer → new farmer signing up
track_order    → asking about an existing order
ask_question   → general market question
greet          → greeting / hello only
out_of_scope   → unrelated to agriculture or the platform

=== ENTITY FIELDS ===
crop: name of the agricultural product (English canonical if possible)
location: city or region
quantity: numeric string
unit: bags | kg | tonnes | crates | bunches | litres
price: numeric string (XAF)
name: person's name if introduced

=== LANGUAGE DETECTION ===
en     → English
fr     → French (bonjour, je veux, vendre, acheter)
pidgin → Cameroonian Pidgin (i wan, i get, i dey, abeg, wetin, na so)

=== LOCAL PRODUCE NAMES ===
Normalize these to English:
njama njama → njama njama (leafy green, keep as-is)
mbongo → mbongo spice
egusi → egusi (melon seeds)
okok → okok (leafy green)
macabo → cocoyam
manioc → cassava
maïs → maize
tomates → tomatoes
plantain → plantain
arachide → groundnuts
piment → pepper
gombo → okra

=== RULES ===
- confidence: 0.9+ = very clear, 0.6–0.89 = likely, 0.3–0.59 = guess, <0.3 = unclear
- If message is a simple greeting with no product signal → intent: "greet"
- If message contains a product AND a sell signal → intent: "list_produce"
- If message contains a product AND a buy/need signal → intent: "buy_produce"
- Never invent entity values — set missing fields to null

Return JSON only:
{"intent":"","entities":{"crop":null,"location":null,"quantity":null,"unit":null,"price":null,"name":null},"confidence":0.0,"language":"en"}`;
  }

  private parse(raw: string, _message: string): RouterOutput {
    try {
      // Strip markdown code fences if present
      const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(clean);

      const validIntents = new Set<IntentLabel>([
        'list_produce', 'buy_produce', 'check_price', 'negotiate',
        'register_farmer', 'track_order', 'ask_question', 'greet', 'out_of_scope',
      ]);

      const intent: IntentLabel = validIntents.has(parsed.intent)
        ? parsed.intent
        : 'out_of_scope';

      const validLangs = new Set<AgentLanguage>(['en', 'fr', 'pidgin']);
      const language: AgentLanguage = validLangs.has(parsed.language)
        ? parsed.language
        : 'en';

      const confidence = typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5;

      return {
        intent,
        entities: parsed.entities ?? {},
        confidence,
        language,
      };
    } catch {
      return this.fallback(_message, 'en');
    }
  }

  private fallback(message: string, language: AgentLanguage): RouterOutput {
    const lower = message.toLowerCase().trim();

    // Greeting
    if (/^(hi|hello|hey|bonjour|salut|bonsoir|start)$/i.test(lower)) {
      return { intent: 'greet', entities: {}, confidence: 0.95, language };
    }

    // Sell signals
    const sellSignals = /\b(sell|vend|i get|i have|for sell|wan sell|je cultive|je vends|list)\b/i;
    const buySignals = /\b(buy|achet|i wan|need|looking for|je cherche|je veux|want)\b/i;
    const priceSignals = /\b(price|prix|how much|combien|cost|rate)\b/i;

    // Crop extraction
    const cropMap: Record<string, string> = {
      maize: 'maize', mais: 'maize', corn: 'maize',
      cassava: 'cassava', manioc: 'cassava',
      tomato: 'tomatoes', tomate: 'tomatoes', tomatoes: 'tomatoes',
      plantain: 'plantain', banana: 'plantain',
      yam: 'yam', igname: 'yam',
      groundnut: 'groundnuts', arachide: 'groundnuts',
      pepper: 'pepper', piment: 'pepper',
      okra: 'okra', gombo: 'okra',
      cocoyam: 'cocoyam', macabo: 'cocoyam',
      egusi: 'egusi', okok: 'okok', njama: 'njama njama',
    };

    let crop: string | undefined;
    for (const [key, val] of Object.entries(cropMap)) {
      if (lower.includes(key)) { crop = val; break; }
    }

    const qtyMatch = lower.match(/\b(\d+)\s*(bags?|kg|tonnes?|crates?|bunches?|litres?|sacs?)\b/i);
    const quantity = qtyMatch ? qtyMatch[1] : undefined;
    const unit = qtyMatch ? qtyMatch[2].replace(/s$/, '') : undefined;

    const priceMatch = lower.match(/\b(\d[\d\s]*)\s*(xaf|fcfa|f\b|mille\b|k\b)?/i);
    const price = priceMatch ? priceMatch[1].trim() : undefined;

    if (priceSignals.test(lower)) {
      return { intent: 'check_price', entities: { crop, price }, confidence: 0.7, language };
    }
    if (sellSignals.test(lower)) {
      return { intent: 'list_produce', entities: { crop, quantity, unit, price }, confidence: 0.8, language };
    }
    if (buySignals.test(lower)) {
      return { intent: 'buy_produce', entities: { crop, quantity, unit }, confidence: 0.75, language };
    }

    return { intent: 'out_of_scope', entities: {}, confidence: 0.3, language };
  }
}
