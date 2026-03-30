# Agro-Link Backend

> NestJS backend API for the WhatsApp-based agricultural marketplace MVP.

<p align="center">
  <img src="https://img.shields.io/badge/NestJS-v11.0.1-red" alt="NestJS">
  <img src="https://img.shields.io/badge/TypeScript-v5.7-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/MongoDB-v9.3-green" alt="MongoDB">
  <img src="https://img.shields.io/badge/Redis-v5.10-red" alt="Redis">
</p>

---

## Overview

This is the backend API service for Agro-Link, a WhatsApp-based agricultural marketplace that connects farmers directly with buyers. The backend is built with NestJS and provides RESTful APIs for product management, order processing, user authentication, and WhatsApp webhook integration.

---

## Tech Stack

- **Framework**: NestJS 11.x
- **Language**: TypeScript 5.7
- **Database**: MongoDB with Mongoose ODM
- **Cache**: Redis via ioredis
- **Authentication**: JWT (jsonwebtoken)
- **Password Hashing**: bcryptjs
- **API Validation**: express-validator
- **Security**: Helmet, CORS, Rate Limiting
- **Logging**: Winston
- **WhatsApp API**: Meta WhatsApp Cloud API

---

## Getting Started

### Prerequisites

- Node.js 18.x or higher
- MongoDB 6.x or higher
- Redis 7.x or higher

### Installation

```bash
npm install
```

### Configuration

Copy the example environment file and configure your settings:

```bash
cp .env.example .env
```

#### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3000` |
| `NODE_ENV` | Environment | `development` |
| `MONGODB_URI` | MongoDB connection string | - |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `META_PHONE_NUMBER_ID` | WhatsApp Phone Number ID | - |
| `META_ACCESS_TOKEN` | Meta API Access Token | - |
| `META_VERIFY_TOKEN` | Webhook verification token | - |
| `META_API_VERSION` | WhatsApp API version | `v19.0` |

### Running the Application

```bash
# Development
npm run start:dev

# Production
npm run start:prod

# Debug mode
npm run start:debug
```

---

## API Endpoints

### Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | User login |
| GET | `/auth/profile` | Get current user profile |

### Products

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/products` | List all products |
| POST | `/products` | Create a new product |
| GET | `/products/:id` | Get product by ID |
| PATCH | `/products/:id` | Update product |
| DELETE | `/products/:id` | Delete product |

### Orders

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orders` | List all orders |
| POST | `/orders` | Create a new order |
| GET | `/orders/:id` | Get order by ID |
| PATCH | `/orders/:id` | Update order status |

### Webhooks

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/webhook` | WhatsApp webhook verification |
| POST | `/webhook` | WhatsApp message webhook |

---

## Testing

```bash
# Unit tests
npm run test

# Watch mode
npm run test:watch

# Coverage
npm run test:cov

# E2E tests
npm run test:e2e
```

---

## Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile the application |
| `npm run start` | Start the production server |
| `npm run start:dev` | Start in development mode |
| `npm run start:debug` | Start in debug mode |
| `npm run start:prod` | Start production build |
| `npm run lint` | Lint and fix code |
| `npm run format` | Format code with Prettier |

---

## Project Structure

```
src/
├── main.ts                 # Application entry point
├── app.module.ts          # Root application module
├── app.controller.ts      # Root controller
├── app.service.ts         # Root service
├── auth/                  # Authentication module
├── products/              # Products module
├── orders/                # Orders module
├── webhook/               # WhatsApp webhook module
└── common/                # Shared utilities
```

---

## Security Features

- JWT-based authentication
- Password hashing with bcryptjs
- Rate limiting (express-rate-limit)
- Helmet.js for HTTP security headers
- CORS configuration
- Input validation and sanitization
- Environment variable protection

---

## License

MIT License - see LICENSE file for details.
