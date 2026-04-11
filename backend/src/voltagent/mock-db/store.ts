/**
 * mock-db/store.ts
 *
 * In-memory marketplace store for Agrolink.
 * All dates are stored and returned as ISO strings for VoltAgent compatibility.
 */

import { randomUUID } from 'crypto';

// ─── Domain types ──────────────────────────────────────────────────────────────

export type ListingType = 'sell' | 'buy';
export type ListingStatus = 'active' | 'matched' | 'completed' | 'cancelled';
export type OrderStatus = 'pending' | 'confirmed' | 'in_transit' | 'delivered' | 'cancelled';
export type UserRole = 'farmer' | 'buyer' | 'both';
export type Language = 'en' | 'fr' | 'pidgin';

export interface Listing {
  id: string;
  type: ListingType;
  status: ListingStatus;
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
  createdAt: string; // ISO string — VoltAgent-safe
  expiresAt: string; // ISO string — VoltAgent-safe
}

export interface Order {
  id: string;
  listingId: string;
  buyerPhone: string;
  farmerPhone: string;
  crop: string;
  quantity: number;
  unit: string;
  totalXaf: number;
  status: OrderStatus;
  notes?: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}

export interface FarmerProfile {
  phone: string;
  name: string;
  region: string;
  cropsGrown: string[];
  role: UserRole;
  language: Language;
  registeredAt: string; // ISO string
}

export interface PriceRecord {
  id: string;
  crop: string;
  cropNormalized: string;
  region: string;
  priceXaf: number;
  unit: string;
  recordedAt: string; // ISO string
  source: 'listing' | 'market';
}

export interface PipelineConversationState {
  userId: string;
  turn: number;
  intentHistory: string[];
  pendingFlow: string | null;
  partialData: Record<string, unknown>;
  userLanguage: Language;
}

// ─── In-memory collections ─────────────────────────────────────────────────────

const listings = new Map<string, Listing>();
const orders = new Map<string, Order>();
const farmers = new Map<string, FarmerProfile>();
const priceHistory: PriceRecord[] = [];
const conversationStates = new Map<string, PipelineConversationState>();

// ─── Seed data ─────────────────────────────────────────────────────────────────

