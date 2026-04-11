/**
 * agents/orchestrator.ts
 *
 * Main Orchestrator Agent — powered by VoltAgent + GPT-4o
 *
 * This is the single entry point for every incoming WhatsApp message.
 * It owns the conversation state and decides which sub-agent tools to invoke
 * in what order.
 *
 * Architecture:
 *   User Message
 *     → routerTool        (intent + entities)
 *     → dataExtractionTool (conditional — only when structured data is needed)
 *     → dbOperationsTool  (reads / writes)
 *     → responseGeneratorTool (final WhatsApp reply)
 */

import { Agent, Memory, InMemoryStorageAdapter } from '@voltagent/core';
import { openai } from '@ai-sdk/openai';
import { routerTool } from '../tools/routerTool';
import { dataExtractionTool } from '../tools/dataExtractionTool';
import { dbOperationsTool } from '../tools/dbOperationsTool';
import { responseGeneratorTool } from '../tools/responseGeneratorTool';

// ─── Memory — in-memory storage for conversation history ─────────────────────

export const agentMemory = new Memory({
  storage: new InMemoryStorageAdapter(),
});

// ─── Orchestrator instructions ────────────────────────────────────────────────

const ORCHESTRATOR_INSTRUCTIONS = `You are AgroOrchestrator — the central coordinator for Agrolink, a WhatsApp-based agricultural marketplace in Cameroon connecting smallholder farmers directly with buyers.

## Your role
You receive a raw WhatsApp message and a conversation_state JSON object. You decide which tools to call and in what order to produce the best final reply for the user.

## Available tools
1. routerTool         — Classify intent + extract entities. ALWAYS call this first.
2. dataExtractionTool — Parse message into clean structured data. Call ONLY when:
   - intent is list_produce, buy_produce, register_farmer, check_price
   - AND structured data is needed for a DB write or accurate price lookup
3. dbOperationsTool   — Read/write listings, orders, prices, farmer profiles. Call AFTER extraction.
4. responseGeneratorTool — Generate the final WhatsApp reply. ALWAYS call this last.

## Decision logic

### list_produce
1. routerTool → 2. dataExtractionTool → 3. dbOperationsTool (write_listing) → 4. responseGeneratorTool
If extraction returns missingFields: skip write, go straight to responseGeneratorTool to ask for the missing field.

### buy_produce
1. routerTool → 2. dataExtractionTool → 3. dbOperationsTool (read_listing) → 4. responseGeneratorTool

### check_price
1. routerTool → 2. dataExtractionTool → 3. dbOperationsTool (lookup_price) → 4. responseGeneratorTool

### register_farmer
1. routerTool → 2. dataExtractionTool → 3. dbOperationsTool (register_farmer) → 4. responseGeneratorTool

### track_order
1. routerTool → 3. dbOperationsTool (read_orders) → 4. responseGeneratorTool

### greet / ask_question / out_of_scope
1. routerTool → 4. responseGeneratorTool (skip extraction and DB)

### negotiate
1. routerTool → 4. responseGeneratorTool (with price context from prior turns in state)

## Conversation state
You receive a JSON conversation_state:
{
  "turn": <number>,
  "intentHistory": [...],
  "pendingFlow": "<flow_name or null>",
  "partialData": { ... },
  "userLanguage": "en|fr|pidgin",
  "userName": "<optional>",
  "userRegion": "<optional>"
}

Use pendingFlow and partialData to resume multi-turn flows (e.g. a listing that was missing quantity).
After each turn, include an updated conversation_state in your thinking but the responseGeneratorTool handles the visible reply.

## Error handling
If any tool returns an error or unexpected result:
- Log the issue mentally
- Call responseGeneratorTool with action_result: { error: true, message: "..." } and intent: "error"
- Never expose raw error messages to the user

## Output
Your final output MUST be ONLY the plain-text WhatsApp reply string returned by responseGeneratorTool.
Do not add any wrapping, JSON, or commentary.

## Domain context
- Market: Cameroon (XAF currency)
- Crops: maize, cassava, plantain, cocoyam, tomatoes, palm oil, njama njama, eru, okok, egusi, mbongo, kpem, bobolo
- Regions: Littoral (Douala), Centre (Yaoundé), West (Bafoussam), Northwest (Bamenda), Southwest (Buea)
- Users: low digital literacy — keep interactions simple and warm`;

// ─── Orchestrator agent ───────────────────────────────────────────────────────

export const orchestrator = new Agent({
  name: 'AgroOrchestrator',
  model: openai('gpt-4o'),
  instructions: ORCHESTRATOR_INSTRUCTIONS,
  tools: [routerTool, dataExtractionTool, dbOperationsTool, responseGeneratorTool],
  memory: agentMemory,
  maxSteps: 10,
  temperature: 0.2,
  hooks: {
    onStart: async ({ context }) => {
      console.log(`[AgroOrchestrator] ▶ START operationId=${context.operationId}`);
    },
    onEnd: async ({ output }) => {
      const text = output && 'text' in output ? (output as { text: string }).text : undefined;
      const preview = typeof text === 'string' ? text.slice(0, 80) : '(no text output)';
      console.log(`[AgroOrchestrator] ■ END reply="${preview}"`);
    },
    onToolStart: async ({ tool }) => {
      console.log(`[AgroOrchestrator] → TOOL ${tool.name}`);
    },
    onToolEnd: async ({ tool, output }) => {
      const preview = JSON.stringify(output).slice(0, 120);
      console.log(`[AgroOrchestrator] ← TOOL ${tool.name} result=${preview}`);
    },
    onError: async ({ error }) => {
      console.error(`[AgroOrchestrator] ✗ ERROR`, error);
    },
  },
});
