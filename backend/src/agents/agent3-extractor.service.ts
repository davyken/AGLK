import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  ExtractorOutput,
  ExtractedListing,
  ExtractedBuyRequest,
  ExtractedFarmerProfile,
  ExtractedPriceCheck,
  OrchestratorOutput,
  AgentLog,
} from './agents.types';

/** Agent 3 — Data Extraction Agent
 *
 * Parses unstructured user messages into clean structured records.
 * Only invoked when Orchestrator sets requires_extraction: true.
 *
 * Handles:
 *  - Produce listings (crop, quantity, unit, price, location, freshness)
 *  - Buy requests (crop, quantity, budget, delivery preference)
 *  - Farmer profiles (name, region, crops grown)
 *  - Price checks (crop, location)
 *
 * Normalises local produce names in French and Pidgin.
 */
@Injectable()
export class ExtractorAgentService {
  private readonly logger = new Logger(ExtractorAgentService.name);
  private readonly client: OpenAI;

  private readonly MODEL = 'gpt-4o';

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY'),
    });
  }

  async run(
    message: string,
    orchestratorOutput: OrchestratorOutput,
  ): Promise<{ output: ExtractorOutput; log: AgentLog }> {
    const start = Date.now();
    const action = orchestratorOutput.action;

    try {
      const response = await this.client.chat.completions.create({
        model: this.MODEL,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: this.systemPrompt(action) },
          { role: 'user', content: message },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      const output = this.parse(raw, action);
      const latencyMs = Date.now() - start;

      this.logger.debug(
        `[Extractor] action=${action} output=${JSON.stringify(output).slice(0, 100)} (${latencyMs}ms)`,
      );

      return {
        output,
        log: {
          agent: 'Extractor',
          model: this.MODEL,
          inputSummary: `action=${action} message="${message.slice(0, 60)}"`,
          outputSummary: output ? `type=${output.type}` : 'null',
          latencyMs,
          success: true,
        },
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const fallback = this.fallback(message, action);
      this.logger.warn(`[Extractor] LLM failed — using regex fallback: ${String(err)}`);

      return {
        output: fallback,
        log: {
          agent: 'Extractor',
          model: this.MODEL,
          inputSummary: `action=${action}`,
          outputSummary: `fallback type=${fallback?.type ?? 'null'}`,
          latencyMs,
          success: false,
          error: String(err),
        },
      };
    }
  }

  private systemPrompt(action: string): string {
    const typeHint = this.actionToType(action);

    return `You are a structured data extraction engine for AgroLink, a WhatsApp agricultural marketplace in Cameroon.

Extract ONLY what is explicitly stated in the user's message. Never infer or hallucinate values.
Return ONLY valid JSON — no explanation, no markdown.

=== EXTRACTION TYPE: ${typeHint.toUpperCase()} ===

${typeHint === 'listing' ? this.listingSchema() : ''}
${typeHint === 'buy_request' ? this.buyRequestSchema() : ''}
${typeHint === 'farmer_profile' ? this.farmerProfileSchema() : ''}
${typeHint === 'price_check' ? this.priceCheckSchema() : ''}

=== LOCAL PRODUCE NORMALISATION ===
Map these to canonical English names in cropNormalized:
njama njama → njama njama | mbongo → mbongo spice | egusi → egusi
okok → okok | macabo → cocoyam | manioc → cassava
maïs / mais / corn → maize | tomate(s) → tomatoes
plantain(s) / banane(s) → plantain | igname(s) → yam
arachide(s) → groundnuts | piment(s) → pepper
gombo → okra | haricot(s) → beans | concombre(s) → cucumber

=== UNIT NORMALISATION ===
sac / sacs / bag / bags → bag | kg / kilogramme(s) → kg
tonne(s) → tonne | cageot(s) / crate(s) → crate
régime(s) / bunch(es) → bunch | litre(s) → litre

=== PRICE NORMALISATION ===
"15k" or "15 mille" → 15000 | "150k" → 150000
All prices in XAF (CFA Franc)

=== CRITICAL RULES ===
- Set any unknown field to null — do NOT guess
- quantity must be a number, not a string
- price/budget must be a number (XAF), not a string
- cropNormalized must always be in English lowercase`;
  }

  private listingSchema(): string {
    return `Extract a produce listing.

Return:
{
  "type": "listing",
  "crop": "<original crop name from message>",
  "cropNormalized": "<English canonical name>",
  "quantity": <number or null>,
  "unit": "<bag|kg|tonne|crate|bunch|litre or null>",
  "price": <XAF number or null>,
  "currency": "XAF",
  "location": "<city/region or null>",
  "freshness": "<e.g. 'fresh', 'harvested yesterday', or null>",
  "farmerName": "<name if mentioned, else null>",
  "availableAt": "<when available, human-readable, or null>"
}`;
  }

  private buyRequestSchema(): string {
    return `Extract a buy request.

Return:
{
  "type": "buy_request",
  "crop": "<original crop name from message>",
  "cropNormalized": "<English canonical name>",
  "quantity": <number or null>,
  "unit": "<bag|kg|tonne|crate|bunch|litre or null>",
  "budget": <lower or single budget in XAF, or null>,
  "budgetMax": <upper budget bound in XAF if range given, else null>,
  "currency": "XAF",
  "location": "<preferred location or null>",
  "deliveryPreference": "<delivery or pickup preference, or null>"
}`;
  }

  private farmerProfileSchema(): string {
    return `Extract farmer profile information.

Return:
{
  "type": "farmer_profile",
  "name": "<farmer name or null>",
  "region": "<Cameroonian region or city, or null>",
  "contact": "<phone number if mentioned, or null>",
  "crops": ["<crop1>", "<crop2>"]
}`;
  }

  private priceCheckSchema(): string {
    return `Extract price check request.

Return:
{
  "type": "price_check",
  "crop": "<original crop name>",
  "cropNormalized": "<English canonical name>",
  "location": "<location or null>"
}`;
  }

  private actionToType(action: string): string {
    switch (action) {
      case 'post_listing': return 'listing';
      case 'search_produce': return 'buy_request';
      case 'register_user': return 'farmer_profile';
      case 'check_price': return 'price_check';
      default: return 'listing';
    }
  }

  private parse(raw: string, action: string): ExtractorOutput {
    try {
      const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(clean);
      return parsed as ExtractorOutput;
    } catch {
      return this.fallback('', action);
    }
  }

  private fallback(message: string, action: string): ExtractorOutput {
    const lower = message.toLowerCase();
    const type = this.actionToType(action);

    // Crop normalisation map
    const cropMap: Record<string, string> = {
      maize: 'maize', mais: 'maize', maïs: 'maize', corn: 'maize',
      cassava: 'cassava', manioc: 'cassava',
      tomato: 'tomatoes', tomate: 'tomatoes', tomatoes: 'tomatoes',
      plantain: 'plantain', banana: 'plantain',
      yam: 'yam', igname: 'yam',
      groundnut: 'groundnuts', arachide: 'groundnuts', groundnuts: 'groundnuts',
      pepper: 'pepper', piment: 'pepper',
      okra: 'okra', gombo: 'okra',
      cocoyam: 'cocoyam', macabo: 'cocoyam',
      egusi: 'egusi', okok: 'okok', njama: 'njama njama',
      palm: 'palm oil', palme: 'palm oil',
      beans: 'beans', haricot: 'beans',
    };

    let crop: string | undefined;
    let cropNormalized: string | undefined;
    for (const [key, val] of Object.entries(cropMap)) {
      if (lower.includes(key)) { crop = key; cropNormalized = val; break; }
    }

    // Quantity + unit
    const qtyMatch = lower.match(/\b(\d+)\s*(bags?|sacs?|kg|tonnes?|crates?|cageots?|bunches?|régimes?|litres?)\b/i);
    const quantity = qtyMatch ? parseInt(qtyMatch[1], 10) : undefined;
    const rawUnit = qtyMatch ? qtyMatch[2].toLowerCase() : undefined;
    const unit = rawUnit
      ? rawUnit.replace(/s$/, '').replace('sac', 'bag').replace('cageot', 'crate').replace('régime', 'bunch')
      : undefined;

    // Price
    const priceRangeMatch = lower.match(/(?:between|entre|de)\s+(\d[\d\s]*)\s+(?:and|et|à|-)\s+(\d[\d\s]*)/i);
    const singlePriceMatch = lower.match(/\b(\d[\d\s]{0,7})\s*(?:xaf|fcfa|f\b|mille\b|k\b)/i);
    const priceMin = priceRangeMatch ? parseInt(priceRangeMatch[1].replace(/\s/g, ''), 10) : undefined;
    const priceMax = priceRangeMatch ? parseInt(priceRangeMatch[2].replace(/\s/g, ''), 10) : undefined;
    let price: number | undefined;
    if (!priceRangeMatch && singlePriceMatch) {
      const n = parseInt(singlePriceMatch[1].replace(/\s/g, ''), 10);
      price = lower.includes('mille') || lower.includes('k') ? n * 1000 : n;
    }

    // Location
    const locationMatch = lower.match(/(?:\bin\b|\bat\b|\bfrom\b|\bà\b)\s+([a-z][a-z\s]{1,20}?)(?:\s|$|,)/i);
    const location = locationMatch
      ? locationMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase())
      : undefined;

    if (type === 'listing') {
      const result: ExtractedListing = {
        type: 'listing',
        crop: crop ?? '',
        cropNormalized: cropNormalized ?? crop ?? '',
        quantity: quantity ?? 0,
        unit: unit ?? 'bag',
        price,
        currency: 'XAF',
        location,
      };
      return result;
    }

    if (type === 'buy_request') {
      const result: ExtractedBuyRequest = {
        type: 'buy_request',
        crop: crop ?? '',
        cropNormalized: cropNormalized ?? crop ?? '',
        quantity,
        unit,
        budget: price ?? priceMin,
        budgetMax: priceMax,
        currency: 'XAF',
        location,
      };
      return result;
    }

    if (type === 'price_check') {
      const result: ExtractedPriceCheck = {
        type: 'price_check',
        crop: crop ?? '',
        cropNormalized: cropNormalized ?? crop ?? '',
        location,
      };
      return result;
    }

    // farmer_profile
    const nameMatch = lower.match(/(?:i[''']?m|my name is|je suis|je m'appelle|na me)\s+([a-z][a-z\s]{1,30}?)(?:\s|$|,)/i);
    const name = nameMatch
      ? nameMatch[1].trim().replace(/\b\w/g, (c) => c.toUpperCase())
      : undefined;

    const result: ExtractedFarmerProfile = {
      type: 'farmer_profile',
      name,
      region: location,
      crops: crop ? [cropNormalized ?? crop] : [],
    };
    return result;
  }
}
