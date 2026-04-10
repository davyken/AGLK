import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Listing, ListingDocument } from '../common/schemas/listing.schema';
import { CreateListingDto, UpdateListingDto } from './dto';
import { EventBusService } from '../common/event-bus.service';

@Injectable()
export class ListingService {
  constructor(
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
    private readonly eventBus: EventBusService,
  ) {}

  async create(dto: CreateListingDto, phone: string): Promise<ListingDocument> {
    const listing = new this.listingModel({
      ...dto,
      userPhone: phone,
      userName: dto.location ? '' : '',
      userLocation: dto.location || '',
      location: dto.location || '',
      channel: 'whatsapp',
    });
    const saved = await listing.save();

    this.eventBus.emitListingCreated({
      listingId: (saved._id as any).toString(),
      type: saved.type as 'sell' | 'buy',
      product: saved.product,
      quantity: saved.quantity,
      unit: saved.unit,
      userPhone: saved.userPhone,
      userName: saved.userName,
      userLocation: saved.userLocation,
      price: saved.price || undefined,
    });

    return saved;
  }

  async createEnriched(
    dto: CreateListingDto,
    userData: {
      phone: string;
      name: string;
      location: string;
      channel: string;
    },
  ): Promise<ListingDocument> {
    const listing = new this.listingModel({
      ...dto,
      userPhone: userData.phone,
      userName: userData.name,
      userLocation: userData.location,
      channel: userData.channel,
      location: dto.location || userData.location,
    });
    const saved = await listing.save();

    this.eventBus.emitListingCreated({
      listingId: (saved._id as any).toString(),
      type: saved.type as 'sell' | 'buy',
      product: saved.product,
      quantity: saved.quantity,
      unit: saved.unit,
      userPhone: saved.userPhone,
      userName: saved.userName,
      userLocation: saved.userLocation,
      price: saved.price || undefined,
    });

    return saved;
  }

  async findAll(): Promise<ListingDocument[]> {
    return this.listingModel.find().exec();
  }

  async findOne(id: string): Promise<ListingDocument> {
    const listing = await this.listingModel.findById(id).exec();
    if (!listing) {
      throw new NotFoundException(`Listing with ID ${id} not found`);
    }
    return listing;
  }

  async update(id: string, dto: UpdateListingDto): Promise<ListingDocument> {
    const listing = await this.listingModel
      .findByIdAndUpdate(id, { $set: dto }, { returnDocument: 'after' })
      .exec();

    if (!listing) {
      throw new NotFoundException(`Listing with ID ${id} not found`);
    }

    if (dto.status) {
      this.eventBus.emitListingUpdated({
        listingId: id,
        status: dto.status,
        product: listing.product,
        userPhone: listing.userPhone,
      });
    }

    return listing;
  }

  async remove(id: string): Promise<ListingDocument> {
    const listing = await this.listingModel
      .findByIdAndUpdate(
        id,
        { $set: { status: 'cancelled' } },
        { returnDocument: 'after' },
      )
      .exec();

    if (!listing) {
      throw new NotFoundException(`Listing with ID ${id} not found`);
    }

    this.eventBus.emitListingUpdated({
      listingId: id,
      status: 'cancelled',
      product: listing.product,
      userPhone: listing.userPhone,
    });

    return listing;
  }

  async findByUserPhone(phone: string): Promise<ListingDocument[]> {
    return this.listingModel.find({ userPhone: phone }).exec();
  }

  async findByProduct(product: string): Promise<ListingDocument[]> {
    return this.listingModel
      .find({
        product: { $regex: new RegExp(`^${this.escapeRegex(product)}$`, 'i') },
        status: 'active',
      })
      .exec();
  }

  async findByType(type: 'sell' | 'buy'): Promise<ListingDocument[]> {
    return this.listingModel.find({ type, status: 'active' }).exec();
  }

  async findByLocation(location: string): Promise<ListingDocument[]> {
    const regex = new RegExp(`^${this.escapeRegex(location)}$`, 'i');
    return this.listingModel
      .find({
        $or: [{ location: regex }, { userLocation: regex }],
        status: 'active',
      })
      .exec();
  }

  async findByProductAndLocation(
    product: string,
    location: string,
  ): Promise<ListingDocument[]> {
    const productRegex = new RegExp(`^${this.escapeRegex(product)}$`, 'i');
    const locationRegex = new RegExp(`^${this.escapeRegex(location)}$`, 'i');
    return this.listingModel
      .find({
        product: productRegex,
        $or: [{ location: locationRegex }, { userLocation: locationRegex }],
        status: 'active',
      })
      .exec();
  }

  /**
   * Search for sell listings with a product synonym fallback.
   * Returns any active listing whose product matches one of the known synonyms.
   */
  async findByProductSynonyms(product: string): Promise<ListingDocument[]> {
    const synonyms = this.getSynonyms(product);
    if (synonyms.length === 0) return [];
    const regexes = synonyms.map(
      (s) => new RegExp(`^${this.escapeRegex(s)}$`, 'i'),
    );
    return this.listingModel
      .find({ product: { $in: regexes }, type: 'sell', status: 'active' })
      .sort({ createdAt: -1 })
      .exec();
  }

