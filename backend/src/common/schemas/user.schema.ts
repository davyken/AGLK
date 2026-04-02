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

  @Prop({ enum: ['sms', 'whatsapp'], default: 'whatsapp' })
  lastChannelUsed: string;

  @Prop({ enum: ['english', 'french', 'pidgin'], default: 'english' })
  preferredLanguage: string;

  @Prop({ default: 0 })
  trustScore: number;

  @Prop({ type: [String], default: [] })
  produces: string[];

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
      'AWAITING_PRODUCES',
      'AWAITING_BUSINESS',
      'AWAITING_NEEDS',
      'REGISTERED',
      'AWAITING_PRICE',
      'AWAITING_CONFIRM',
      'AWAITING_LANGUAGE',
    ],
    default: 'START',
  })
  conversationState: string;
}

export const UserSchema = SchemaFactory.createForClass(User);
