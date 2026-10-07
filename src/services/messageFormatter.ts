/**
 * Message string builders for escrow participant notifications.
 *
 * Pure functions: no database access, no async, no side effects. Extracted
 * verbatim from escrowService.ts as step 2 of the god-service split
 * (FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 1). No logic changes.
 */

import { EscrowRecord } from "./escrowStore";

export function sellerInviteMessage(escrowId: string, currency: string, amount: number, purpose: string) {
  return `You have been invited to Sivan service agreement ${escrowId} for ${currency} ${amount}.\nPurpose: ${purpose}\nReply: accept ${escrowId}`;
}

function displayCurrency(currency: string) {
  return currency === "NAIRA" ? "NGN" : currency;
}

function displayAmount(amount: number) {
  return new Intl.NumberFormat("en-NG").format(amount);
}

export function escrowCreatedMessage(escrow: EscrowRecord, role: "buyer" | "seller") {
  const currency = displayCurrency(escrow.currency);
  const amount = displayAmount(escrow.amount);
  if (role === "buyer") {
    return [
      `Sivan agreement created: ${escrow.escrowId}`,
      `${escrow.purpose}`,
      `${currency} ${amount}`,
      "",
      "We have sent the agreement to the other party.",
      `Reply STATUS ${escrow.escrowId} to view the agreement or track acceptance.`,
    ].join("\n");
  }
  return [
    `You have been invited to a Sivan service agreement: ${escrow.escrowId}`,
    `${escrow.purpose}`,
    `${currency} ${amount}`,
    "",
    `Reply ACCEPT ${escrow.escrowId} to accept the deal.`,
    `Reply STATUS ${escrow.escrowId} to view the agreement first.`,
  ].join("\n");
}

export function participantLifecycleMessage(escrow: EscrowRecord, statusLine: string, nextLine: string) {
  const currency = displayCurrency(escrow.currency);
  return [
    `Sivan update for ${escrow.escrowId}`,
    `${escrow.purpose}`,
    `${currency} ${new Intl.NumberFormat("en-NG").format(escrow.amount)}`,
    "",
    statusLine,
    nextLine,
    "",
    `Reply STATUS ${escrow.escrowId} to view the agreement.`,
  ].join("\n");
}
