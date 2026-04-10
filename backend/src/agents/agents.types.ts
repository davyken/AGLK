// ─── Shared types for the 4-agent pipeline ──────────────────────────────────

export type IntentLabel =
  | 'list_produce'      // farmer listing produce for sale
  | 'buy_produce'       // buyer searching for produce
  | 'check_price'       // price inquiry
  | 'negotiate'         // offer / counter-offer
  | 'register_farmer'   // new farmer onboarding
  | 'track_order'       // order status inquiry
  | 'ask_question'      // general market question
  | 'greet'             // greeting / hello
  | 'out_of_scope';     // unrelated message

export type AgentLanguage = 'en' | 'fr' | 'pidgin';

// ─── Agent 1 — Router output ─────────────────────────────────────────────────

export interface RouterEntities {
  crop?: string;
  location?: string;
  quantity?: string;
  unit?: string;
  price?: string;
  name?: string;
  region?: string;
  [key: string]: string | undefined;
}

export interface RouterOutput {
  intent: IntentLabel;
  entities: RouterEntities;
  confidence: number; // 0.0–1.0
  language: AgentLanguage;
}

// ─── Agent 2 — Orchestrator output ───────────────────────────────────────────

export type DbOperation =
  | 'read_listing'
  | 'write_listing'
  | 'read_buyer_request'
  | 'write_buyer_request'
  | 'read_price'
  | 'write_price_history'
  | 'read_user'
  | 'write_user'
  | 'read_order'
  | 'write_order'
  | 'read_match'
  | 'write_match';

export interface OrchestratorOutput {
  /** The next action the system should take */
  action:
    | 'post_listing'
    | 'search_produce'
    | 'check_price'
    | 'start_negotiation'
    | 'register_user'
    | 'track_order'
    | 'ask_clarification'
    | 'send_info'
    | 'greet_user'
    | 'reject_out_of_scope';
  /** Whether the Data Extractor agent should run */
  requires_extraction: boolean;
  /** DB read/write operations needed for this action */
  db_operations: DbOperation[];
  /** Fields to persist into the ConversationState */
  state_update: Record<string, any>;
  /** Structured data passed to the Response Generator */
  context_for_response: Record<string, any>;
}

// ─── Agent 3 — Extractor output ──────────────────────────────────────────────

export interface ExtractedListing {
  type: 'listing';
  crop: string;
  cropNormalized: string;  // English canonical name
  quantity: number;
  unit: string;
  price?: number;
  currency: 'XAF';
  location?: string;
  freshness?: string;
  farmerName?: string;
  availableAt?: string;
}

export interface ExtractedBuyRequest {
  type: 'buy_request';
  crop: string;
  cropNormalized: string;
  quantity?: number;
  unit?: string;
  budget?: number;
  budgetMax?: number;
  currency: 'XAF';
  location?: string;
  deliveryPreference?: string;
}

export interface ExtractedFarmerProfile {
  type: 'farmer_profile';
  name?: string;
  region?: string;
  contact?: string;
  crops: string[];
}

export interface ExtractedPriceCheck {
  type: 'price_check';
  crop: string;
  cropNormalized: string;
  location?: string;
}

export type ExtractorOutput =
  | ExtractedListing
  | ExtractedBuyRequest
  | ExtractedFarmerProfile
  | ExtractedPriceCheck
  | null;

// ─── Conversation history & state ────────────────────────────────────────────

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ConversationState {
  userId: string;              // WhatsApp phone number
  language: AgentLanguage;
  currentFlow?: string;        // 'listing_flow' | 'buy_flow' | 'registration_flow' | null
  flowStep?: string;           // step within a multi-turn flow
  pendingData?: Record<string, any>; // partial entity data awaiting completion
  lastIntent?: IntentLabel;
  turnCount: number;
  userName?: string;
  userLocation?: string;
}

// ─── Pipeline result ─────────────────────────────────────────────────────────

export interface AgentLog {
  agent: string;
  model: string;
  inputSummary: string;
  outputSummary: string;
  latencyMs: number;
  success: boolean;
  error?: string;
}

export interface PipelineResult {
  reply: string;
  stateUpdate: Partial<ConversationState>;
  agentLogs: AgentLog[];
}
