import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { BotModule } from './bot/bot.module';
import { UsersModule } from './users/users.module';
import { ListingModule } from './listing/listing.module';
import { AiModule } from './ai/ai.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { NotificationModule } from './notification/notification.module';
import { PriceModule } from './price/price.module';
import { SeedModule } from './seed/seed.module';
import { EventBusService } from './common/event-bus.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    EventEmitterModule.forRoot(),

    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        uri:
          configService.get<string>('MONGODB_URI') ??
          'mongodb://localhost:27017/app',
      }),
      inject: [ConfigService],
    }),

    AiModule,
    WhatsappModule,
    UsersModule,
    ListingModule,
    PriceModule,
    BotModule,
    NotificationModule,
    SeedModule,
  ],
  controllers: [AppController],
  providers: [AppService, EventBusService],
})
export class AppModule {}
