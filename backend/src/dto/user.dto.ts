import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  IsNotEmpty,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(['farmer', 'buyer'])
  role: string;

  @IsString()
  @IsNotEmpty()
  location: string;

  @IsEnum(['sms', 'whatsapp'])
  preferredChannel: string;

  @IsEnum(['sms', 'whatsapp'])
  lastChannelUsed: string;

  // Farmer only
  @IsOptional()
  @IsArray()
  produces?: string[];

  // Buyer only
  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsArray()
  needs?: string[];
}

export class UpdateUserDto {
  @IsOptional()
  @IsEnum(['farmer', 'buyer'])
  role?: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsEnum(['sms', 'whatsapp'])
  preferredChannel?: string;

  @IsOptional()
  @IsEnum(['sms', 'whatsapp'])
  lastChannelUsed?: string;

  @IsOptional()
  @IsArray()
  produces?: string[];

  @IsOptional()
  @IsString()
  businessName?: string;

  @IsOptional()
  @IsArray()
  needs?: string[];

  @IsOptional()
  @IsString()
  conversationState?: string;

  @IsOptional()
  @IsEnum(['english', 'french', 'pidgin'])
  preferredLanguage?: string;
}