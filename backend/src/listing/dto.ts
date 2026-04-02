import {
  IsString,
  IsNotEmpty,
  IsEnum,
  IsNumber,
  IsOptional,
  IsBoolean,
} from 'class-validator';

export class CreateListingDto {
  @IsEnum(['sell', 'buy'])
  type: string;

  @IsString()
  @IsNotEmpty()
  product: string;

  @IsNumber()
  quantity: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  marketMinPrice?: number;

  @IsOptional()
  @IsNumber()
  marketAvgPrice?: number;

  @IsOptional()
  @IsNumber()
  marketMaxPrice?: number;

  @IsOptional()
  @IsString()
  location?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsEnum(['manual', 'auto', 'none'])
  priceType?: string;

  @IsOptional()
  @IsBoolean()
  acceptedSuggestion?: boolean;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  imageMediaId?: string;
}

export class UpdateListingDto {
  @IsOptional()
  @IsNumber()
  quantity?: number;

  @IsOptional()
  @IsString()
  unit?: string;

  @IsOptional()
  @IsNumber()
  price?: number;

  @IsOptional()
  @IsEnum(['manual', 'auto', 'none'])
  priceType?: string;

  @IsOptional()
  @IsBoolean()
  acceptedSuggestion?: boolean;

  @IsOptional()
  @IsEnum(['active', 'matched', 'completed', 'cancelled'])
  status?: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsString()
  imageMediaId?: string;
}
