import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type PriceHistoryDocument = PriceHistory & Document;

@Schema({ timestamps: true })
export class PriceHistory {
  @Prop({ required: true, lowercase: true })
  product: string;

  @Prop({ required: true })
  location: string;

  @Prop({ required: true })
  avgPrice: number;

  @Prop({ required: true })
  minPrice: number;

  @Prop({ required: true })
  maxPrice: number;

  @Prop({ required: true })
  suggestedPrice: number;

  @Prop({ default: 0 })
  sampleSize: number;

  @Prop({ enum: ['transaction', 'api', 'manual'], default: 'manual' })
  source: string;

  @Prop({ default: Date.now })
  updatedAt: Date;
}

export const PriceHistorySchema = SchemaFactory.createForClass(PriceHistory);

// Pricing engine main lookup
PriceHistorySchema.index({ product: 1, location: 1 }, { unique: true });