  /**
   * Four-tier fallback search for buy requests:
   *  Tier 1 — exact product + exact location
   *  Tier 2 — exact product + any location (nationwide)
   *  Tier 3 — synonym products + any location
   *  Tier 4 — empty (no matches anywhere)
   *
   * The `excludePhone` prevents returning the buyer's own listings.
   */
  async findWithFallback(
    product: string,
    location: string,
    excludePhone: string,
  ): Promise<{
    tier: 1 | 2 | 3 | 4;
    listings: ListingDocument[];
    fallbackProduct?: string;
  }> {
    const ownFilter = (docs: ListingDocument[]) =>
      docs.filter(
        (l) =>
          l.type === 'sell' &&
          l.status === 'active' &&
          l.userPhone !== excludePhone,
      );

    // Tier 1 — exact + location
    if (location && location !== 'unknown') {
      const t1 = ownFilter(await this.findByProductAndLocation(product, location));
      if (t1.length > 0) return { tier: 1, listings: t1 };
    }

    // Tier 2 — exact + nationwide
    const t2 = ownFilter(await this.findByProduct(product));
    if (t2.length > 0) return { tier: 2, listings: t2 };

    // Tier 3 — synonyms + nationwide
    const synonymDocs = ownFilter(await this.findByProductSynonyms(product));
    if (synonymDocs.length > 0) {
      // Determine which synonym actually matched
      const matchedProduct = synonymDocs[0].product;
      return { tier: 3, listings: synonymDocs, fallbackProduct: matchedProduct };
    }

    // Tier 4 — nothing found
    return { tier: 4, listings: [] };
  }

  // ─── Product synonym map ───────────────────────────────────────
  private getSynonyms(product: string): string[] {
    const SYNONYMS: Record<string, string[]> = {
      maize: ['corn', 'mais', 'grain'],
      corn: ['maize', 'mais'],
      mais: ['maize', 'corn'],
      cassava: ['manioc', 'tapioca'],
      manioc: ['cassava'],
      tomatoes: ['tomato', 'tomate', 'tomates'],
      tomato: ['tomatoes', 'tomate'],
      tomate: ['tomatoes', 'tomato'],
      groundnuts: ['peanuts', 'arachide', 'arachides'],
      peanuts: ['groundnuts', 'arachide'],
      arachide: ['groundnuts', 'peanuts'],
      yam: ['igname', 'ignames'],
      igname: ['yam'],
      plantain: ['banana', 'plantains'],
      banana: ['plantain'],
      pepper: ['piment', 'piments', 'peppers'],
      piment: ['pepper', 'peppers'],
      beans: ['haricot', 'haricots'],
      haricot: ['beans'],
      okra: ['gombo'],
      gombo: ['okra'],
      cabbage: ['chou', 'choux'],
      chou: ['cabbage'],
      onion: ['oignon', 'oignons', 'onions'],
      oignon: ['onion', 'onions'],
      garlic: ['ail'],
      ail: ['garlic'],
      cucumber: ['concombre', 'concombres'],
      concombre: ['cucumber'],
      eggplant: ['aubergine', 'aubergines'],
      aubergine: ['eggplant'],
    };
    return SYNONYMS[product.toLowerCase()] ?? [];
  }

  async findWithFilters(
    product: string,
    options: {
      location?: string;
      minPrice?: number;
      maxPrice?: number;
      type?: 'sell' | 'buy';
    },
  ): Promise<ListingDocument[]> {
    const query: any = {
      product: { $regex: new RegExp(`^${this.escapeRegex(product)}$`, 'i') },
      status: 'active',
    };

    if (options.type) {
      query.type = options.type;
    }

    if (options.location) {
      const locationRegex = new RegExp(this.escapeRegex(options.location), 'i');
      query.$or = [
        { location: locationRegex },
        { userLocation: locationRegex },
      ];
    }

    if (options.minPrice !== undefined || options.maxPrice !== undefined) {
      query.price = {};
      if (options.minPrice !== undefined) {
        query.price.$gte = options.minPrice;
      }
      if (options.maxPrice !== undefined) {
        query.price.$lte = options.maxPrice;
      }
    }

    return this.listingModel.find(query).exec();
  }

  async findActiveListings(): Promise<ListingDocument[]> {
    return this.listingModel.find({ status: 'active' }).exec();
  }

  async exists(id: string): Promise<boolean> {
    const listing = await this.listingModel.findById(id).select('_id').exec();
    return !!listing;
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ─── Update listing status ─────────────────────────────────
  async updateStatus(id: string, status: string): Promise<ListingDocument> {
    const listing = await this.listingModel
      .findByIdAndUpdate(id, { $set: { status } }, { returnDocument: 'after' })
      .exec();

    if (!listing) {
      throw new NotFoundException(`Listing with ID ${id} not found`);
    }

    this.eventBus.emitListingUpdated({
      listingId: id,
      status: status,
      product: listing.product,
      userPhone: listing.userPhone,
    });

    return listing;
  }
}
