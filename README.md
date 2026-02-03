# Sendcat

AI-powered chat application with e-commerce integration and package tracking.

## Features

- **AI Chat** - Chat with multiple AI models featuring streaming responses, tool calls, and reasoning
- **eBay Product Search** - Search and browse eBay products directly within chat conversations
- **Package Tracking** - Track packages from warehouse to delivery
- **Gmail Integration** - Automatically detect order confirmations from Gmail and create pre-alerts
- **WhatsApp Integration** - Connect your WhatsApp for notifications and messaging (not done)
- **Product Catalog** - Browse products by category in the explore section
- **User Authentication** - Secure authentication with Better Auth(need tp wire up forget password flow)

## Tech Stack

- **Frontend**: React 19, TanStack Router, Tailwind CSS v4
- **Backend**: Convex (serverless database and functions)
- **Authentication**: Better Auth with @convex-dev/better-auth
- **AI Integration**: OpenAI-compatible API with multiple model support with Openrouter
- **Openrouter**: Model router provider
- **Integrations**: eBay API, Gmail API, WhatsApp Business API

## Getting Started

### Prerequisites

- Node.js 18+
- A Convex account and project
- Environment variables configured (see below)

### Installation

```bash
bun install
```

### Environment Variables

Create a `.env.local` file with:

```env
VITE_CONVEX_URL=your_convex_deployment_url
VITE_SENTRY_DSN=your_sentry_dsn # optional
SENTRY_DSN=your_sentry_server_dsn # optional (server)
VITE_SENTRY_TRACES_SAMPLE_RATE=0.1
SENTRY_TRACES_SAMPLE_RATE=0.1
VITE_SENTRY_RELEASE=your_release # optional
SENTRY_RELEASE=your_release # optional
```

And set up Convex environment variables:

```bash
npx convex env:set BETTER_AUTH_SECRET=your_secret
npx convex env:set EBAY_CLIENT_ID=your_ebay_client_id
npx convex env:set EBAY_CLIENT_SECRET=your_ebay_client_secret
npx convex env:set GMAIL_CLIENT_ID=your_gmail_client_id
npx convex env:set GMAIL_CLIENT_SECRET=your_gmail_client_secret
npx convex env:set WHATSAPP_ACCESS_TOKEN=your_whatsapp_token
npx convex env:set SENTRY_DSN=your_sentry_server_dsn
```

If you want source map uploads during `vite build`, set:

```bash
export SENTRY_AUTH_TOKEN=your_sentry_auth_token
export SENTRY_ORG=your_sentry_org_slug
export SENTRY_PROJECT=your_sentry_project_slug
export SENTRY_RELEASE=$(git rev-parse --short HEAD)
```

### Development

```bash
bun run dev
```

The app will be available at `http://localhost:3000`

### Building for Production

```bash
npm run build
```

## Project Structure

```
src/
  routes/           # TanStack Router file-based routes
    index.tsx       # Home page with chat interface
    chat.$threadId.tsx  # Individual chat threads
    explore/        # Product catalog browsing
    packages.tsx    # Package tracking dashboard
    pre-alerts.tsx  # Pre-alert management
    settings.tsx    # User settings and integrations
  components/
    chat/           # Chat UI components
    product/        # Product display components
    layout/         # Layout components (sidebar, etc.)
    ui/             # UI component library
  lib/              # Utilities and clients

convex/
  schema.ts         # Database schema
  chat.ts           # Chat mutations and queries
  chatHttp.ts       # HTTP actions for AI streaming
  threads.ts        # Thread management
  messages.ts       # Message operations
  packages.ts       # Package tracking
  profiles.ts       # User profiles
  explore.ts        # Product catalog functions
  ebay.ts           # eBay API integration
  integrations/     # Third-party integrations
    gmail/          # Gmail OAuth and sync
    whatsapp.ts     # WhatsApp integration
    evidence.ts     # Pre-alert evidence processing
  auth.ts           # Authentication triggers
```

## Testing

```bash
npm run test
```

Uses Vitest for testing.

## Features Backlog

See [features.md](./features.md) for planned features including:

- Gmail inbox watch with manual sync
- Pre-alert notifications via WhatsApp/Email
- Firecrawl integration for web extraction

## License

Private - All rights reserved