function seedData(): void {
  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  // ── Farmer profiles ──────────────────────────────────────────────────────────
  const seedFarmers: FarmerProfile[] = [
    {
      phone: '+237671000001',
      name: 'Jean-Pierre Nkeng',
      region: 'West',
      cropsGrown: ['maize', 'cassava', 'cocoyam'],
      role: 'farmer',
      language: 'fr',
      registeredAt: new Date('2024-01-10').toISOString(),
    },
    {
      phone: '+237691000002',
      name: 'Mary Tabi',
      region: 'Northwest',
      cropsGrown: ['tomatoes', 'njama njama', 'eru'],
      role: 'farmer',
      language: 'pidgin',
      registeredAt: new Date('2024-02-05').toISOString(),
    },
    {
      phone: '+237681000003',
      name: 'Emmanuel Mbarga',
      region: 'Centre',
      cropsGrown: ['plantain', 'palm oil', 'cassava'],
      role: 'both',
      language: 'fr',
      registeredAt: new Date('2024-03-15').toISOString(),
    },
    {
      phone: '+237671000004',
      name: 'Agnes Fonkam',
      region: 'Littoral',
      cropsGrown: ['egusi', 'mbongo', 'okok'],
      role: 'farmer',
      language: 'fr',
      registeredAt: new Date('2024-04-01').toISOString(),
    },
    {
      phone: '+237691000005',
      name: 'Paul Biya Nde',
      region: 'Southwest',
      cropsGrown: ['cocoyam', 'eru', 'kpem'],
      role: 'buyer',
      language: 'en',
      registeredAt: new Date('2024-04-20').toISOString(),
    },
  ];
  seedFarmers.forEach((f) => farmers.set(f.phone, f));

  // ── Listings ─────────────────────────────────────────────────────────────────
  // FIX: All dates stored as ISO strings to match the Listing interface.
  const seedListings: Listing[] = [
    {
      id: 'lst_001',
      type: 'sell',
      status: 'active',
      crop: 'maïs',
      cropNormalized: 'maize',
      quantity: 200,
      unit: 'kg',
      priceXaf: 250,
      location: 'Bafoussam',
      region: 'West',
      userPhone: '+237671000001',
      userName: 'Jean-Pierre Nkeng',
      freshness: 'freshly harvested',
      createdAt: new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    {
      id: 'lst_002',
      type: 'sell',
      status: 'active',
      crop: 'tomates',
      cropNormalized: 'tomatoes',
      quantity: 50,
      unit: 'kg',
      priceXaf: 700,
      location: 'Bamenda',
      region: 'Northwest',
      userPhone: '+237691000002',
      userName: 'Mary Tabi',
      freshness: 'harvested 3 days ago',
      createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    {
      id: 'lst_003',
      type: 'sell',
      status: 'active',
      crop: 'plantain',
      cropNormalized: 'plantain',
      quantity: 100,
      unit: 'bunch',
      priceXaf: 1500,
      location: 'Yaoundé',
      region: 'Centre',
      userPhone: '+237681000003',
      userName: 'Emmanuel Mbarga',
      createdAt: new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    {
      id: 'lst_004',
      type: 'buy',
      status: 'active',
      crop: 'cassava',
      cropNormalized: 'cassava',
      quantity: 500,
      unit: 'kg',
      priceXaf: 180,
      location: 'Douala',
      region: 'Littoral',
      userPhone: '+237691000005',
      userName: 'Paul Biya Nde',
      createdAt: new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    {
      id: 'lst_005',
      type: 'sell',
      status: 'active',
      crop: 'egusi',
      cropNormalized: 'egusi',
      quantity: 30,
      unit: 'kg',
      priceXaf: 3500,
      location: 'Douala',
      region: 'Littoral',
      userPhone: '+237671000004',
      userName: 'Agnes Fonkam',
      createdAt: new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    // Extra listings from the first seed block (merged & deduplicated)
    {
      id: 'lst_006',
      type: 'sell',
      status: 'active',
      crop: 'maïs',
      cropNormalized: 'maize',
      quantity: 150,
      unit: 'kg',
      priceXaf: 270,
      location: 'Yaoundé',
      region: 'Centre',
      userPhone: '+237681000001',
      userName: 'Paul Yaoundé',
      createdAt: now.toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    {
      id: 'lst_007',
      type: 'sell',
      status: 'active',
      crop: 'yam',
      cropNormalized: 'yam',
      quantity: 80,
      unit: 'kg',
      priceXaf: 400,
      location: 'Bafoussam',
      region: 'West',
      userPhone: '+237691000006',
      userName: 'Marie Yam',
      createdAt: now.toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    {
      id: 'lst_008',
      type: 'sell',
      status: 'active',
      crop: 'njama njama',
      cropNormalized: 'njama njama',
      quantity: 20,
      unit: 'bundle',
      priceXaf: 500,
      location: 'Bamenda',
      region: 'Northwest',
      userPhone: '+237691000008',
      userName: 'Grace Greens',
      createdAt: now.toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    {
      id: 'lst_009',
      type: 'sell',
      status: 'active',
      crop: 'groundnuts',
      cropNormalized: 'groundnuts',
      quantity: 100,
      unit: 'kg',
      priceXaf: 600,
      location: 'Garoua',
      region: 'North',
      userPhone: '+237661000009',
      userName: 'Ahmadou Nuts',
      createdAt: now.toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    {
      id: 'lst_010',
      type: 'sell',
      status: 'active',
      crop: 'sorghum',
      cropNormalized: 'sorghum',
      quantity: 300,
      unit: 'kg',
      priceXaf: 200,
      location: 'Maroua',
      region: 'Far North',
      userPhone: '+237661000010',
      userName: 'Fatima Sorghum',
      createdAt: now.toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    {
      id: 'lst_011',
      type: 'sell',
      status: 'active',
      crop: 'onions',
      cropNormalized: 'onions',
      quantity: 100,
      unit: 'kg',
      priceXaf: 800,
      location: 'Maroua',
      region: 'Far North',
      userPhone: '+237661000011',
      userName: 'Hassan Onions',
      createdAt: now.toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    {
      id: 'lst_012',
      type: 'sell',
      status: 'active',
      crop: 'millet',
      cropNormalized: 'millet',
      quantity: 400,
      unit: 'kg',
      priceXaf: 300,
      location: 'Ngaoundéré',
      region: 'Adamawa',
      userPhone: '+237661000012',
      userName: 'Aminatou Millet',
      createdAt: now.toISOString(),
      expiresAt: in30Days.toISOString(),
    },
    {
      id: 'lst_013',
      type: 'sell',
      status: 'active',
      crop: 'palm oil',
      cropNormalized: 'palm oil',
      quantity: 50,
      unit: 'liter',
      priceXaf: 1200,
      location: 'Bertoua',
      region: 'East',
      userPhone: '+237661000013',
      userName: 'Pierre Palm',
      createdAt: now.toISOString(),
      expiresAt: in30Days.toISOString(),
    },
  ];
  seedListings.forEach((l) => listings.set(l.id, l));

  // ── Price history ─────────────────────────────────────────────────────────────
  // FIX: Use now.getTime() (Date object) — not now.toISOString() — for arithmetic,
  //      then convert the result to an ISO string for storage.
  const seedPrices: PriceRecord[] = [
    { id: 'p01', crop: 'maïs',       cropNormalized: 'maize',       region: 'West',      priceXaf: 250,  unit: 'kg',     recordedAt: new Date(now.getTime() - 2 * 86400000).toISOString(), source: 'listing' },
    { id: 'p02', crop: 'maïs',       cropNormalized: 'maize',       region: 'West',      priceXaf: 240,  unit: 'kg',     recordedAt: new Date(now.getTime() - 7 * 86400000).toISOString(), source: 'listing' },
    { id: 'p03', crop: 'maïs',       cropNormalized: 'maize',       region: 'Centre',    priceXaf: 270,  unit: 'kg',     recordedAt: new Date(now.getTime() - 3 * 86400000).toISOString(), source: 'listing' },
    { id: 'p04', crop: 'tomates',    cropNormalized: 'tomatoes',    region: 'Northwest', priceXaf: 700,  unit: 'kg',     recordedAt: new Date(now.getTime() - 1 * 86400000).toISOString(), source: 'listing' },
    { id: 'p05', crop: 'tomates',    cropNormalized: 'tomatoes',    region: 'Littoral',  priceXaf: 800,  unit: 'kg',     recordedAt: new Date(now.getTime() - 4 * 86400000).toISOString(), source: 'market'  },
    { id: 'p06', crop: 'plantain',   cropNormalized: 'plantain',    region: 'Centre',    priceXaf: 1500, unit: 'bunch',  recordedAt: new Date(now.getTime() - 3 * 86400000).toISOString(), source: 'listing' },
    { id: 'p07', crop: 'cassava',    cropNormalized: 'cassava',     region: 'Littoral',  priceXaf: 180,  unit: 'kg',     recordedAt: new Date(now.getTime() - 5 * 86400000).toISOString(), source: 'listing' },
    { id: 'p08', crop: 'egusi',      cropNormalized: 'egusi',       region: 'Littoral',  priceXaf: 3500, unit: 'kg',     recordedAt: new Date(now.getTime() - 1 * 86400000).toISOString(), source: 'listing' },
    { id: 'p09', crop: 'palm oil',   cropNormalized: 'palm oil',    region: 'Littoral',  priceXaf: 1200, unit: 'liter',  recordedAt: new Date(now.getTime() - 6 * 86400000).toISOString(), source: 'market'  },
    { id: 'p10', crop: 'njama njama',cropNormalized: 'njama njama', region: 'Northwest', priceXaf: 500,  unit: 'bundle', recordedAt: new Date(now.getTime() - 2 * 86400000).toISOString(), source: 'listing' },
    { id: 'p11', crop: 'yam',        cropNormalized: 'yam',         region: 'West',      priceXaf: 400,  unit: 'kg',     recordedAt: new Date(now.getTime() - 1 * 86400000).toISOString(), source: 'listing' },
    { id: 'p12', crop: 'groundnuts', cropNormalized: 'groundnuts',  region: 'North',     priceXaf: 600,  unit: 'kg',     recordedAt: new Date(now.getTime() - 1 * 86400000).toISOString(), source: 'listing' },
    { id: 'p13', crop: 'sorghum',    cropNormalized: 'sorghum',     region: 'Far North', priceXaf: 200,  unit: 'kg',     recordedAt: new Date(now.getTime() - 2 * 86400000).toISOString(), source: 'listing' },
    { id: 'p14', crop: 'onions',     cropNormalized: 'onions',      region: 'Far North', priceXaf: 800,  unit: 'kg',     recordedAt: new Date(now.getTime() - 2 * 86400000).toISOString(), source: 'listing' },
    { id: 'p15', crop: 'millet',     cropNormalized: 'millet',      region: 'Adamawa',   priceXaf: 300,  unit: 'kg',     recordedAt: new Date(now.getTime() - 3 * 86400000).toISOString(), source: 'listing' },
  ];
  priceHistory.push(...seedPrices);
}

// Run seeder once at module load
seedData();

// ─── Store API ─────────────────────────────────────────────────────────────────

/**
 * Read listings with optional filters.
 * Returns listings sorted newest-first (ISO strings sort lexicographically,
 * so a simple string comparison is sufficient and avoids Date parsing).
 */
export function readListings(filters: {
  cropNormalized?: string;
  type?: ListingType;
  status?: ListingStatus;
  region?: string;
  limit?: number;
}): Listing[] {
  let results = Array.from(listings.values());

  if (filters.cropNormalized) {
    const q = filters.cropNormalized.toLowerCase();
    results = results.filter(
      (l) =>
        l.cropNormalized.toLowerCase().includes(q) ||
        l.crop.toLowerCase().includes(q),
    );
  }
  if (filters.type)   results = results.filter((l) => l.type === filters.type);
  if (filters.status) results = results.filter((l) => l.status === filters.status);
  if (filters.region) {
    const r = filters.region.toLowerCase();
    results = results.filter(
      (l) =>
        l.region.toLowerCase().includes(r) ||
        l.location.toLowerCase().includes(r),
    );
  }

  // FIX: createdAt is an ISO string — compare lexicographically (correct for ISO 8601).
  results.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));

  return results.slice(0, filters.limit ?? 10);
}

/**
 * Write (create) a new listing.
 * FIX: Dates are stored as ISO strings to match the Listing interface,
 *      so no post-hoc serialisation is needed in readListings.
 */
export function writeListing(
  data: Omit<Listing, 'id' | 'createdAt' | 'expiresAt' | 'status'>,
): Listing {
  const listing: Listing = {
    id: `lst_${randomUUID().slice(0, 8)}`,
    status: 'active',
    createdAt: new Date().toISOString(),                                   // FIX: ISO string
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // FIX: ISO string
    ...data,
  };
  listings.set(listing.id, listing);

  // Auto-record price history for sell listings
  if (listing.priceXaf && listing.type === 'sell') {
    priceHistory.push({
      id: `p_${randomUUID().slice(0, 8)}`,
      crop: listing.crop,
      cropNormalized: listing.cropNormalized,
      region: listing.region,
      priceXaf: listing.priceXaf,
      unit: listing.unit,
      recordedAt: new Date().toISOString(), // FIX: ISO string
      source: 'listing',
    });
  }

  return listing;
}

/**
 * Read orders for a user, optionally filtered by status or orderId.
 */
export function readOrders(filters: {
  userPhone?: string;
  status?: OrderStatus;
  orderId?: string;
}): Order[] {
  let results = Array.from(orders.values());

  if (filters.orderId)   return results.filter((o) => o.id === filters.orderId);
  if (filters.userPhone) {
    results = results.filter(
      (o) =>
        o.buyerPhone === filters.userPhone ||
        o.farmerPhone === filters.userPhone,
    );
  }
  if (filters.status) results = results.filter((o) => o.status === filters.status);

  // FIX: createdAt is an ISO string — compare lexicographically.
  return results.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
}

/**
 * Write (create) a new order.
 * FIX: Dates stored as ISO strings to match the Order interface.
 */
export function writeOrder(
  data: Omit<Order, 'id' | 'createdAt' | 'updatedAt'>,
): Order {
  const now = new Date().toISOString(); // FIX: ISO string
  const order: Order = {
    id: `ord_${randomUUID().slice(0, 8)}`,
    createdAt: now,
    updatedAt: now,
    ...data,
  };
  orders.set(order.id, order);
  return order;
}

/**
 * Look up aggregated price history for a crop, optionally scoped to a region.
 * FIX: recordedAt is now an ISO string, so comparisons use string comparison
 *      or Date.parse() — both are correct for ISO 8601.
 */
export function lookupPrice(
  cropNormalized: string,
  region?: string,
): {
  crop: string;
  region: string;
  avgPriceXaf: number;
  minPriceXaf: number;
  maxPriceXaf: number;
  unit: string;
  sampleCount: number;
  lastUpdated: string; // ISO string
} | null {
  const q = cropNormalized.toLowerCase();
  let records = priceHistory.filter((p) =>
    p.cropNormalized.toLowerCase().includes(q),
  );

  if (region) {
    const r = region.toLowerCase();
    const regional = records.filter((p) => p.region.toLowerCase().includes(r));
    if (regional.length > 0) records = regional;
  }

  if (records.length === 0) return null;

  // Take last 30 days — FIX: compare ISO strings (lexicographic = chronological)
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const recent = records.filter((p) => p.recordedAt >= cutoff);
  const final = recent.length > 0 ? recent : records;

  const prices = final.map((p) => p.priceXaf);
  const avg = Math.round(prices.reduce((a, b) => a + b, 0) / prices.length);

  // Most recent record first
  const sorted = [...final].sort((a, b) => (b.recordedAt > a.recordedAt ? 1 : -1));

  return {
    crop: sorted[0].crop,
    region: region ?? sorted[0].region,
    avgPriceXaf: avg,
    minPriceXaf: Math.min(...prices),
    maxPriceXaf: Math.max(...prices),
    unit: sorted[0].unit,
    sampleCount: final.length,
    lastUpdated: sorted[0].recordedAt, // already an ISO string
  };
}

/**
 * Register or update a farmer profile.
 * FIX: registeredAt stored as ISO string.
 */
export function registerFarmer(
  data: Partial<FarmerProfile> & { phone: string },
): { farmer: FarmerProfile; isNew: boolean } {
  const existing = farmers.get(data.phone);
  const isNew = !existing;

  const farmer: FarmerProfile = {
    phone: data.phone,
    name: data.name ?? existing?.name ?? 'Unknown',
    region: data.region ?? existing?.region ?? 'Unknown',
    cropsGrown: data.cropsGrown ?? existing?.cropsGrown ?? [],
    role: data.role ?? existing?.role ?? 'farmer',
    language: data.language ?? existing?.language ?? 'en',
    registeredAt: existing?.registeredAt ?? new Date().toISOString(), // FIX: ISO string
  };

  farmers.set(farmer.phone, farmer);
  return { farmer, isNew };
}

/** Read a single farmer profile by phone number. */
export function readFarmer(phone: string): FarmerProfile | null {
  return farmers.get(phone) ?? null;
}

/** Get or initialise conversation state for a user. */
export function getConversationState(userId: string): PipelineConversationState {
  if (!conversationStates.has(userId)) {
    conversationStates.set(userId, {
      userId,
      turn: 0,
      intentHistory: [],
      pendingFlow: null,
      partialData: {},
      userLanguage: 'en',
    });
  }
  return conversationStates.get(userId)!;
}

/** Persist updated conversation state. */
export function saveConversationState(state: PipelineConversationState): void {
  conversationStates.set(state.userId, { ...state });
}