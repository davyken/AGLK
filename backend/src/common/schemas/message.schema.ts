import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type MessageDocument = Message & Document;

@Schema({ timestamps: true })
export class Message {
  @Prop({ required: true })
  phone: string;

  @Prop({ required: true, enum: ['sms', 'whatsapp'] })
  channel: string;

  @Prop({ required: true })
  messageText: string;

  @Prop({ required: true, enum: ['incoming', 'outgoing'] })
  direction: string;

  @Prop({
    enum: ['received', 'sent', 'failed', 'pending'],
    default: 'pending',
  })
  status: string;

  @Prop({ type: Object, default: null })
  rawPayload: Record<string, any>;
}

export const MessageSchema = SchemaFactory.createForClass(Message);

MessageSchema.index({ phone: 1, createdAt: -1 });
MessageSchema.index({ channel: 1, status: 1 });
