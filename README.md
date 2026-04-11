# Agro-Link (AGLK)

> WhatsApp/SMS-based agricultural marketplace MVP — connecting farmers directly with buyers through the world's most popular messaging platform.

<p align="center"> 
  <img src="https://img.shields.io/badge/NestJS-v11.0.1-red" alt="NestJS">
  <img src="https://img.shields.io/badge/TypeScript-v5.7-blue" alt="TypeScript">
  <img src="https://img.shields.io/badge/MongoDB-v9.3-green" alt="MongoDB">
  <img src="https://img.shields.io/badge/Redis-v5.10-red" alt="Redis">
  <img src="https://img.shields.io/badge/License-MIT-yellow" alt="License">
</p>
---
## 📋 Overview
 
Agro-Link is a Minimum Viable Product (MVP) that enables farmers to sell their agricultural products directly to buyers via WhatsApp. The platform leverages the Meta WhatsApp Cloud API to facilitate seamless communication between farmers and customers, eliminating intermediaries and ensuring fair pricing for both parties.

### Key Features

- **WhatsApp Integration** — Direct communication between farmers and buyers through WhatsApp
- **Product Management** — Farmers can list, update, and manage their agricultural products
- **Order Handling** — Streamlined order processing and tracking
- **User Authentication** — Secure JWT-based authentication system
- **Rate Limiting** — API protection against abuse
- **Natural Language Processing** — Smart product categorization using NLP

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (TBD)                       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Backend API                         │
│                     (NestJS + TypeScript)                   │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │ MongoDB  │   │  Redis   │   │  WhatsApp │
        │ Database │   │   Cache   │   │   Cloud   │
        └──────────┘   └──────────┘   └──────────┘
```

### Tech Stack

| Category | Technology |
|----------|------------|
| **Framework** | NestJS 11.x |
| **Language** | TypeScript 5.7 |
| **Database** | MongoDB (Mongoose) |
| **Cache** | Redis (ioredis) |
| **Authentication** | JWT + bcryptjs |
| **WhatsApp API** | Meta WhatsApp Cloud API |
| **NLP** | Natural + Compromise |
| **Logging** | Winston |
| **Validation** | express-validator |

---

## 🚀 Getting Started

### Prerequisites

- Node.js 18.x or higher
- MongoDB 6.x or higher
- Redis 7.x or higher
- npm or pnpm

### Installation

```bash
# Install dependencies
npm install
```

### Configuration

1. Copy the environment example file:

```bash
cp .env.example .env
```

2. Configure the following variables in `.env`:

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port (default: 3000) | ✓ |
| `NODE_ENV` | Environment (development/production) | ✓ |
| `MONGODB_URI` | MongoDB connection string | ✓ |
| `REDIS_URL` | Redis connection URL | ✓ |
| `META_PHONE_NUMBER_ID` | WhatsApp Phone Number ID | ✓ |
| `META_ACCESS_TOKEN` | Meta API Access Token | ✓ |
| `META_VERIFY_TOKEN` | Webhook verification token | ✓ |
| `META_API_VERSION` | WhatsApp API version | ✓ |

### Running the Application

```bash
# Development mode with hot reload
npm run start:dev

# Production mode
npm run start:prod

# Debug mode
npm run start:debug
```

---

## 📖 API Documentation

### Authentication Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/auth/register` | Register a new user |
| POST | `/auth/login` | User login |
| GET | `/auth/profile` | Get current user profile |

### Product Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/products` | List all products |
| POST | `/products` | Create a new product |
| GET | `/products/:id` | Get product by ID |
| PATCH | `/products/:id` | Update product |
| DELETE | `/products/:id` | Delete product |

### Order Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/orders` | List all orders |
| POST | `/orders` | Create a new order |
| GET | `/orders/:id` | Get order by ID |
| PATCH | `/orders/:id` | Update order status |

### Webhook Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/webhook` | WhatsApp webhook verification |
| POST | `/webhook` | WhatsApp message webhook |

---

## 🧪 Testing

```bash
# Run unit tests
npm run test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:cov

# Run e2e tests
npm run test:e2e
```

---

---

## 🔧 Available Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to JavaScript |
| `npm run start` | Start the production server |
| `npm run start:dev` | Start in development mode with hot reload |
| `npm run start:debug` | Start in debug mode |
| `npm run start:prod` | Start the compiled production build |
| `npm run lint` | Lint and fix code |
| `npm run format` | Format code with Prettier |
| `npm run test` | Run unit tests |
| `npm run test:cov` | Run tests with coverage report |

## ☁️ Deployment on Render

1. Connect your GitHub repo to Render.
2. Create a **Web Service** pointing to the `/backend` directory.
3. Set **Build Command**: `npm ci && npm run build`
4. Set **Start Command**: `npm run start:prod`
5. Add `render.yaml` (auto-detected) for config:
   ```yaml
   services:
     - type: web
       name: backend
       env: node
       buildCommand: npm ci && npm run build
       startCommand: npm run start:prod
   ```
6. Add environment variables (MONGODB_URI, REDIS_URL, META_* etc.) in Render dashboard.
7. Deploy!

**Troubleshooting**: Ensure `dist/main.js` builds correctly. Check logs for build errors.


---

## 🛡️ Security

- JWT-based authentication with refresh tokens
- Password hashing with bcryptjs
- Rate limiting on API endpoints
- Helmet.js for HTTP security headers
- CORS configuration
- Input validation and sanitization
- Environment variable protection

---

## 📝 License

This project is licensed under the [MIT License](LICENSE).

---

## 👤 Author

**Agro-Link Team**

---

## 🤝 Contributing

Contributions are welcome! Please read our [contributing guidelines](CONTRIBUTING.md) first.

---

## 🔗 Resources

- [NestJS Documentation](https://docs.nestjs.com)
- [MongoDB Documentation](https://docs.mongodb.com)
- [Meta WhatsApp Cloud API](https://developers.facebook.com/docs/whatsapp)
- [Redis Documentation](https://redis.io/docs)
