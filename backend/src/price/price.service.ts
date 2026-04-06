import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Listing, ListingDocument } from '../common/schemas/listing.schema';

export interface MarketPrice {
  product: string;
  low: number;
  avg: number;
  high: number;
  suggested: number;
  lastUpdated: Date;
}

@Injectable()
export class PriceService {
  private priceCache: Map<string, MarketPrice> = new Map();
  private cacheTTL = 60 * 60 * 1000;
  private cacheTimestamps: Map<string, number> = new Map();

  constructor(
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
  ) {}

  async getPrice(product: string): Promise<MarketPrice | null> {
    const normalizedProduct = product.toLowerCase().trim();
    
    if (this.isCacheValid(normalizedProduct)) {
      return this.priceCache.get(normalizedProduct) || null;
    }

    const price = await this.calculatePriceFromListings(normalizedProduct);
    
    if (price) {
      this.priceCache.set(normalizedProduct, price);
      this.cacheTimestamps.set(normalizedProduct, Date.now());
    }
    
    return price;
  }

  async getAllPrices(): Promise<MarketPrice[]> {
    const products = await this.getDistinctProducts();
    const prices: MarketPrice[] = [];

    for (const product of products) {
      const price = await this.getPrice(product);
      if (price) {
        prices.push(price);
      }
    }

    return prices;
  }

  async updatePrice(
    product: string,
    prices: Partial<MarketPrice>,
  ): Promise<MarketPrice> {
    const normalizedProduct = product.toLowerCase().trim();
    const existing = this.priceCache.get(normalizedProduct);

    if (existing) {
      const updated = { ...existing, ...prices, lastUpdated: new Date() };
      this.priceCache.set(normalizedProduct, updated);
      return updated;
    }

    const newPrice: MarketPrice = {
      product: normalizedProduct,
      low: prices.low || 0,
      avg: prices.avg || 0,
      high: prices.high || 0,
      suggested: prices.suggested || 0,
      lastUpdated: new Date(),
    };
    this.priceCache.set(normalizedProduct, newPrice);
    return newPrice;
  }

  async hasPrice(product: string): Promise<boolean> {
    return this.priceCache.has(product.toLowerCase().trim());
  }

  async getAvailableProducts(): Promise<string[]> {
    return Array.from(this.priceCache.keys());
  }

  async invalidateCache(product?: string): Promise<void> {
    if (product) {
      const normalizedProduct = product.toLowerCase().trim();
      this.priceCache.delete(normalizedProduct);
      this.cacheTimestamps.delete(normalizedProduct);
    } else {
      this.priceCache.clear();
      this.cacheTimestamps.clear();
    }
  }

  private isCacheValid(product: string): boolean {
    const timestamp = this.cacheTimestamps.get(product);
    if (!timestamp) return false;
    return Date.now() - timestamp < this.cacheTTL;
  }

  private async calculatePriceFromListings(product: string): Promise<MarketPrice | null> {
    const listings = await this.listingModel.find({
      product: product.toLowerCase().trim(),
      status: 'active',
      price: { $exists: true, $ne: null },
    }).exec();

    if (listings.length === 0) {
      return null;
    }

    const prices = listings
      .map(l => l.price)
      .filter(p => typeof p === 'number' && p > 0);

    if (prices.length === 0) {
      return null;
    }

    const sortedPrices = [...prices].sort((a, b) => a - b);
    const min = sortedPrices[0];
    const max = sortedPrices[sortedPrices.length - 1];
    const sum = sortedPrices.reduce((a, b) => a + b, 0);
    const avg = sum / sortedPrices.length;
    
    const suggested = Math.round(avg * 0.95);

    return {
      product: product.toLowerCase().trim(),
      low: min,
      avg: Math.round(avg),
      high: max,
      suggested,
      lastUpdated: new Date(),
    };
  }

  private async getDistinctProducts(): Promise<string[]> {
    const products = await this.listingModel.distinct('product', {
      status: 'active',
      price: { $exists: true, $ne: null },
    }).exec();
    return products.map(p => p.toString().toLowerCase().trim());
  }
}
