# Agent Functional Specification

## Goals

Build an autonomous agent that:

- discovers tools via Synapse Agent Protocol (SAP)
- executes tasks using Ace Data Cloud AI services
- settles payments via x402 for USDC and Paystack for Naira
- supports hybrid fiat and crypto flows
- runs end-to-end with minimal manual intervention

## Functional Requirements

### 1. Registration & Discovery

- Register the agent with SAP using `sapAgent.ts`.
- Discover matching tools and services by task metadata.
- Select services based on task type, payment path, and availability.

### 2. Input Trigger

- Accept task input from environment configuration, webhook, or authenticated API trigger.
- Parse required task type, payment preference, and instructions.
- Require `x-core-api-key` with `CORE_API_SECRET` for `/api/tasks` when requests come from the WhatsApp bot.

### 3. Tool Selection

- Query SAP for candidate tools via `discoverTools()`.
- Score or filter candidates by relevance and supported payment flow.
- Choose one or more tools for execution.

### 4. Execution

- Call Ace Data Cloud via `src/services/aceData.ts`.
- Support text generation, document summarization, and data extraction.
- Return structured results for the orchestrator.

### 5. Payment Settlement

#### USDC Payment Facility (x402)

- Create a USDC payment facility with `x402Client.createPaymentFacility()`.
- Execute the task after payment facility creation.
- Settle the payment with `x402Client.settlePayment()` upon completion.

#### Naira Paystack Flow

- Initialize a Paystack transaction with `paystackClient.initializeTransaction()`.
- Store Paystack's real transaction `reference` for webhook matching and return the checkout URL separately.
- Keep the workflow in `payment_pending` until Paystack sends a signed `charge.success` webhook.
- Verify the webhook signature, then verify the transaction with Paystack before executing AI work.
- Execute the task only after payment is confirmed.
- Mark the workflow as complete after the confirmed Naira task execution finishes.

### 6. Completion & Settlement

- Validate the AI execution results.
- Release or settle payment through the chosen path.
- Confirm completion and record outcome.

### 7. Webhook & Event Handling

- Use `src/server.ts` to receive Paystack webhook events.
- Verify webhook signatures with `PAYSTACK_WEBHOOK_SECRET`.
- Advance workflow state automatically when payment is confirmed and transaction verification succeeds.
- Keep webhook handling idempotent so repeated Paystack delivery does not double-run a task.

## Non-functional Requirements

- End-to-end automation with retry-safe service calls.
- Secrets stored securely in environment variables.
- Modular architecture to support future tool and payment paths.
- Clear event logging and observability for debugging and audit.

## Success Criteria

- Executes a complete workflow from trigger → discovery → execution → payment.
- Supports hybrid settlement through Naira and USDC.
- Uses SAP tool discovery and Ace Data Cloud AI execution.
- Confirms Paystack payment events and x402 settlement reliably.
