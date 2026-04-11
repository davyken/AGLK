/**
 * pipeline.ts
 *
 * Entry point for processing a single incoming WhatsApp message.
 *
 * Usage:
 *   const reply = await runPipeline("I have 100kg of maize", "+237671234567");
 *   // → "Great news! Your 100 kg of maize listing is now live on Agrolink 🌽..."
 *
 * What this does per call:
 *   1. Load conversation state for the user from mock-db
 *   2. Build a context-enriched prompt for the orchestrator
 *   3. Call orchestrator.generateText with the phone number as conversationId
 *   4. Update & persist conversation state
 *   5. Return the final plain-text WhatsApp reply
 */

import { orchestrator } from './agents/orchestrator';
import {
  getConversationState,
  saveConversationState,
  type PipelineConversationState,
} from './mock-db/store';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PipelineResult {
  reply: string;
  conversationState: PipelineConversationState;
  durationMs: number;
}

// ─── Pipeline runner ──────────────────────────────────────────────────────────

/**
 * Process a single incoming WhatsApp message through the VoltAgent orchestrator.
 *
 * @param message    Raw text from WhatsApp (already stripped of media/metadata)
 * @param phoneNumber The user's WhatsApp phone number — used as conversation ID
 */
export async function runPipeline(
  message: string,
  phoneNumber: string,
): Promise<PipelineResult> {
  const startMs = Date.now();

  // 1 ── Load conversation state ─────────────────────────────────────────────
  const state = getConversationState(phoneNumber);

  console.log(
    `\n${'─'.repeat(60)}\n` +
      `[Pipeline] ▶ phoneNumber=${phoneNumber} turn=${state.turn}\n` +
      `[Pipeline]   message="${message.slice(0, 80)}"\n` +
      `[Pipeline]   state=${JSON.stringify({ ...state, partialData: Object.keys(state.partialData) })}\n` +
      `${'─'.repeat(60)}`,
  );

  // 2 ── Build orchestrator input ─────────────────────────────────────────────
  // We inject conversation_state as structured context in the prompt so the
  // orchestrator can resume multi-turn flows and maintain language preference.
  const orchestratorInput = buildOrchestratorInput(message, phoneNumber, state);

  // 3 ── Run orchestrator via VoltAgent ──────────────────────────────────────
  let reply: string;

  try {
    const result = await orchestrator.generateText(orchestratorInput, {
      // VoltAgent memory groups history by conversationId
      conversationId: phoneNumber,
      userId: phoneNumber,
    });

    reply = result.text?.trim() ?? fallbackReply(state.userLanguage);
  } catch (err) {
    console.error('[Pipeline] Orchestrator error:', err);
    reply = fallbackReply(state.userLanguage);
  }

  // 4 ── Update conversation state ───────────────────────────────────────────
  // Re-read state after the orchestrator run — it may have called
  // save_conversation_state via dbOperationsTool. Use the re-read turn as
  // the authoritative base so we always increment from the latest value,
  // not from the snapshot captured before the orchestrator executed.
  const postRunState = getConversationState(phoneNumber);
  const updatedState: PipelineConversationState = {
    ...postRunState,
    turn: postRunState.turn + 1,
  };
  saveConversationState(updatedState);

  const durationMs = Date.now() - startMs;

  console.log(
    `[Pipeline] ■ DONE durationMs=${durationMs} reply="${reply.slice(0, 80)}"`,
  );

  return { reply, conversationState: updatedState, durationMs };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds the full prompt string the orchestrator receives.
 * Injects conversation state as structured context so the agent can:
 *  - Resume multi-turn flows (e.g. a listing missing quantity)
 *  - Mirror the user's preferred language
 *  - Avoid asking for already-collected information
 */
function buildOrchestratorInput(
  message: string,
  phoneNumber: string,
  state: PipelineConversationState,
): string {
  const stateContext =
    state.turn === 0 && !state.pendingFlow
      ? '' // first ever message — no state to inject
      : `\n\n--- conversation_state ---\n${JSON.stringify(state, null, 2)}\n--- end state ---`;

  return (
    `User WhatsApp message: "${message}"\n` +
    `User phone: ${phoneNumber}` +
    stateContext
  );
}

/**
 * Language-appropriate fallback when the orchestrator fails entirely.
 */
function fallbackReply(lang: string): string {
  const messages: Record<string, string> = {
    en: "Sorry, we hit a small snag. Please send your message again 🙏",
    fr: "Désolé, un petit problème est survenu. Renvoie ton message 🙏",
    pidgin: "Wahala small small happen. Send your message again 🙏",
  };
  return messages[lang] ?? messages.en;
}
