/**
 * escrowService — public API barrel.
 *
 * This file used to be a 1,919-line god object. It was decomposed into focused
 * modules per FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 1. It now re-exports them
 * so every existing caller (`import { x } from "./escrowService"`) keeps working
 * unchanged. Nothing but re-exports belongs here.
 *
 * Import the specific module directly in new code.
 */

export * from "./escrowUtils";
export * from "./messageFormatter";
export * from "./mediaResolver";
export * from "./participantIdentity";
export * from "./dealCardBuilder";
export * from "./notificationDispatcher";
export * from "./notificationOrchestrator";
export * from "./paymentLifecycleRefresh";
export * from "./escrowDetailBuilder";
export * from "./evidenceHandler";
export * from "./paymentReconciliation";
export * from "./lifecycleSweeps";
export * from "./reconciliationReporting";
export * from "./opsStatus";
