import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  OrchestratorOutput,
  ExtractorOutput,
  ConversationState,
  AgentLanguage,
  AgentLog,
} from './agents.types';

/** Agent 4 — Response Generation Agent
 *
 * Converts structured action results into warm, natural WhatsApp messages.
 * Tone: friendly, simple, rural-appropriate, never robotic.
 *
 * Messages are:
 *  - Short (WhatsApp-style — no bullet walls)
 *  - Bilingual-aware (mirrors the user's language)
 *  - Contextual (first listing, delay acknowledgement, etc.)
 *  - Emoji-appropriate (sparingly, culturally relevant)
 */
@Injectable()
export class ResponderAgentService {
  private readonly logger = new Logger(ResponderAgentService.name);
  private readonly client: OpenAI;

  private readonly MODEL = 'gpt-4o';

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY'),
    });
  }

  async run(
    orchestratorOutput: OrchestratorOutput,
    extractorOutput: ExtractorOutput,
    state: ConversationState,
    dbResults: Record<string, any>,
  ): Promise<{ output: string; log: AgentLog }> {
    const start = Date.now();

    const input = {
      action: orchestratorOutput.action,
      context: orchestratorOutput.context_for_response,
      extractedData: extractorOutput,
      dbResults,
      userLanguage: state.language,
      userName: state.userName,
      isFirstTurn: state.turnCount <= 1,
    };

    try {
      const response = await this.client.chat.completions.create({
        model: this.MODEL,
        max_tokens: 300,
        messages: [
          { role: 'system', content: this.systemPrompt(state.language) },
          { role: 'user', content: JSON.stringify(input, null, 2) },
        ],
      });

      const output =
        response.choices[0]?.message?.content?.trim() ??
        this.fallback(orchestratorOutput, extractorOutput, state);

      const latencyMs = Date.now() - start;

      this.logger.debug(
        `[Responder] action=${orchestratorOutput.action} reply="${output.slice(0, 80)}" (${latencyMs}ms)`,
      );

      return {
        output,
        log: {
          agent: 'Responder',
          model: this.MODEL,
          inputSummary: `action=${orchestratorOutput.action} lang=${state.language}`,
          outputSummary: output.slice(0, 80),
          latencyMs,
          success: true,
        },
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const fallback = this.fallback(orchestratorOutput, extractorOutput, state);
      this.logger.warn(`[Responder] LLM failed — using template fallback: ${String(err)}`);

      return {
        output: fallback,
        log: {
          agent: 'Responder',
          model: this.MODEL,
          inputSummary: `action=${orchestratorOutput.action}`,
          outputSummary: fallback.slice(0, 80),
          latencyMs,
          success: false,
          error: String(err),
        },
      };
    }
  }

  private systemPrompt(lang: AgentLanguage): string {
    const langInstruction: Record<AgentLanguage, string> = {
      en: 'Respond in English.',
      fr: 'Répondez en français.',
      pidgin: 'Respond in Cameroonian Pidgin English.',
    };

    return `You are the WhatsApp voice of AgroLink, a marketplace for farmers and buyers in Cameroon.

${langInstruction[lang]}

=== TONE ===
- Warm, friendly, and human — like a helpful neighbour at the market
- Simple language, suitable for low digital literacy users
- Never robotic, never use system jargon
- No bullet-point walls — keep it conversational
- WhatsApp style: short, direct, personal

=== EMOJIS ===
Use sparingly. Culturally appropriate options:
🌽 maize | 🍅 tomatoes | 🥜 groundnuts | 🌿 leafy greens
🤝 deal/agreement | 📦 order/delivery | ✅ confirmed | 👋 greeting
One emoji per message is enough. Never start with an emoji.

=== ACTION TEMPLATES (adapt to context) ===

greet_user (first time):
"Welcome to AgroLink! 👋 I help farmers and buyers connect. Are you looking to sell your produce or buy something today?"

greet_user (returning):
"Good to see you again, [name]! What can I help you with today?"

post_listing (confirmed):
"Your [crop] listing is ready! 🌽 I'll notify buyers near [location]. You'll hear from me when someone is interested."

search_produce (results found):
"I found [count] farmers with [crop] near [location]. Want me to show you their offers?"

search_produce (no results):
"No [crop] available near [location] right now. Want me to search more widely?"

check_price:
"The current market price for [crop] in [location] is around [price] XAF per [unit]."

ask_clarification (missing crop):
"Sure! Which crop are you looking for?"

ask_clarification (low confidence):
"I didn't quite catch that. Are you trying to sell produce, or are you looking to buy something?"

register_user:
"Great to have you! What's your name and which town or region are you farming in?"

reject_out_of_scope:
"I can only help with buying or selling farm produce in Cameroon. What would you like to do?"

=== RULES ===
- Personalise with the user's name if available
- For first listing: add a warm congratulatory line
- Never say "I cannot" or "I am unable" — find a helpful alternative
- Keep responses under 3 sentences for most cases
- The message must be ready to send as-is on WhatsApp

Return ONLY the plain text WhatsApp message — no JSON, no quotes, no formatting.`;
  }

  private fallback(
    orchestrator: OrchestratorOutput,
    extractor: ExtractorOutput,
    state: ConversationState,
  ): string {
    const lang = state.language;
    const name = state.userName;
    const ctx = orchestrator.context_for_response;
    const crop = (extractor as any)?.cropNormalized ?? ctx.crop ?? 'produce';
    const location = (extractor as any)?.location ?? state.userLocation ?? 'your area';

    const greet = name ? `, ${name}` : '';

    const templates: Record<string, Record<AgentLanguage, string>> = {
      greet_user: {
        en: `Welcome to AgroLink${greet}! 👋 Are you looking to sell your produce or buy something today?`,
        fr: `Bienvenue sur AgroLink${greet} ! 👋 Vous souhaitez vendre ou acheter quelque chose aujourd'hui ?`,
        pidgin: `Welcome to AgroLink${greet}! 👋 You wan sell something or you wan buy?`,
      },
      post_listing: {
        en: `Your ${crop} listing is live! 🌽 I'll let you know when a buyer shows interest.`,
        fr: `Votre annonce de ${crop} est en ligne ! 🌽 Je vous avertis dès qu'un acheteur s'intéresse.`,
        pidgin: `Your ${crop} listing don go up! 🌽 I go tell you when buyer show interest.`,
      },
      search_produce: {
        en: `Searching for ${crop} near ${location}… I'll show you what's available.`,
        fr: `Je cherche du ${crop} près de ${location}… Je vous montre ce qui est disponible.`,
        pidgin: `I dey find ${crop} near ${location}… I go show you wetin dey.`,
      },
      check_price: {
        en: `Let me check the current price for ${crop} in ${location}.`,
        fr: `Je vérifie le prix actuel du ${crop} à ${location}.`,
        pidgin: `Make I check price for ${crop} for ${location}.`,
      },
      ask_clarification: {
        en: ctx.missingField === 'crop'
          ? `Which crop are you interested in?`
          : `I didn't quite catch that — are you trying to buy or sell something?`,
        fr: ctx.missingField === 'crop'
          ? `Quel produit vous intéresse ?`
          : `Je n'ai pas bien compris — vous voulez acheter ou vendre quelque chose ?`,
        pidgin: ctx.missingField === 'crop'
          ? `Which crop you dey find?`
          : `I no catch am well — you wan buy or sell something?`,
      },
      register_user: {
        en: `What's your name and which town are you farming in?`,
        fr: `Comment vous appelez-vous et dans quelle ville cultivez-vous ?`,
        pidgin: `Wetin be your name and which town you dey farm?`,
      },
      reject_out_of_scope: {
        en: `I can only help with buying or selling farm produce in Cameroon. What would you like to do?`,
        fr: `Je suis là pour aider à acheter ou vendre des produits agricoles au Cameroun. Que souhaitez-vous faire ?`,
        pidgin: `I only fit help with farm buying and selling for Cameroon. Wetin you wan do?`,
      },
    };

    const action = orchestrator.action;
    return (
      templates[action]?.[lang] ??
      templates.ask_clarification[lang]
    );
  }
}
