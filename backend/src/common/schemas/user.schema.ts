import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, trim: true })
  phone: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ trim: true })
  username: string;

  @Prop()
  password: string;

  // Role is no longer required — users are not locked into farmer/buyer.
  // Kept for legacy compatibility; intent is resolved per-message.
  @Prop({ enum: ['farmer', 'buyer', 'admin', 'both', 'user'], default: 'user' })
  role: string;

  @Prop({ required: true, trim: true })
  location: string;

  @Prop({ enum: ['sms', 'whatsapp'], default: 'whatsapp' })
  preferredChannel: string;

  // Detected language — bot replies in this language throughout
  @Prop({ enum: ['english', 'french', 'pidgin'], default: 'english' })
  language: string;

  @Prop({ enum: ['sms', 'whatsapp'], default: 'whatsapp' })
  lastChannelUsed: string;

  @Prop({ default: 0 })
  trustScore: number;

  @Prop({ default: false })
  isBanned: boolean;

  // Farmer only
  @Prop({ type: [String], default: [] })
  produces: string[];

  // Buyer only
  @Prop({ trim: true })
  businessName: string;

  @Prop({ type: [String], default: [] })
  needs: string[];

  @Prop({
    enum: [
      'START',
      'AWAITING_NAME',
      'AWAITING_LOCATION',
      'REGISTERED',
      // Legacy states kept so existing users in mid-registration aren't stuck
      'AWAITING_ROLE',
      'AWAITING_PRODUCES',
      'AWAITING_BUSINESS',
      'AWAITING_NEEDS',
      'AWAITING_PRICE',
      'AWAITING_CONFIRM',
      'AWAITING_LANGUAGE',
      'AWAITING_COUNTER_PRICE',
    ],
    default: 'START',
  })
  conversationState: string;

  // ── Persisted pending states (survives server restarts) ───────
  // Stores transient sell/buy_select flow state
  @Prop({ type: Object, default: null })
  pendingState: {
    type:
      | 'sell'
      | 'sell_waiting_image'
      | 'buy_select'
      | 'awaiting_counter_response';
    product: string;
    productDisplay?: string;
    quantity: number;
    unit: string;
    price?: number;
    imageUrl?: string;
    imageMediaId?: string;
    expiresAt?: string; // ISO string — TTL after which state is discarded
    listings?: Array<{
      id: string;
      userPhone: string;
      farmerName: string;
      location: string;
      quantity: number;
      price: number;
      imageUrl?: string;
      imageMediaId?: string;
    }>;
    // counter-offer fields (buyer side)
    farmerPhone?: string;
    counterPrice?: number;
    sellerListingId?: string;
    buyerListingId?: string;
  } | null;

  // Stores farmer YES/NO (or counter-offer) pending response state
  @Prop({ type: Object, default: null })
  pendingFarmerResponse: {
    buyerPhone: string;
    sellerListingId: string;
    buyerListingId: string;
    product: string;
    quantity: number;
    unit: string;
    price: number;
    language: string;
    awaitingCounterPrice?: boolean; // true when farmer chose "counter"
    expiresAt?: string;
  } | null;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Index for fast lookup by phone
// UserSchema.index({ phone: 1 });
