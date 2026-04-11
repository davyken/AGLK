/**
 * tools/routerTool.ts
 *
 * Agent 1 — Router Sub-Agent
 *
 * Classifies incoming WhatsApp messages into structured intents and extracts
 * named entities.  Uses gpt-4o-mini for speed and cost efficiency.
 *
 * Supports English, French, and Cameroonian Pidgin English.
 */

import { createTool } from '@voltagent/core';
import OpenAI from 'openai';
import { z } from 'zod';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IntentLabel =
  | 'list_produce'
  | 'buy_produce'
  | 'check_price'
  | 'negotiate'
  | 'register_farmer'
  | 'track_order'
  | 'ask_question'
  | 'greet'
  | 'out_of_scope';

export interface RouterOutput {
  intent: IntentLabel;
  entities: {
    crop?: string;
    location?: string;
    quantity?: string;
    price?: string;
    unit?: string;
    name?: string;
    region?: string;
  };
  confidence: number;
  language: 'en' | 'fr' | 'pidgin';
}

// ─── OpenAI client (lazy-initialised so tests can inject env) ─────────────────

function getClient(): OpenAI {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const routerTool = createTool({
  name: 'routerTool',
  description:
    'Classifies the user message into a marketplace intent and extracts key entities ' +
    '(crop, quantity, price, location). Supports English, French, and Cameroonian Pidgin.',

  parameters: z.object({
    message: z.string().describe('The raw WhatsApp message from the user'),
    conversation_history: z
      .array(
        z.object({
          role: z.enum(['user', 'assistant']),
          content: z.string(),
        }),
      )
      .describe('Last N turns of conversation for context'),
  }),

  execute: async ({ message, conversation_history }) => {
    const startMs = Date.now();
    const model = 'gpt-4o-mini';

    const systemPrompt = `You are a routing agent for an agricultural WhatsApp marketplace in Cameroon.
Your job is to classify user messages and extract named entities.

## Supported intents
- list_produce    → farmer wants to sell something
- buy_produce     → buyer is looking for something to buy (HIGH confidence if crop+location mentioned, even without quantity)
- check_price     → user asks about current market prices
- negotiate       → user makes or responds to an offer
- register_farmer → new user wants to register / onboard
- track_order     → user asks about order status
- ask_question    → general market question
- greet           → hello / bonjour / how you dey
- out_of_scope    → unrelated to agriculture or market

## Languages
Detect whether the message is in: en (English), fr (French), or pidgin (Cameroonian Pidgin English).

## Local produce names (normalise in entities.crop)
- njama njama, eru, okok, mbongo, egusi, kpem, bobolo, achu, fufu, ndolé, mbanga soup
- maïs → maize, manioc → cassava, igname → yam, ananas → pineapple

## Entity extraction
Extract ALL of: crop, quantity (as string), unit, price (as string with currency), location, name, region.
Only include fields that are clearly present in the message. Use the original language for values.

## Output — respond with ONLY valid JSON, no prose
{
  "intent": "<intent_label>",
  "entities": {
    "crop": "<optional>",
    "quantity": "<optional>",
    "unit": "<optional>",
    "price": "<optional>",
    "location": "<optional>",
    "name": "<optional>",
    "region": "<optional>"
  },
  "confidence": <0.0–1.0>,
  "language": "en" | "fr" | "pidgin"
}`;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...conversation_history.slice(-6).map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      { role: 'user', content: message },
    ];

    try {
      const completion = await getClient().chat.completions.create({
        model,
        messages,
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 256,
      });

      const raw = completion.choices[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(raw) as RouterOutput;
      const latencyMs = Date.now() - startMs;

      console.log(
        `[routerTool] model=${model} latency=${latencyMs}ms ` +
          `intent=${parsed.intent} lang=${parsed.language} conf=${parsed.confidence} ` +
          `tokens=${completion.usage?.total_tokens ?? 'n/a'}`,
      );

      return {
        ...parsed,
        _meta: {
          model,
          latencyMs,
          tokensUsed: completion.usage?.total_tokens ?? 0,
        },
      };
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      console.error(`[routerTool] ERROR latency=${latencyMs}ms`, err);

      // Safe fallback
      return {
        intent: 'out_of_scope' as IntentLabel,
        entities: {},
        confidence: 0,
        language: 'en' as const,
        _meta: { model, latencyMs, tokensUsed: 0, error: String(err) },
      };
    }
  },
});
