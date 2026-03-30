import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type ListingDocument = Listing & Document;

@Schema({ timestamps: true })
export class Listing {
  @Prop({ required: true })
  userPhone: string;

  @Prop({ required: true })
  userName: string;

  @Prop({ required: true })
  userLocation: string;

  @Prop({ required: true, enum: ['sell', 'buy'] })
  type: string; // sell = farmer listing | buy = buyer request

  @Prop({ required: true, lowercase: true, trim: true })
  product: string;

  @Prop({ required: true })
  quantity: number;

  @Prop({ default: 'bags' })
  unit: string;

  
  @Prop({ default: null })
  marketMinPrice: number;

  @Prop({ default: null })
  marketAvgPrice: number;

  @Prop({ default: null })
  marketMaxPrice: number;

  // What the system recommended 
  @Prop({ default: null })
  suggestedPrice: number;

  // Final price on the listing (what buyers see)
  @Prop({ default: null })
  price: number;

  // How the price was set
  @Prop({ enum: ['manual', 'auto', 'none'], default: 'none' })
  priceType: string;

  // true if farmer typed AUTO and accepted the suggestion
  @Prop({ default: false })
  acceptedSuggestion: boolean;

  
  
  @Prop({
    enum: ['active', 'matched', 'completed', 'cancelled'],
    default: 'active',
  })
  status: string;

  @Prop({ required: true })
  location: string;

  @Prop({ enum: ['sms', 'whatsapp'], required: true })
  channel: string;
}

export const ListingSchema = SchemaFactory.createForClass(Listing);

ListingSchema.index({ product: 1, status: 1 });
ListingSchema.index({ userPhone: 1 });
ListingSchema.index({ location: 1 });
ListingSchema.index({ type: 1, status: 1 });
ListingSchema.index({ product: 1, location: 1, status: 1 }); 