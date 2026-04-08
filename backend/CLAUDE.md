# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Agrolink is a NestJS-based agricultural marketplace backend that connects farmers and buyers via WhatsApp (Meta Cloud API). Users interact entirely through WhatsApp messages — no web frontend.

## Commands

```bash
# Development
npm run start:dev        # Hot-reload dev server
npm run start:debug      # Dev server with debugger

# Build & Production
npm run build            # Compile TypeScript → dist/
npm run start:prod       # Run compiled app

# Code Quality
npm run lint             # ESLint with auto-fix
npm run format           # Prettier format

# Testing
npm test                 # Unit tests (Jest)
npm run test:watch       # Unit tests with watch
npm run test:cov         # Coverage report
npm run test:e2e         # E2E tests (uses test/jest-e2e.json)

# Run a single test file
npx jest src/path/to/file.spec.ts
```

## Architecture

### Module Structure

The app follows NestJS module architecture. Currently two modules:

- **AppModule** (`src/app.module.ts`) — root module; wires MongoDB via `MongooseModule.forRootAsync` with `ConfigService`, imports WhatsAppModule
- **WhatsAppModule** (`src/whatsapp/`) — all WhatsApp webhook handling and outbound messaging

### Request Flow

1. Meta sends webhook POSTs to `/webhook`
2. `main.ts` captures the raw body via custom middleware (required for HMAC signature validation)
3. `WhatsAppController` receives the request and delegates to `WhatsAppService`
4. `WhatsAppService` parses the payload, handles conversation state, and calls back the Meta API for outbound messages

### Data Models (`src/schemas/`)

Six Mongoose schemas form the core domain:

| Schema | Purpose |
|--------|---------|
| `user.schema.ts` | Farmers/buyers; tracks phone, role, location, conversation state |
| `listing.schema.ts` | Sell/buy listings with pricing (suggested, final); status: active → matched → completed |
| `match.schema.ts` | Connects a farmer listing to a buyer; tracks offer negotiation state |
| `message.schema.ts` | Inbound/outbound message log per phone number |
| `notification.schema.ts` | Queued alerts (match found, accepted, price update); includes retry count |
| `price-history.schema.ts` | Aggregated market prices per product+location |

### Environment Variables

Copy `.env.example` to `.env`. Key variables:

```
PORT=3000
MONGODB_URI=            # MongoDB Atlas connection string
META_PHONE_NUMBER_ID=   # WhatsApp Business phone ID
META_ACCESS_TOKEN=      # Meta API token
META_VERIFY_TOKEN=      # Token used to verify webhook subscription
META_API_VERSION=v19.0
```

### Deployment

Deployed on Render (see `render.yaml`). Build: `npm ci && npm run build`. Start: `npm run start:prod`. Uses Node 22.

## Code Style

- Single quotes, trailing commas (enforced by Prettier via `.prettierrc`)
- `@typescript-eslint/no-explicit-any` is disabled — `any` is allowed but floating promises and unsafe arguments are warned on
- TypeScript target: ES2023, module resolution: nodenext
