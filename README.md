![Sivan Escrow Agent](https://img.shields.io/badge/project-Sivan%20Escrow%20Agent-blue)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

# Sivan Escrow Agent

An autonomous agent for the SAP + Ace Data Cloud bounty built for local Nigerian Naira escrow through Paystack and on-chain USDC settlement via x402.

Sivan Escrow Agent is designed to support local trust-first freelance payments, where Paystack holds funds until both buyer and seller agree.

## What this project does today

- Uses `src/services/sapAgent.ts` to register and interact with SAP using JSON-RPC 2.0, discover available tools, and manage escrow lifecycle.
- Uses `src/services/aceData.ts` to execute AI tasks through Ace Data Cloud APIs for text generation, document summarization, and data extraction.
- Routes payments in `src/services/paymentRouter.ts` between Paystack fiat flow and x402 USDC payment facilitator flow.
- Uses `src/services/paystackClient.ts` to initialize Naira payments, store Paystack transaction references, verify webhook signatures, and confirm transaction outcomes before running Naira task execution.
- Uses `src/services/x402Client.ts` to create payment facilities, settle USDC payments, and poll payment status with retry logic.
- Uses `src/services/agentOrchestrator.ts` to coordinate task execution, tool discovery, payment routing, and settlement.
- Runs `src/server.ts` as an Express API and webhook service for authenticated task creation, protected admin endpoints, and Paystack payment confirmation.

## What is included

- `docs/` with updated architecture, overview, agent specification, environment variables, and development plan.
- `.env.example` describing required runtime configuration.
- `src/` TypeScript implementation covering:
  - SAP discovery, registration, and escrow workflow
  - Ace Data Cloud AI execution
  - Paystack Naira payment initialization and webhook verification
  - x402 USDC payment facility creation and settlement
  - autonomous orchestration of execution and settlement

## Getting started

### Backend (Render)

1. Copy `.env.example` to `.env` and update the values.
2. Install dependencies:

```bash
npm install
```

3. Run in development mode:

```bash
npm run dev
```

4. Start the webhook server:

```bash
npm run serve
```

5. Configure runtime task inputs in `.env` using:

```env
AGENT_TASK_TYPE=content-creation
USER_PAYMENT_PREFERENCE=NAIRA
USER_EMAIL=buyer@example.com
PAYMENT_AMOUNT=50
TASK_INSTRUCTIONS=Write a product description for a trustless escrow service.
```

6. Build and run for production:

```bash
npm run build
npm start
```

7. Build and run with Docker:

```bash
docker build -t sivan-escrow-agent .
docker run -p 4000:4000 --env-file .env sivan-escrow-agent
```

### Admin UI

1. The `frontend/` folder is now an optional admin dashboard only.
2. To run it locally:

```bash
cd frontend
npm install
npm run dev
```

3. Set `VITE_API_BASE_URL` to your Render backend URL when building it.

4. Deploy this folder only if you need an internal dashboard.

## Project structure

- `./` — backend service deployable to Render.
- `./frontend/` — optional admin UI for internal monitoring.

## Deployment recommendations

- Use Render for backend hosting with a persistent database.
- Do not treat the admin UI as your main buyer-facing product.
- Buyer-facing distribution should be WhatsApp first, with the backend handling incoming messages.

## Standalone WhatsApp bot integration

- The WhatsApp bot should be a separate repository from this core escrow backend.
- Keep this repo focused on the backend, workflow orchestration, payment handling, and admin monitoring.
- The WhatsApp bot repo should only forward messages and payment events into the backend API.
- This keeps your core escrow logic private and maintainable by a separate team.


- `src/index.ts` – main workflow entry point and bootstrap.
- `src/config.ts` – environment variable loading and validation.
- `src/services/aceData.ts` – Ace Data Cloud service adapter.
- `src/services/paymentRouter.ts` – determines whether Naira or USDC payment flows should be used.
- `src/services/sapAgent.ts` – SAP registration, tool discovery, and escrow lifecycle.
- `src/services/agentOrchestrator.ts` – coordinates tool discovery, AI execution, and payment settlement.
- `src/services/paystackClient.ts` – Paystack transaction initiation and webhook signature verification.
- `src/services/x402Client.ts` – x402 payment facility creation, settlement, and status polling.
- `src/server.ts` – Express server for authenticated task creation, protected admin endpoints, and Paystack webhook events.

## Why Sivan Escrow Agent?

- Built to support local Nigerian Naira escrow through Paystack with funds held until mutual agreement.
- Designed for trust-first, mobile-native freelance payments.
- Positioned for communities that already transact through WhatsApp, Telegram, and Discord.
- Focuses on low-friction onboarding and progressive identity rather than forcing crypto-first signup.

## Implementation status

- Current implementation includes a modular TypeScript backend with production-grade service clients.
- `sapAgent.ts` now uses JSON-RPC 2.0 and retry logic for SAP agent calls.
- `x402Client.ts` now supports payment facility creation, settlement, and status polling.
- `paymentRouter.ts` routes between Paystack and USDC settlement paths.
- `agentOrchestrator.ts` coordinates AI execution, tool discovery, and payment settlement.

> The system is now ready for real SAP/x402 endpoint deployment, workflow persistence, and production hardening.

## Production-grade direction

- Keep the existing TypeScript architecture and modular service pattern.
- Add durable workflow state persistence and audit logging.
- Harden all external integrations with retry, error handling, and observability.
- Add tests, monitoring, and deployment automation before final submission.

## Next implementation steps

- Finalize SAP mainnet integration and on-chain escrow lifecycle.
- Expand Paystack webhook-driven Naira settlement tests and operational monitoring.
- Add persistent workflow state, task retry safety, and transaction audit records.
- Add queue-based scaling, monitoring, and deployment configuration.
