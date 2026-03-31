import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type MatchDocument = Match & Document;

@Schema({ timestamps: true })
export class Match {
  @Prop({ type: Types.ObjectId, ref: 'Listing', required: true })
  listingId: Types.ObjectId; // the farmer's sell listing

  @Prop({ required: true })
  farmerPhone: string;

  @Prop({ required: true })
  buyerPhone: string;

  @Prop({ required: true, lowercase: true })
  product: string;

  @Prop({ required: true })
  quantity: number;

  
  @Prop({ default: null })
  suggestedPrice: number;

  
  @Prop({ default: null })
  farmerPrice: number;


  @Prop({ default: null })
  proposedPrice: number;

  // Final agreed price — set only when farmer replies YES
  @Prop({ default: null })
  agreedPrice: number;

  // Tracks which price was used to close the deal
  @Prop({
    enum: ['farmer_price', 'proposed_price', 'suggested_price', null],
    default: null,
  })
  closedWith: string;

  // Status
  @Prop({
    enum: [
      'pending',      // match found, waiting for farmer to respond
      'offer_sent',   // buyer made a counter offer, waiting for farmer
      'accepted',     // farmer said YES → wa.me links sent to both
      'rejected',     // farmer said NO
    ],
    default: 'pending',
  })
  status: string;

 
  @Prop({ default: null })
  farmerWaLink: string; 

  @Prop({ default: null })
  buyerWaLink: string;  

  
  @Prop({ default: null })
  connectedAt: Date;
}

export const MatchSchema = SchemaFactory.createForClass(Match);

MatchSchema.index({ farmerPhone: 1, status: 1 });
MatchSchema.index({ buyerPhone: 1, status: 1 });
MatchSchema.index({ listingId: 1 });
MatchSchema.index({ status: 1 });