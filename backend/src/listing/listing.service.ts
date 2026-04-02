import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Listing, ListingDocument } from '../schemas/listing.schema';
import { CreateListingDto, UpdateListingDto } from '../dto/listing.dto';
import { UsersService } from '../users/users.service';

@Injectable()
export class ListingService {
  constructor(
    @InjectModel(Listing.name) private listingModel: Model<ListingDocument>,
    private usersService: UsersService,
  ) {}

  // Create a new listing - basically save a new listing to the database
  async create(dto: CreateListingDto, phone: string): Promise<ListingDocument> {
    // Fetch user from database to get their details
    const user = await this.usersService.findByPhoneOrFail(phone);

    // Create listing with user data from user table
    const listing = new this.listingModel({
      ...dto,
      userPhone: user.phone,
      userName: user.name,
      userLocation: user.location,
      channel: user.lastChannelUsed,
      // Use user's location if not provided in DTO
      location: dto.location || user.location,
    });
    return listing.save();
  }

  // Get all listings
  async findAll(): Promise<ListingDocument[]> {
    return this.listingModel.find().exec();
  }

  // Get one listing by ID
  async findOne(id: string): Promise<ListingDocument> {
    // Try to find the listing
    const listing = await this.listingModel.findById(id).exec();

    // If not found then throw error
    if (!listing) {
      throw new NotFoundException(`Listing with ID ${id} not found`);
    }

    return listing;
  }

  // Update a listing - can change price, quantity, status etc
  async update(id: string, dto: UpdateListingDto): Promise<ListingDocument> {
    // Find and update in one go, return the updated version
    const listing = await this.listingModel
      .findByIdAndUpdate(id, { $set: dto }, { returnDocument: 'after' })
      .exec();

    // If not found then throw error
    if (!listing) {
      throw new NotFoundException(`Listing with ID ${id} not found`);
    }

    return listing;
  }

  // Delete a listing - actually we just mark it as cancelled
  // This is a soft delete so we dont lose history
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

    return listing;
  }

  // Get all listings for a specific user - useful for user dashboard
  async findByUserPhone(phone: string): Promise<ListingDocument[]> {
    return this.listingModel.find({ userPhone: phone }).exec();
  }

  // Find active listings by product - for searching/filtering
  async findByProduct(product: string): Promise<ListingDocument[]> {
    return this.listingModel
      .find({
        product: { $regex: new RegExp(`^${this.escapeRegex(product)}$`, 'i') },
        status: 'active',
      })
      .exec();
  }

  // Find active listings by type (sell or buy) - for matching
  async findByType(type: 'sell' | 'buy'): Promise<ListingDocument[]> {
    return this.listingModel.find({ type, status: 'active' }).exec();
  }

  // Find active listings by location - for local matching
  async findByLocation(location: string): Promise<ListingDocument[]> {
    const regex = new RegExp(`^${this.escapeRegex(location)}$`, 'i');
    return this.listingModel
      .find({
        $or: [{ location: regex }, { userLocation: regex }],
        status: 'active',
      })
      .exec();
  }

  // Advanced search - find listings matching product and location
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

  // Advanced search with filters - product, location, and price range
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

  // Find all active listings - maybe for the main feed
  async findActiveListings(): Promise<ListingDocument[]> {
    return this.listingModel.find({ status: 'active' }).exec();
  }

  // Check if listing exists - helper for validation
  async exists(id: string): Promise<boolean> {
    const listing = await this.listingModel.findById(id).select('_id').exec();
    return !!listing;
  }

  // Escape special regex characters
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
