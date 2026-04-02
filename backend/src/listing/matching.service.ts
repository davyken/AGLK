import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Listing, ListingDocument } from '../common/schemas/listing.schema';

export interface MatchResult {
  listing: ListingDocument;
  matchScore: number;
  reason: string;
}

@Injectable()
export class MatchingService {
  constructor(
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
  ) {}

  async findMatches(
    listing: ListingDocument,
    limit: number = 5,
  ): Promise<MatchResult[]> {
    const matches: MatchResult[] = [];

    if (listing.type === 'sell') {
      const buyListings = await this.listingModel
        .find({
          type: 'buy',
          status: 'active',
          product: listing.product,
        })
        .exec();

      for (const buy of buyListings) {
        const score = this.calculateMatchScore(listing, buy);
        const reason = this.getMatchReason(listing, buy);
        matches.push({ listing: buy, matchScore: score, reason });
      }
    } else if (listing.type === 'buy') {
      const sellListings = await this.listingModel
        .find({
          type: 'sell',
          status: 'active',
          product: listing.product,
        })
        .exec();

      for (const sell of sellListings) {
        const score = this.calculateMatchScore(listing, sell);
        const reason = this.getMatchReason(listing, sell);
        matches.push({ listing: sell, matchScore: score, reason });
      }
    }

    matches.sort((a, b) => b.matchScore - a.matchScore);
    return matches.slice(0, limit);
  }

  private calculateMatchScore(
    listing1: ListingDocument,
    listing2: ListingDocument,
  ): number {
    let score = 0;

    if (listing1.product === listing2.product) {
      score += 50;
    }

    if (
      listing1.userLocation?.toLowerCase() ===
      listing2.userLocation?.toLowerCase()
    ) {
      score += 30;
    }

    const qtyRatio = listing1.quantity / listing2.quantity;
    if (qtyRatio >= 0.8 && qtyRatio <= 1.2) {
      score += 20;
    }

    return score;
  }

  private getMatchReason(
    listing1: ListingDocument,
    listing2: ListingDocument,
  ): string {
    const reasons: string[] = [];

    if (listing1.product === listing2.product) {
      reasons.push('Same product');
    }

    if (
      listing1.userLocation?.toLowerCase() ===
      listing2.userLocation?.toLowerCase()
    ) {
      reasons.push('Same location');
    }

    const qtyRatio = listing1.quantity / listing2.quantity;
    if (qtyRatio >= 0.8 && qtyRatio <= 1.2) {
      reasons.push('Similar quantity');
    }

    return reasons.length > 0 ? reasons.join(', ') : 'Potential match';
  }

  async hasMatches(listing: ListingDocument): Promise<boolean> {
    const matches = await this.findMatches(listing, 1);
    return matches.length > 0;
  }
}
