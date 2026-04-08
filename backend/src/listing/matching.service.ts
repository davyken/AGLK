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

  // ─── Find best matches for a listing ─────────────────────
  async findMatches(
    listing: ListingDocument,
    limit = 5,
  ): Promise<MatchResult[]> {
    const oppositeType = listing.type === 'sell' ? 'buy' : 'sell';

    const candidates = await this.listingModel
      .find({
        type: oppositeType,
        status: 'active',
        product: listing.product, // must be same product
      })
      .exec();

    const matches: MatchResult[] = candidates.map((candidate) => ({
      listing: candidate,
      matchScore: this.calculateMatchScore(listing, candidate),
      reason: this.getMatchReason(listing, candidate),
    }));

    // Sort by score descending, return top N
    return matches
      .filter((m) => m.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, limit);
  }

  // ─── Score a pair of listings ─────────────────────────────
  // Max score: 100
  //   Product match:   50 pts (guaranteed — we query by product)
  //   Same location:   30 pts
  //   Quantity match:  20 pts
  private calculateMatchScore(a: ListingDocument, b: ListingDocument): number {
    let score = 50; // product always matches (filtered in query)

    // Location match (+30)
    if (
      a.userLocation?.trim().toLowerCase() ===
      b.userLocation?.trim().toLowerCase()
    ) {
      score += 30;
    }

    // Quantity proximity (+20)
    // Full score if within 20% of each other
    if (a.quantity > 0 && b.quantity > 0) {
      const ratio =
        Math.min(a.quantity, b.quantity) / Math.max(a.quantity, b.quantity);
      if (ratio >= 0.8) score += 20;
      else if (ratio >= 0.5) score += 10;
    }

    return score;
  }

  // ─── Human readable match reason ─────────────────────────
  private getMatchReason(a: ListingDocument, b: ListingDocument): string {
    const reasons: string[] = ['Same product'];

    if (
      a.userLocation?.trim().toLowerCase() ===
      b.userLocation?.trim().toLowerCase()
    ) {
      reasons.push('Same location');
    }

    if (a.quantity > 0 && b.quantity > 0) {
      const ratio =
        Math.min(a.quantity, b.quantity) / Math.max(a.quantity, b.quantity);
      if (ratio >= 0.8) reasons.push('Similar quantity');
    }

    return reasons.join(', ');
  }

  // ─── Quick check: does any match exist? ──────────────────
  async hasMatches(listing: ListingDocument): Promise<boolean> {
    const matches = await this.findMatches(listing, 1);
    return matches.length > 0;
  }

  // ─── Called when new listing is created ──────────────────
  // Returns matches to notify immediately
  async onNewListing(listing: ListingDocument): Promise<MatchResult[]> {
    return this.findMatches(listing, 5);
  }
}
