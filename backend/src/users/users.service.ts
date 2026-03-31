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

  // ─── Create new user ──────────────────────────────────────
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