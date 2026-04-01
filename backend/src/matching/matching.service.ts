import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Listing, ListingDocument } from '../schemas/listing.schema';

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

  /**
   * Story 10: Match Supply & Demand
   * Find matching listings for a given product listing
   */
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

        matches.push({
          listing: buy,
          matchScore: score,
          reason,
        });
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

        matches.push({
          listing: sell,
          matchScore: score,
          reason,
        });
      }
    }

    matches.sort((a, b) => b.matchScore - a.matchScore);

    return matches.slice(0, limit);
  }

  /**
   * Calculate match score based on multiple factors
   */
  private calculateMatchScore(
    listing1: ListingDocument,
    listing2: ListingDocument,
  ): number {
    let score = 0;

    // Same product = 50 points
    if (listing1.product === listing2.product) {
      score += 50;
    }

    // Same location = 30 points
    if (
      listing1.userLocation?.toLowerCase() ===
      listing2.userLocation?.toLowerCase()
    ) {
      score += 30;
    }

    // Quantity match (within 20% range) = 20 points
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

  /**
   * Check if there are any matches for a listing
   */
  async hasMatches(listing: ListingDocument): Promise<boolean> {
    const matches = await this.findMatches(listing, 1);
    return matches.length > 0;
  }
}
