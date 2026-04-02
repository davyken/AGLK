import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../common/schemas/user.schema';
import { CreateUserDto, UpdateUserDto } from './dto';
import { EventBusService } from '../common/event-bus.service';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User.name) private userModel: Model<UserDocument>,
    private readonly eventBus: EventBusService,
  ) {}

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
  ): Promise<UserDocument> {
    const user = new this.userModel({
      phone,
      name: 'unknown',
      role: 'farmer',
      location: 'unknown',
      preferredChannel: channel,
      lastChannelUsed: channel,
      conversationState: 'AWAITING_ROLE',
    });
    const saved = await user.save();

    this.eventBus.emitUserCreated({
      phone: saved.phone,
      name: saved.name,
      role: saved.role,
      location: saved.location,
    });

    return saved;
  }

  async create(dto: CreateUserDto): Promise<UserDocument> {
    const user = new this.userModel({
      ...dto,
      conversationState: 'REGISTERED',
    });
    const saved = await user.save();

    this.eventBus.emitUserRegistered({
      phone: saved.phone,
      name: saved.name,
      role: saved.role,
      location: saved.location,
      produces: saved.produces,
      needs: saved.needs,
    });

    return saved;
  }

  async update(phone: string, dto: UpdateUserDto): Promise<UserDocument> {
    const user = await this.userModel
      .findOneAndUpdate({ phone }, { $set: dto }, { new: true })
      .exec();

    if (!user) throw new NotFoundException(`User ${phone} not found`);

    if (dto.conversationState === 'REGISTERED') {
      this.eventBus.emitUserRegistered({
        phone: user.phone,
        name: user.name,
        role: user.role,
        location: user.location,
        produces: user.produces,
        needs: user.needs,
      });
    }

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

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }

  async findByPhoneOrFail(phone: string): Promise<UserDocument> {
    const user = await this.findByPhone(phone);
    if (!user) throw new NotFoundException(`User ${phone} not found`);
    return user;
  }
}
