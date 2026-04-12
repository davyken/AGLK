/**
 * tools/responseGeneratorTool.ts
 *
 * Agent 4 — Response Generator Sub-Agent
 *
 * Converts structured action results into warm, natural WhatsApp-style messages
 * tailored to Cameroonian farmers and buyers.  Uses gpt-4o.
 *
 * Tone rules:
 *  - Friendly and human — never robotic or corporate
 *  - Match user's language (fr / en / pidgin)
 *  - Short messages (WhatsApp style — no bullet walls)
 *  - Celebrate milestones (first listing, first sale)
 *  - Acknowledge errors with warmth
 *  - Emojis: sparingly, culturally appropriate 🌽🤝📦🌿
 */

import { createTool } from '@voltagent/core';
import OpenAI from 'openai';
import { z } from 'zod';

// ─── Tool definition ──────────────────────────────────────────────────────────

export const responseGeneratorTool = createTool({
  name: 'responseGeneratorTool',
  description:
    'Generates a warm, WhatsApp-friendly plain-text reply for the user based on the action ' +
    'result and intent. Replies in the user\'s language (en/fr/pidgin). Never robotic.',

  parameters: z.object({
    action_result: z
      .record(z.string(), z.unknown())
      .describe('The structured result from the DB or extraction step'),

    intent: z
      .string()
      .describe('The classified intent that drove this action'),

    user_language: z
      .enum(['en', 'fr', 'pidgin'])
      .describe('Language to reply in'),

    context: z
      .record(z.string(), z.unknown())
      .describe(
        'Extra context: is_first_listing, farmer_name, crop, missing_fields, error_message, etc.',
      ),
  }),

  execute: async ({ action_result, intent, user_language, context }) => {
    const startMs = Date.now();
    const model = 'gpt-4o-mini';

    const langInstructions: Record<string, string> = {
      en: 'Reply in clear, simple English as if texting a friend.',
      fr: 'Réponds en français simple et chaleureux, comme un SMS entre amis.',
      pidgin:
        'Reply in Cameroonian Pidgin English — natural and warm, e.g. "How e dey?", "Na fine thing!"',
    };

    const systemPrompt = `You are the friendly reply generator for Agrolink, a WhatsApp agricultural marketplace in Cameroon.
Your job is to turn structured data into a single warm, human-feeling WhatsApp message.

## Language
${langInstructions[user_language] ?? langInstructions.en}

## Tone rules
- Never start with "Hello," / "Bonjour," — go straight to the point or use a warm opener
- Keep it short: 2–4 sentences max unless listing multiple items
- Use emojis very sparingly: 🌽 🤝 📦 🌿 ✅ — max 2 per message
- Celebrate milestones (first listing, first sale) with genuine warmth
- For errors or missing info: be kind, not apologetic — guide the user forward
- Never use bullet points or markdown. Plain text only.
- Currency format: 5 000 XAF (not XAF5000)

## Intent-specific guidance
- list_produce success: confirm what was listed, mention it goes live immediately
- list_produce missing fields: ask for the ONE most important missing piece (don't list all)
- buy_produce: 
  *If action_result.listings found*: Show top 3: farmerName 📦 qty/unit 💰 price 📍 location  
  *Reply w/ number (1-3) to contact*  
  NO quantity/budget/amount questions.  
  *If no listings*: Save request, notify when available  
  *If missingFields*: Ask ONE field naturally
- check_price: give the average price clearly with range if available
- register_farmer: welcome warmly, tell them they're on Agrolink now
- track_order: give status clearly with next step
- greet: respond warmly, explain what Agrolink can do in 1 sentence
- out_of_scope: politely redirect to the marketplace
- error / fallback: apologise briefly and ask them to try again

Output: ONLY the plain-text WhatsApp message. No JSON. No explanation.`;

    const userContent = `Intent: ${intent}
User language: ${user_language}
Action result: ${JSON.stringify(action_result, null, 2)}
Context: ${JSON.stringify(context, null, 2)}`;

    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await client.chat.completions.create({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userContent },
        ],
        temperature: 0.7,
        max_tokens: 300,
      });

      const reply = completion.choices[0]?.message?.content?.trim() ?? fallbackReply(user_language);
      const latencyMs = Date.now() - startMs;

      console.log(
        `[responseGeneratorTool] model=${model} latency=${latencyMs}ms ` +
          `intent=${intent} lang=${user_language} ` +
          `replyLen=${reply.length} tokens=${completion.usage?.total_tokens ?? 'n/a'}`,
      );

      return {
        reply,
        _meta: {
          model,
          latencyMs,
          tokensUsed: completion.usage?.total_tokens ?? 0,
        },
      };
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      console.error(`[responseGeneratorTool] ERROR latency=${latencyMs}ms`, err);

      return {
        reply: fallbackReply(user_language),
        _meta: { model, latencyMs, tokensUsed: 0, error: String(err) },
      };
    }
  },
});

// ─── Fallback replies per language ───────────────────────────────────────────

function fallbackReply(lang: string): string {
  const fallbacks: Record<string, string> = {
    en: "Sorry, something went wrong on our end. Please try again in a moment 🙏",
    fr: "Désolé, une erreur s'est produite. Réessaie dans un instant 🙏",
    pidgin: "E get small problem for our side. Try again small time 🙏",
  };
  return fallbacks[lang] ?? fallbacks.en;
}
