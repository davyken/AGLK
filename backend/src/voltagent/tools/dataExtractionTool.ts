/**
 * tools/dataExtractionTool.ts
 *
 * Agent 2 — Data Extraction Sub-Agent
 *
 * Converts unstructured natural language messages into clean, typed records
 * ready for database writes.  Uses gpt-4o for accuracy.
 *
 * Called conditionally — only when the orchestrator determines extraction is
 * needed (e.g. listing, registration, buy request).
 */

import { createTool } from '@voltagent/core';
import OpenAI from 'openai';
import { z } from 'zod';

// ─── Output type variants ─────────────────────────────────────────────────────

export interface ExtractedListing {
  type: 'listing';
  crop: string;
  cropNormalized: string;
  quantity: number;
  unit: string;
  priceXaf?: number;
  location: string;
  region: string;
  freshness?: string;
  notes?: string;
  missingFields: string[];
}

export interface ExtractedBuyRequest {
  type: 'buy_request';
  crop: string;
  cropNormalized: string;
  quantity?: number;
  unit?: string;
  budgetXaf?: number;
  budgetMaxXaf?: number;
  location?: string;
  deliveryPreference?: string;
  missingFields: string[];
}

export interface ExtractedFarmerProfile {
  type: 'farmer_profile';
  name?: string;
  region?: string;
  contact?: string;
  cropsGrown: string[];
  missingFields: string[];
}

export interface ExtractedPriceCheck {
  type: 'price_check';
  crop: string;
  cropNormalized: string;
  location?: string;
  region?: string;
}

export type ExtractionOutput =
  | ExtractedListing
  | ExtractedBuyRequest
  | ExtractedFarmerProfile
  | ExtractedPriceCheck
  | { type: 'unknown'; missingFields: string[] };

// ─── Prompt builders ──────────────────────────────────────────────────────────

function buildSystemPrompt(intent: string): string {
  const common = `You are a data extraction agent for an agricultural marketplace in Cameroon.
Currency is XAF (CFA Franc). Normalise all quantities to numeric values.

## Local crop name normalisation (map to English)
maïs → maize | manioc → cassava | igname → yam | ananas → pineapple
njama njama → njama njama | eru → eru | okok → okok | mbongo → mbongo
egusi → egusi | kpem → kpem | bobolo → bobolo | palmier → palm oil
plantain → plantain | tomate → tomatoes | arachide → groundnuts | soja → soybeans

## Unit normalisation
"sac(s)" → bag | "régime(s)" → bunch | "bidon(s)" → jerrycan
"tas" → pile | numbers alone → assume kg unless context says otherwise
Normalise: "5 bags" → { quantity: 5, unit: "bag" }

## Regions of Cameroon
Littoral (Douala), Centre (Yaoundé), West (Bafoussam/Dschang), Northwest (Bamenda),
Southwest (Buea/Kumba), North (Garoua), Adamawa (Ngaoundéré), East (Bertoua),
South (Ebolowa), Far North (Maroua)

Respond with ONLY valid JSON matching the schema for intent: ${intent}`;

  const schemas: Record<string, string> = {
    list_produce: `{
  "type": "listing",
  "crop": "<original name>",
  "cropNormalized": "<English canonical>",
  "quantity": <number>,
  "unit": "<kg|bag|bunch|liter|jerrycan|pile|piece>",
  "priceXaf": <number or null>,
  "location": "<city or village>",
  "region": "<Cameroon region>",
  "freshness": "<optional>",
  "notes": "<optional>",
  "missingFields": ["<field names still needed>"]
}`,
    buy_produce: `{
  "type": "buy_request",
  "crop": "<original name>",
  "cropNormalized": "<English canonical>",
  "quantity": <number or null>,
  "unit": "<unit or null>",
  "budgetXaf": <number or null>,
  "budgetMaxXaf": <number or null>,
  "location": "<optional>",
  "deliveryPreference": "<optional>",
  "missingFields": []
    // RULES for buy_produce:
    // - ONLY include fields in missingFields if ABSOLUTELY REQUIRED
    // - crop + location present → missingFields = [] even if no quantity/budget
    // - Proceed to search listings immediately
    // - Quantity/budget OPTIONAL - do NOT add to missingFields
}`,
    register_farmer: `{
  "type": "farmer_profile",
  "name": "<optional>",
  "region": "<optional>",
  "contact": "<optional phone>",
  "cropsGrown": ["<crop1>", "<crop2>"],
  "missingFields": ["name" if missing, "region" if missing]
}`,
    check_price: `{
  "type": "price_check",
  "crop": "<original name>",
  "cropNormalized": "<English canonical>",
  "location": "<optional>",
  "region": "<optional>"
}`,
  };

  const schema = schemas[intent];
  if (!schema) {
    throw new Error(
      `dataExtractionTool called with unsupported intent "${intent}". ` +
      `Supported intents: ${Object.keys(schemas).join(', ')}`,
    );
  }
  return `${common}\n\nExpected output schema:\n${schema}`;
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const dataExtractionTool = createTool({
  name: 'dataExtractionTool',
  description:
    'Parses a user message into a clean structured record based on the detected intent. ' +
    'Handles Cameroonian French, Pidgin, and local crop names. Returns normalised values ' +
    'ready for database write, plus a list of any required fields still missing.',

  parameters: z.object({
    message: z.string().describe('Raw user message to extract data from'),
    intent: z
      .string()
      .describe(
        'Intent detected by the router: list_produce | buy_produce | register_farmer | check_price',
      ),
    partial_data: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('Any data already collected in previous turns of this flow'),
  }),

  execute: async ({ message, intent, partial_data }) => {
    const startMs = Date.now();
    const model = 'gpt-4o';

    const systemPrompt = buildSystemPrompt(intent);

    const userContent =
      partial_data && Object.keys(partial_data).length > 0
        ? `Message: "${message}"\n\nAlready known from previous turns: ${JSON.stringify(partial_data, null, 2)}`
        : `Message: "${message}"`;

    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        response_format: { type: 'json_object' },
        temperature: 0,
        max_tokens: 512,
      });

      const raw = completion.choices[0]?.message?.content ?? '{}';
      const extracted = JSON.parse(raw) as ExtractionOutput;
      const latencyMs = Date.now() - startMs;

      console.log(
        `[dataExtractionTool] model=${model} latency=${latencyMs}ms ` +
          `intent=${intent} type=${extracted.type} ` +
          `missing=${('missingFields' in extracted ? extracted.missingFields : []).join(',') || 'none'} ` +
          `tokens=${completion.usage?.total_tokens ?? 'n/a'}`,
      );

      return {
        ...extracted,
        _meta: {
          model,
          latencyMs,
          tokensUsed: completion.usage?.total_tokens ?? 0,
        },
      };
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      console.error(`[dataExtractionTool] ERROR latency=${latencyMs}ms`, err);

      return {
        type: 'unknown' as const,
        missingFields: [],
        _meta: { model, latencyMs, tokensUsed: 0, error: String(err) },
      };
    }
  },
});
