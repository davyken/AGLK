import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type NotificationDocument = Notification & Document;

@Schema({ timestamps: true })
export class Notification {
  @Prop({ required: true })
  userPhone: string;

  @Prop({
    required: true,
    enum: [
      'match_found',
      'match_accepted',
      'match_rejected',
      'price_update',
      'new_listing',
    ],
  })
  type: string;

  @Prop({ required: true })
  message: string;

  @Prop({ required: true, enum: ['sms', 'whatsapp'] })
  channel: string;

  @Prop({
    enum: ['pending', 'sent', 'failed'],
    default: 'pending',
  })
  status: string;

  @Prop({ default: 0 })
  retryCount: number;
}

export const NotificationSchema = SchemaFactory.createForClass(Notification);

NotificationSchema.index({ userPhone: 1, status: 1 });
NotificationSchema.index({ status: 1, retryCount: 1 });
