import {
  Injectable,
  UnauthorizedException,
  ConflictException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../common/schemas/user.schema';
import { RegisterDto, LoginDto } from './dto';

@Injectable()
export class AuthService {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async register(dto: RegisterDto) {
    const { fullName, username, phone, password } = dto;

    // Check if phone exists
    const existing = await this.userModel.findOne({ phone });
    if (existing) {
      throw new ConflictException('Phone number already registered');
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user - username becomes the name
    const user = await this.userModel.create({
      phone,
      name: fullName || username,
      username,
      role: 'farmer', // default for admin dashboard users
      location: '',
      password: hashedPassword,
      preferredChannel: 'whatsapp',
      language: 'english',
      lastChannelUsed: 'whatsapp',
      trustScore: 0,
      isBanned: false,
      produces: [],
      needs: [],
      businessName: '',
      conversationState: 'REGISTERED',
    });

    return {
      success: true,
      data: {
        id: user._id,
        phone: user.phone,
        name: user.name,
        username: user.username,
      },
    };
  }

  async login(dto: LoginDto) {
    const { phone, password } = dto;

    const user = await this.userModel.findOne({ phone });
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isValid = await bcrypt.compare(password, user.password || '');
    if (!isValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.isBanned) {
      throw new UnauthorizedException('Account is banned');
    }

    return {
      success: true,
      data: {
        id: user._id,
        phone: user.phone,
        name: user.name,
        username: user.username,
        role: user.role,
      },
    };
  }
}
