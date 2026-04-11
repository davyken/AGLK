import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../common/schemas/user.schema';
import { CreateUserDto, UpdateUserDto } from '../users/dto';

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async findByPhone(phone: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ phone }).exec();
  }

  async exists(phone: string): Promise<boolean> {
    const user = await this.userModel.findOne({ phone }).select('_id').exec();
    return !!user;
  }

  async createStub(
    phone: string,
    channel: 'sms' | 'whatsapp',
    language: 'english' | 'french' | 'pidgin' = 'english',
  ): Promise<UserDocument> {
    const user = new this.userModel({
      phone,
      name: 'unknown',
      role: 'user',
      location: 'unknown',
      preferredChannel: channel,
      lastChannelUsed: channel,
      language,
      conversationState: 'AWAITING_NAME',
    });
    return user.save();
  }

  async create(dto: CreateUserDto): Promise<UserDocument> {
    const user = new this.userModel({
      ...dto,
      conversationState: 'REGISTERED',
    });
    return user.save();
  }

  async update(phone: string, dto: UpdateUserDto): Promise<UserDocument> {
    const user = await this.userModel
      .findOneAndUpdate({ phone }, { $set: dto }, { new: true })
      .exec();

    if (!user) throw new NotFoundException(`User ${phone} not found`);
    return user;
  }

  async updateState(phone: string, state: string): Promise<void> {
    await this.userModel
      .findOneAndUpdate({ phone }, { $set: { conversationState: state } })
      .exec();
  }

  async updateChannel(
    phone: string,
    channel: 'sms' | 'whatsapp',
  ): Promise<void> {
    await this.userModel
      .findOneAndUpdate({ phone }, { $set: { lastChannelUsed: channel } })
      .exec();
  }

  async updateLanguage(
    phone: string,
    language: 'english' | 'french' | 'pidgin',
  ): Promise<void> {
    await this.userModel
      .findOneAndUpdate({ phone }, { $set: { language } })
      .exec();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }

  async findByPhoneOrFail(phone: string): Promise<UserDocument> {
    const user = await this.findByPhone(phone);
    if (!user) throw new NotFoundException(`User ${phone} not found`);
    return user;
  }

  async toggleBan(phone: string, banned: boolean): Promise<UserDocument> {
    const user = await this.userModel
      .findOneAndUpdate(
        { phone },
        { $set: { isBanned: banned } },
        { new: true },
      )
      .exec();

    if (!user) throw new NotFoundException(`User ${phone} not found`);
    return user;
  }

  async updateTrustScore(phone: string, score: number): Promise<UserDocument> {
    const user = await this.userModel
      .findOneAndUpdate(
        { phone },
        { $set: { trustScore: score } },
        { new: true },
      )
      .exec();

    if (!user) throw new NotFoundException(`User ${phone} not found`);
    return user;
  }

  async delete(phone: string): Promise<UserDocument> {
    const user = await this.userModel.findOneAndDelete({ phone }).exec();

    if (!user) throw new NotFoundException(`User ${phone} not found`);
    return user;
  }

  async savePendingState(
    phone: string,
    state: Record<string, any>,
  ): Promise<void> {
    await this.userModel
      .findOneAndUpdate({ phone }, { $set: { pendingState: state } })
      .exec();
  }

  async clearPendingState(phone: string): Promise<void> {
    await this.userModel
      .findOneAndUpdate({ phone }, { $set: { pendingState: null } })
      .exec();
  }

  async savePendingFarmerResponse(
    phone: string,
    response: Record<string, any>,
  ): Promise<void> {
    await this.userModel
      .findOneAndUpdate(
        { phone },
        { $set: { pendingFarmerResponse: response } },
      )
      .exec();
  }

  async clearPendingFarmerResponse(phone: string): Promise<void> {
    await this.userModel
      .findOneAndUpdate({ phone }, { $set: { pendingFarmerResponse: null } })
      .exec();
  }

  async findUsersWithPendingData(): Promise<UserDocument[]> {
    return this.userModel
      .find({
        $or: [
          { pendingState: { $ne: null } },
          { pendingFarmerResponse: { $ne: null } },
        ],
      })
      .exec();
  }
}