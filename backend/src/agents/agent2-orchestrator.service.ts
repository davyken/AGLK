import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  RouterOutput,
  OrchestratorOutput,
  ConversationState,
  ConversationTurn,
  AgentLog,
  DbOperation,
} from './agents.types';

/** Agent 2 — Orchestrator
 *
 * The conversation state manager and sub-agent dispatcher.
 * Receives Router output + conversation history and decides:
 *  - What action to take
 *  - Whether to invoke the Data Extractor
 *  - What DB operations are needed
 *  - What context to pass to the Response Generator
 */
@Injectable()
export class OrchestratorAgentService {
  private readonly logger = new Logger(OrchestratorAgentService.name);
  private readonly client: OpenAI;

  private readonly MODEL = 'gpt-4o';

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.get<string>('OPENAI_API_KEY'),
    });
  }

  async run(
    routerOutput: RouterOutput,
    state: ConversationState,
    history: ConversationTurn[],
    rawMessage: string,
  ): Promise<{ output: OrchestratorOutput; log: AgentLog }> {
    const start = Date.now();

    const input = {
      router: routerOutput,
      state,
      history: history.slice(-6), // last 3 turns (user+assistant pairs)
      rawMessage,
    };

    try {
      const response = await this.client.chat.completions.create({
        model: this.MODEL,
        max_tokens: 512,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: this.systemPrompt() },
          { role: 'user', content: JSON.stringify(input, null, 2) },
        ],
      });

      const raw = response.choices[0]?.message?.content ?? '{}';
      const output = this.parse(raw, routerOutput);
      const latencyMs = Date.now() - start;

      this.logger.debug(
        `[Orchestrator] action=${output.action} extract=${output.requires_extraction} ops=${output.db_operations.join(',')} (${latencyMs}ms)`,
      );

      return {
        output,
        log: {
          agent: 'Orchestrator',
          model: this.MODEL,
          inputSummary: `intent=${routerOutput.intent} flow=${state.currentFlow ?? 'none'} turns=${state.turnCount}`,
          outputSummary: `action=${output.action} extract=${output.requires_extraction}`,
          latencyMs,
          success: true,
        },
      };
    } catch (err) {
      const latencyMs = Date.now() - start;
      const fallback = this.fallback(routerOutput, state);
      this.logger.warn(`[Orchestrator] LLM failed — using rule-based fallback: ${String(err)}`);

      return {
        output: fallback,
        log: {
          agent: 'Orchestrator',
          model: this.MODEL,
          inputSummary: `intent=${routerOutput.intent}`,
          outputSummary: `fallback action=${fallback.action}`,
          latencyMs,
          success: false,
          error: String(err),
        },
      };
    }
  }

  private systemPrompt(): string {
    return `You are the Orchestrator for AgroLink, a WhatsApp agricultural marketplace in Cameroon.

You receive:
- Router output (intent + entities + confidence + language)
- Current conversation state (userId, currentFlow, flowStep, pendingData, etc.)
- Recent conversation history
- The raw user message

Your job: decide what the system should do next.

=== ACTIONS ===
post_listing        → farmer is listing produce for sale; trigger extraction + DB write
search_produce      → buyer is searching; trigger extraction + DB read
check_price         → user wants price info; trigger DB read (price history)
start_negotiation   → offer or counter-offer in progress
register_user       → new user onboarding flow
track_order         → fetch order status
ask_clarification   → bot needs more info before proceeding (e.g., crop missing)
send_info           → general info response, no DB ops
greet_user          → greeting, no DB ops
reject_out_of_scope → message is not relevant; politely decline

=== STATE MANAGEMENT ===
- Maintain continuity across turns using currentFlow and flowStep
- If a listing flow is in progress and crop is missing → action: ask_clarification
- If a buy flow is in progress and user provides the missing field → resume the flow
- If user switches intent mid-flow → update currentFlow and reset pendingData

=== RULES ===
- requires_extraction: true when user message contains unstructured produce/quantity/price data to parse
- db_operations: only include operations the action actually needs
- state_update: only include fields that CHANGE from the current state
- context_for_response: include enough data for Agent 4 to write a good reply
  (e.g., crop name, count of matches found, whether it's user's first listing, etc.)

=== CONFIDENCE THRESHOLDS ===
- Router confidence < 0.4 → action: ask_clarification
- Missing crop entity for list_produce/buy_produce → action: ask_clarification
- Everything clear → proceed with appropriate action

Return ONLY valid JSON. No explanation. No markdown.
{
  "action": "",
  "requires_extraction": false,
  "db_operations": [],
  "state_update": {},
  "context_for_response": {}
}`;
  }

  private parse(raw: string, routerOutput: RouterOutput): OrchestratorOutput {
    try {
      const clean = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(clean);

      const validActions = new Set([
        'post_listing', 'search_produce', 'check_price', 'start_negotiation',
        'register_user', 'track_order', 'ask_clarification', 'send_info',
        'greet_user', 'reject_out_of_scope',
      ]);

      return {
        action: validActions.has(parsed.action) ? parsed.action : 'ask_clarification',
        requires_extraction: Boolean(parsed.requires_extraction),
        db_operations: Array.isArray(parsed.db_operations)
          ? (parsed.db_operations as DbOperation[])
          : [],
        state_update: parsed.state_update ?? {},
        context_for_response: parsed.context_for_response ?? {},
      };
    } catch {
      return this.fallback(routerOutput, { userId: '', language: 'en', turnCount: 0 });
    }
  }

  private fallback(routerOutput: RouterOutput, state: ConversationState): OrchestratorOutput {
    const { intent, entities, confidence } = routerOutput;

    // Low confidence → ask for clarification
    if (confidence < 0.4) {
      return {
        action: 'ask_clarification',
        requires_extraction: false,
        db_operations: [],
        state_update: {},
        context_for_response: { reason: 'low_confidence', language: routerOutput.language },
      };
    }

    switch (intent) {
      case 'greet':
        return {
          action: 'greet_user',
          requires_extraction: false,
          db_operations: ['read_user'],
          state_update: { lastIntent: 'greet' },
          context_for_response: {
            isFirstTime: state.turnCount === 0,
            userName: state.userName,
            language: routerOutput.language,
          },
        };

      case 'list_produce':
        if (!entities.crop) {
          return {
            action: 'ask_clarification',
            requires_extraction: false,
            db_operations: [],
            state_update: { currentFlow: 'listing_flow', flowStep: 'awaiting_crop' },
            context_for_response: { missingField: 'crop', language: routerOutput.language },
          };
        }
        return {
          action: 'post_listing',
          requires_extraction: true,
          db_operations: ['write_listing'],
          state_update: {
            currentFlow: 'listing_flow',
            flowStep: 'confirming',
            lastIntent: 'list_produce',
          },
          context_for_response: { crop: entities.crop, language: routerOutput.language },
        };

      case 'buy_produce':
        if (!entities.crop) {
          return {
            action: 'ask_clarification',
            requires_extraction: false,
            db_operations: [],
            state_update: { currentFlow: 'buy_flow', flowStep: 'awaiting_crop' },
            context_for_response: { missingField: 'crop', language: routerOutput.language },
          };
        }
        return {
          action: 'search_produce',
          requires_extraction: true,
          db_operations: ['read_listing'],
          state_update: {
            currentFlow: 'buy_flow',
            flowStep: 'showing_results',
            lastIntent: 'buy_produce',
          },
          context_for_response: { crop: entities.crop, language: routerOutput.language },
        };

      case 'check_price':
        return {
          action: 'check_price',
          requires_extraction: Boolean(entities.crop),
          db_operations: ['read_price'],
          state_update: { lastIntent: 'check_price' },
          context_for_response: { crop: entities.crop, language: routerOutput.language },
        };

      case 'register_farmer':
        return {
          action: 'register_user',
          requires_extraction: true,
          db_operations: ['read_user', 'write_user'],
          state_update: { currentFlow: 'registration_flow', lastIntent: 'register_farmer' },
          context_for_response: { language: routerOutput.language },
        };

      case 'out_of_scope':
        return {
          action: 'reject_out_of_scope',
          requires_extraction: false,
          db_operations: [],
          state_update: {},
          context_for_response: { language: routerOutput.language },
        };

      default:
        return {
          action: 'ask_clarification',
          requires_extraction: false,
          db_operations: [],
          state_update: {},
          context_for_response: { language: routerOutput.language },
        };
    }
  }
}
