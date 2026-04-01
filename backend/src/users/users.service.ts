import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../schemas/user.schema';
import { CreateUserDto, UpdateUserDto } from '../dto/user.dto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
  ) {}

  // ─── Find by phone (main lookup throughout the app) ──────
  async findByPhone(phone: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phone }).exec();
  }

  // ─── Check if user exists ─────────────────────────────────
  async exists(phone: string): Promise<boolean> {
    const user = await this.userModel.findOne({ phone }).select('_id').exec();
    return !!user;
  }

  // ─── Create stub on first contact ────────────────────────
  // Called the moment a new user says "Hi" for the first time
  // Saves state to DB immediately so Render restarts don't lose progress
  async createStub(
    phone: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<UserDocument> {
    const user = new this.userModel({
      phone,
      name: 'unknown',         // overwritten in step 2
      role: 'farmer',          // overwritten in step 1
      location: 'unknown',     // overwritten in step 3
      preferredChannel: channel,
      lastChannelUsed: channel,
      conversationState: 'AWAITING_ROLE',
    });
    return user.save();
  }

  // ─── Create fully registered user ────────────────────────
  async create(dto: CreateUserDto): Promise<UserDocument> {
    const user = new this.userModel({
      ...dto,
      conversationState: 'REGISTERED',
    });
    return user.save();
  }

  // ─── Update user fields ───────────────────────────────────
  async update(phone: string, dto: UpdateUserDto): Promise<UserDocument> {
    const user = await this.userModel
      .findOneAndUpdate({ phone }, { $set: dto }, { new: true })
      .exec();

    if (!user) throw new NotFoundException(`User ${phone} not found`);
    return user;
  }

  // ─── Update only conversationState (used by bot) ─────────
  async updateState(phone: string, state: string): Promise<void> {
    await this.userModel
      .findOneAndUpdate({ phone }, { $set: { conversationState: state } })
      .exec();
  }

  // ─── Update last channel used ─────────────────────────────
  async updateChannel(
    phone: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<void> {
    await this.userModel
      .findOneAndUpdate({ phone }, { $set: { lastChannelUsed: channel } })
      .exec();
  }

  // ─── Get all users (admin / debug) ───────────────────────
  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }

  // ─── Get user or throw ────────────────────────────────────
  async findByPhoneOrFail(phone: string): Promise<UserDocument> {
    const user = await this.findByPhone(phone);
    if (!user) throw new NotFoundException(`User ${phone} not found`);
    return user;
  }
}