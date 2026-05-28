# Autonomous Escrow Agent for SAP + Ace Data Cloud

## Purpose

This project builds an autonomous agent that discovers tools through SAP, executes tasks through Ace Data Cloud, and settles payments through both on-chain USDC and Nigerian Naira payment flows.

## What it does today

- Discovers available tools and services through `src/services/sapAgent.ts` using SAP JSON-RPC.
- Executes AI tasks through `src/services/aceData.ts` with Ace Data Cloud endpoints.
- Routes payments in `src/services/paymentRouter.ts` between Paystack and x402.
- Creates and settles USDC payment facilities with `src/services/x402Client.ts`.
- Initiates Naira payments with `src/services/paystackClient.ts`, stores the Paystack transaction reference, and waits for verified Paystack confirmation before running Naira task execution.
- Orchestrates end-to-end workflows in `src/services/agentOrchestrator.ts`.
- Handles Paystack webhooks in `src/server.ts` to confirm payment events.

## Bounty alignment

The current implementation aligns with core bounty requirements by:

- supporting hybrid payment settlement across USDC and Naira
- including SAP tool discovery and agent registration workflows
- integrating Ace Data Cloud AI execution
- supporting Paystack webhook verification and settlement routing
- providing a production-ready TypeScript backend architecture

## Key capabilities

This agent is designed for:

- AI service marketplaces with hybrid settlement
- freelancer escrow delivery for on-chain and local fiat customers
- Nigerian payment integration with Paystack
- autonomous task execution and payment settlement

## Current status

- The repository includes modular service layers for SAP, Ace Data Cloud, Paystack, and x402.
- The agent now uses real JSON-RPC 2.0 method patterns for SAP rather than generic placeholders.
- The x402 client supports payment facility creation, settlement, and status polling.
- The payment router makes the hybrid fiat/crypto decision automatically.
- A Paystack webhook server is implemented for event validation, transaction verification, and webhook-driven Naira workflow execution.

## Next focus areas

- Deploy and configure real SAP and x402 endpoints.
- Add durable workflow state persistence and audit trail logging.
- Harden retry, timeout, and error handling across all services.
- Add queue-based scaling and observability for production readiness.
