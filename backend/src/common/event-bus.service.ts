import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';

export interface UserCreatedEvent {
  phone: string;
  name: string;
  role: string;
  location: string;
}

export interface UserRegisteredEvent {
  phone: string;
  name: string;
  role: string;
  location: string;
  produces?: string[];
  needs?: string[];
}

export interface ListingCreatedEvent {
  listingId: string;
  type: 'sell' | 'buy';
  product: string;
  quantity: number;
  unit: string;
  userPhone: string;
  userName: string;
  userLocation: string;
  price?: number;
}

export interface ListingUpdatedEvent {
  listingId: string;
  status: string;
  product: string;
  userPhone: string;
}

@Injectable()
export class EventBusService {
  constructor(private readonly eventEmitter: EventEmitter2) {}

  emitUserCreated(payload: UserCreatedEvent): void {
    this.eventEmitter.emit('user.created', payload);
  }

  emitUserRegistered(payload: UserRegisteredEvent): void {
    this.eventEmitter.emit('user.registered', payload);
  }

  emitListingCreated(payload: ListingCreatedEvent): void {
    this.eventEmitter.emit('listing.created', payload);
  }

  emitListingUpdated(payload: ListingUpdatedEvent): void {
    this.eventEmitter.emit('listing.updated', payload);
  }
}
