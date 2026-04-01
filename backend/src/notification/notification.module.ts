import { Module } from '@nestjs/common';
import { NotificationService } from './notification.service';
import { UsersModule } from '../users/users.module';
import { ListingModule } from '../listing/listing.module';
import { MatchingModule } from '../matching/matching.module';
import { BotModule } from '../bot/bot.module';

@Module({
  imports: [UsersModule, ListingModule, MatchingModule, BotModule],
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
