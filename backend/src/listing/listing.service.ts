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
    userData: { phone: string; name: string; location: string; channel: string },
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
}
