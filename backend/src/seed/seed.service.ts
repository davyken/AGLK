import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcryptjs';
import { User, UserDocument } from '../common/schemas/user.schema';

@Injectable()
export class SeedService implements OnModuleInit {
  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async onModuleInit() {
    await this.seedAdmin();
  }

  async seedAdmin() {
    const adminPhone = '15551661836';
    const existingAdmin = await this.userModel.findOne({ phone: adminPhone, role: 'admin' });

    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      await this.userModel.create({
        phone: adminPhone,
        name: 'Admin',
        username: 'admin',
        role: 'admin',
        location: 'Admin',
        password: hashedPassword,
        preferredChannel: 'whatsapp',
        language: 'english',
        lastChannelUsed: 'whatsapp',
        trustScore: 100,
        isBanned: false,
        produces: [],
        needs: [],
        businessName: 'AGLK',
        conversationState: 'REGISTERED',
      });
      console.log('Admin user created: phone=15551661836, password=admin123');
    }
  }
}