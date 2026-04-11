/**
 * tools/dbOperationsTool.ts
 *
 * Agent 3 — DB Operations Sub-Agent
 *
 * Executes marketplace database reads and writes.
 * No LLM involvement — pure logic against the in-memory mock store.
 * All operations are logged with timestamps.
 */

import { createTool } from '@voltagent/core';
import { z } from 'zod';
import {
  readListings,
  writeListing,
  readOrders,
  writeOrder,
  lookupPrice,
  registerFarmer,
  readFarmer,
  getConversationState,
  saveConversationState,
  type Listing,
  type Order,
  type FarmerProfile,
  type PipelineConversationState,
} from '../mock-db/store';

// ─── Result types ─────────────────────────────────────────────────────────────

type DbSuccess<T> = { ok: true; data: T; timestamp: string };
type DbError = { ok: false; error: string; timestamp: string };
type DbResult<T> = DbSuccess<T> | DbError;

function ok<T>(data: T): DbSuccess<T> {
  return { ok: true, data, timestamp: new Date().toISOString() };
}

function fail(error: string): DbError {
  return { ok: false, error, timestamp: new Date().toISOString() };
}

function log(operation: string, payload: unknown, result: DbResult<unknown>): void {
  const status = result.ok ? '✓' : '✗';
  console.log(
    `[dbOperationsTool] ${status} op=${operation} ts=${result.timestamp} ` +
      `payload=${JSON.stringify(payload).slice(0, 120)}`,
  );
}

// ─── Tool definition ──────────────────────────────────────────────────────────

export const dbOperationsTool = createTool({
  name: 'dbOperationsTool',
  description:
    'Executes marketplace database reads and writes (listings, orders, prices, farmer registration). ' +
    'No LLM — pure logic. Returns structured results for the orchestrator to use.',

  parameters: z.object({
    operation: z
      .enum([
        'read_listing',
        'write_listing',
        'read_orders',
        'write_order',
        'lookup_price',
        'register_farmer',
        'read_farmer',
        'get_conversation_state',
        'save_conversation_state',
      ])
      .describe('The database operation to perform'),

    payload: z
      .record(z.string(), z.unknown())
      .describe('Operation-specific data. See documentation for each operation type.'),
  }),

  execute: async ({ operation, payload }) => {
    const startMs = Date.now();

    try {
      let result: DbResult<unknown>;

      switch (operation) {
        // ── Read listings ─────────────────────────────────────────────────────
        case 'read_listing': {
          const filters = payload as {
            cropNormalized?: string;
            type?: 'sell' | 'buy';
            status?: string;
            region?: string;
            limit?: number;
          };
          const listings = readListings({
            cropNormalized: filters.cropNormalized,
            type: filters.type,
            status: (filters.status ?? 'active') as any,
            region: filters.region,
            limit: filters.limit ?? 5,
          });
          result = ok<Listing[]>(listings);
          break;
        }

        // ── Write listing ─────────────────────────────────────────────────────
        case 'write_listing': {
          const data = payload as {
            type: 'sell' | 'buy';
            crop: string;
            cropNormalized: string;
            quantity: number;
            unit: string;
            priceXaf?: number;
            location: string;
            region: string;
            userPhone: string;
            userName: string;
            freshness?: string;
            notes?: string;
          };

          if (!data.crop || !data.cropNormalized || !data.quantity || !data.unit || !data.location || !data.userPhone) {
            result = fail('Missing required fields: crop, quantity, unit, location, userPhone');
            break;
          }

          const listing = writeListing(data);
          result = ok<Listing>(listing);
          break;
        }

        // ── Read orders ───────────────────────────────────────────────────────
        case 'read_orders': {
          const filters = payload as {
            userPhone?: string;
            status?: string;
            orderId?: string;
          };
          const orders = readOrders({
            userPhone: filters.userPhone,
            status: filters.status as any,
            orderId: filters.orderId,
          });
          result = ok<Order[]>(orders);
          break;
        }

        // ── Write order ───────────────────────────────────────────────────────
        case 'write_order': {
          const data = payload as {
            buyerPhone: string;
            farmerPhone: string;
            listingId: string;
            crop: string;
            quantity: number;
            unit: string;
            agreedPriceXaf: number; // caller-facing name; mapped to totalXaf below
            location: string;
          };

          if (!data.buyerPhone || !data.farmerPhone || !data.listingId) {
            result = fail('Missing required fields: buyerPhone, farmerPhone, listingId');
            break;
          }

          // FIX: The Order interface requires `totalXaf`, but the agent payload
          // uses `agreedPriceXaf`. Destructure to rename at the boundary so
          // neither the caller nor the store interface needs to change.
          const { agreedPriceXaf, ...rest } = data;
          const order = writeOrder({
            ...rest,
            totalXaf: agreedPriceXaf,
            status: 'pending',
          });
          result = ok<Order>(order);
          break;
        }

        // ── Lookup price ──────────────────────────────────────────────────────
        case 'lookup_price': {
          const { cropNormalized, region } = payload as {
            cropNormalized: string;
            region?: string;
          };

          if (!cropNormalized) {
            result = fail('Missing required field: cropNormalized');
            break;
          }

          const priceData = lookupPrice(cropNormalized, region);
          result = priceData
            ? ok(priceData)
            : fail(`No price data found for "${cropNormalized}"${region ? ` in ${region}` : ''}`);
          break;
        }

        // ── Register farmer ───────────────────────────────────────────────────
        case 'register_farmer': {
          const data = payload as Partial<FarmerProfile> & { phone: string };

          if (!data.phone) {
            result = fail('Missing required field: phone');
            break;
          }

          const { farmer, isNew } = registerFarmer(data);
          result = ok<{ farmer: FarmerProfile; isNew: boolean }>({ farmer, isNew });
          break;
        }

        // ── Read farmer ───────────────────────────────────────────────────────
        case 'read_farmer': {
          const { phone } = payload as { phone: string };

          if (!phone) {
            result = fail('Missing required field: phone');
            break;
          }

          const farmer = readFarmer(phone);
          result = farmer
            ? ok<FarmerProfile>(farmer)
            : fail(`Farmer not found: ${phone}`);
          break;
        }

        // ── Get conversation state ────────────────────────────────────────────
        case 'get_conversation_state': {
          const { userId } = payload as { userId: string };

          if (!userId) {
            result = fail('Missing required field: userId');
            break;
          }

          const state = getConversationState(userId);
          result = ok<PipelineConversationState>(state);
          break;
        }

        // ── Save conversation state ───────────────────────────────────────────
        case 'save_conversation_state': {
          const state = payload as unknown as PipelineConversationState;

          if (!state.userId) {
            result = fail('Missing required field: userId in state');
            break;
          }

          saveConversationState(state);
          result = ok<{ saved: true }>({ saved: true });
          break;
        }

        default:
          result = fail(`Unknown operation: ${operation}`);
      }

      const latencyMs = Date.now() - startMs;
      log(operation, payload, result);
      console.log(`[dbOperationsTool] latency=${latencyMs}ms`);

      return result;
    } catch (err) {
      const latencyMs = Date.now() - startMs;
      const result = fail(`Unexpected error: ${String(err)}`);
      log(operation, payload, result);
      console.error(`[dbOperationsTool] ERROR latency=${latencyMs}ms`, err);
      return result;
    }
  },
});