import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type UserDocument = User & Document;

@Schema({ timestamps: true })
export class User {
  @Prop({ required: true, unique: true, trim: true })
  phone: string;

  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, enum: ['farmer', 'buyer'] })
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
      'AWAITING_ROLE',
      'AWAITING_NAME',
      'AWAITING_LOCATION',
      'AWAITING_PRODUCES',   // farmer
      'AWAITING_BUSINESS',   // buyer
      'AWAITING_NEEDS',      // buyer
      'REGISTERED',
      'AWAITING_PRICE',
      'AWAITING_CONFIRM',
    ],
    default: 'START',
  })
  conversationState: string;
}

export const UserSchema = SchemaFactory.createForClass(User);

// Index for fast lookup by phone
// UserSchema.index({ phone: 1 });