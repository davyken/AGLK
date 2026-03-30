import { IsString, IsOptional, IsObject } from 'class-validator';

export class WebhookEntryDto {
  @IsString()
  id: string;

  @IsString()
  changes: string;
}

export class WebhookValueDto {
  @IsString()
  messaging_product: string;

  @IsOptional()
  @IsString()
  metadata?: string;

  @IsOptional()
  @IsObject()
  contacts?: any[];

  @IsOptional()
  @IsObject()
  messages?: any[];
}

export class WebhookDto {
  @IsOptional()
  @IsString()
  object?: string;

  @IsOptional()
  @IsObject()
  entry?: any[];
}