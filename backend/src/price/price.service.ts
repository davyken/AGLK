import { Injectable } from '@nestjs/common';

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
  // In-memory price cache - in production, this would be in a database or fetched from an API
  private priceCache: Map<string, MarketPrice> = new Map();

  constructor() {
    // Initialize with default prices for common products
    this.initializeDefaultPrices();
  }

  private initializeDefaultPrices(): void {
    const defaultPrices: Omit<MarketPrice, 'lastUpdated'>[] = [
      { product: 'maize', low: 17600, avg: 22000, high: 26400, suggested: 20900 },
      { product: 'cassava', low: 12000, avg: 15000, high: 18000, suggested: 14250 },
      { product: 'tomatoes', low: 20000, avg: 25000, high: 30000, suggested: 23750 },
      { product: 'plantain', low: 14400, avg: 18000, high: 21600, suggested: 17100 },
      { product: 'beans', low: 24000, avg: 30000, high: 36000, suggested: 28500 },
      { product: 'rice', low: 28000, avg: 35000, high: 42000, suggested: 33250 },
      { product: 'cocoa', low: 96000, avg: 120000, high: 144000, suggested: 114000 },
      { product: 'coffee', low: 64000, avg: 80000, high: 96000, suggested: 76000 },
      { product: 'palm', low: 36000, avg: 45000, high: 54000, suggested: 42750 },
      { product: 'onion', low: 16000, avg: 20000, high: 24000, suggested: 19000 },
      { product: 'pepper', low: 22400, avg: 28000, high: 33600, suggested: 26600 },
      { product: 'potato', low: 25600, avg: 32000, high: 38400, suggested: 30400 },
      { product: 'yam', low: 20000, avg: 25000, high: 30000, suggested: 23750 },
      { product: 'carrot', low: 18000, avg: 22000, high: 26000, suggested: 20900 },
      { product: 'cabbage', low: 14000, avg: 18000, high: 22000, suggested: 17100 },
      { product: 'lettuce', low: 16000, avg: 20000, high: 24000, suggested: 19000 },
      { product: 'cucumber', low: 18000, avg: 22000, high: 26000, suggested: 20900 },
      { product: 'avocado', low: 25000, avg: 32000, high: 39000, suggested: 30400 },
      { product: 'mango', low: 16000, avg: 20000, high: 24000, suggested: 19000 },
      { product: 'pineapple', low: 12000, avg: 15000, high: 18000, suggested: 14250 },
    ];

    for (const price of defaultPrices) {
      this.priceCache.set(price.product, {
        ...price,
        lastUpdated: new Date(),
      });
    }
  }

  /**
   * Get market prices for a product
   * @param product - The product name
   * @returns MarketPrice object or null if not found
   */
  async getPrice(product: string): Promise<MarketPrice | null> {
    const normalizedProduct = product.toLowerCase().trim();
    return this.priceCache.get(normalizedProduct) || null;
  }

  /**
   * Get all available product prices
   */
  async getAllPrices(): Promise<MarketPrice[]> {
    return Array.from(this.priceCache.values());
  }

  /**
   * Update price for a product (admin function)
   */
  async updatePrice(product: string, prices: Partial<MarketPrice>): Promise<MarketPrice> {
    const normalizedProduct = product.toLowerCase().trim();
    const existing = this.priceCache.get(normalizedProduct);

    if (existing) {
      const updated = { ...existing, ...prices, lastUpdated: new Date() };
      this.priceCache.set(normalizedProduct, updated);
      return updated;
    }

    // Create new price entry
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

  /**
   * Check if product prices exist
   */
  async hasPrice(product: string): Promise<boolean> {
    return this.priceCache.has(product.toLowerCase().trim());
  }

  /**
   * Get list of available products
   */
  async getAvailableProducts(): Promise<string[]> {
    return Array.from(this.priceCache.keys());
  }
}
