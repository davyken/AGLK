import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Listing, ListingDocument } from '../common/schemas/listing.schema';
import {
  PriceHistory,
  PriceHistoryDocument,
} from '../common/schemas/price-history.schema';

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
  constructor(
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
    @InjectModel(PriceHistory.name)
    private priceHistoryModel: Model<PriceHistoryDocument>,
  ) {}

  async getPrice(product: string): Promise<MarketPrice | null> {
    const normalizedProduct = product.toLowerCase().trim();

    const priceDoc = await this.priceHistoryModel
      .findOne({
        product: normalizedProduct,
      })
      .exec();

    if (!priceDoc) {
      return null;
    }

    return {
      product: priceDoc.product,
      low: priceDoc.minPrice,
      avg: priceDoc.avgPrice,
      high: priceDoc.maxPrice,
      suggested: priceDoc.suggestedPrice,
      lastUpdated: priceDoc.updatedAt,
    };
  }

  async getAllPrices(): Promise<MarketPrice[]> {
    const prices = await this.priceHistoryModel.find().exec();

    return prices.map((priceDoc) => ({
      product: priceDoc.product,
      low: priceDoc.minPrice,
      avg: priceDoc.avgPrice,
      high: priceDoc.maxPrice,
      suggested: priceDoc.suggestedPrice,
      lastUpdated: priceDoc.updatedAt,
    }));
  }

  async recalculatePrice(
    product: string,
    location?: string,
  ): Promise<MarketPrice | null> {
    const normalizedProduct = product.toLowerCase().trim();
    const normalizedLocation = location?.toLowerCase().trim();

    const query: any = {
      product: normalizedProduct,
      status: 'active',
      price: { $exists: true, $ne: null },
    };

    if (normalizedLocation) {
      query.$or = [
        { location: normalizedLocation },
        { userLocation: normalizedLocation },
      ];
    }

    const listings = await this.listingModel.find(query).exec();

    if (listings.length === 0) {
      if (normalizedLocation) {
        await this.priceHistoryModel
          .findOneAndDelete({
            product: normalizedProduct,
            location: normalizedLocation,
          })
          .exec();
      } else {
        await this.priceHistoryModel
          .findOneAndDelete({
            product: normalizedProduct,
          })
          .exec();
      }
      return null;
    }

    const prices = listings
      .map((l) => l.price)
      .filter((p) => typeof p === 'number' && p > 0);

    if (prices.length === 0) {
      return null;
    }

    const sortedPrices = [...prices].sort((a, b) => a - b);
    const min = sortedPrices[0];
    const max = sortedPrices[sortedPrices.length - 1];
    const sum = sortedPrices.reduce((a, b) => a + b, 0);
    const avg = sum / sortedPrices.length;
    const suggested = Math.round(avg * 0.95);

    const update: any = {
      product: normalizedProduct,
      location: normalizedLocation || '',
      avgPrice: Math.round(avg),
      minPrice: min,
      maxPrice: max,
      suggestedPrice: suggested,
      sampleSize: prices.length,
      source: 'transaction',
      updatedAt: new Date(),
    };

    const options = normalizedLocation
      ? { upsert: true, new: true, setDefaultsOnInsert: true }
      : { upsert: true, new: true, setDefaultsOnInsert: true };

    const priceDoc = await this.priceHistoryModel
      .findOneAndUpdate(
        normalizedLocation
          ? { product: normalizedProduct, location: normalizedLocation }
          : { product: normalizedProduct },
        { $set: update },
        options,
      )
      .exec();

    return {
      product: priceDoc!.product,
      low: priceDoc!.minPrice,
      avg: priceDoc!.avgPrice,
      high: priceDoc!.maxPrice,
      suggested: priceDoc!.suggestedPrice,
      lastUpdated: priceDoc!.updatedAt,
    };
  }

  async hasPrice(product: string): Promise<boolean> {
    const normalizedProduct = product.toLowerCase().trim();
    const priceDoc = await this.priceHistoryModel
      .findOne({
        product: normalizedProduct,
      })
      .exec();
    return !!priceDoc;
  }

  async getAvailableProducts(): Promise<string[]> {
    const products = await this.priceHistoryModel.distinct('product').exec();
    return products.map((p) => p.toString());
  }

  async deletePrice(product: string, location?: string): Promise<void> {
    const normalizedProduct = product.toLowerCase().trim();
    const normalizedLocation = location?.toLowerCase().trim();

    const query: any = { product: normalizedProduct };
    if (normalizedLocation) {
      query.location = normalizedLocation;
    }

    await this.priceHistoryModel.deleteMany(query).exec();
  }
}
