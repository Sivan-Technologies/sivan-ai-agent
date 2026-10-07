/**
 * Builds the participant-facing "deal card" views of an escrow: status labels,
 * the action list for each role, and the summary/detail payloads.
 *
 * Extracted verbatim from escrowService.ts as step 5 of the god-service split
 * (FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 1). No logic changes.
 */
import { EscrowRecord } from "./escrowStore";
import { escrowStore } from "../context";
import { calculateEscrowPayoutQuote } from "./paymentService";
import { roleForEscrowParticipant } from "./participantIdentity";

export function participantDealStatus(status: EscrowRecord["status"]) {
  const labels: Record<EscrowRecord["status"], string> = {
    CREATED: "Getting ready",
    PENDING_PROFILE: "Seller setup required",
    PENDING_ACCEPTANCE: "Waiting for seller",
    PENDING_PAYMENT: "Waiting for buyer payment",
    FUNDED: "Payment confirmed",
    IN_PROGRESS: "Work in progress",
    DELIVERED: "Work delivered",
    COMPLETED: "Completion awaiting confirmation",
    PENDING_RELEASE: "Completion confirmation under review",
    RELEASED: "Service completed",
    DISPUTED: "Issue under review",
    REVIEW_REQUIRED: "Under manual review",
    FAILED: "Action required",
    EXPIRED: "Payment window expired",
    CANCELLED: "Cancelled",
  };
  return labels[status];
}

export type ParticipantDealAction = "accept" | "status" | "pay" | "cancel" | "complete" | "release" | "dispute" | "evidence" | "reference" | "deliver" | "proof";

export function participantDealActionsForEscrow(escrow: EscrowRecord, role: "buyer" | "seller"): ParticipantDealAction[] {
  const actions = new Set<ParticipantDealAction>(["status", "reference"]);

  if (role === "seller" && ["PENDING_PROFILE", "PENDING_ACCEPTANCE"].includes(escrow.status)) actions.add("accept");
  if (role === "buyer" && ["PENDING_PROFILE", "PENDING_ACCEPTANCE", "PENDING_PAYMENT"].includes(escrow.status)) actions.add("cancel");
  if (role === "buyer" && escrow.status === "PENDING_PAYMENT") actions.add("pay");
  if (role === "buyer" && ["FUNDED", "IN_PROGRESS", "DELIVERED"].includes(escrow.status)) actions.add("complete");
  if (role === "seller" && ["FUNDED", "IN_PROGRESS", "DELIVERED"].includes(escrow.status)) actions.add("deliver");
  if (["DELIVERED", "COMPLETED", "PENDING_RELEASE", "RELEASED", "DISPUTED"].includes(escrow.status)) actions.add("proof");
  if (role === "buyer" && ["COMPLETED", "DELIVERED"].includes(escrow.status)) actions.add("release");
  if (["FUNDED", "IN_PROGRESS", "DELIVERED", "COMPLETED", "PENDING_RELEASE", "REVIEW_REQUIRED"].includes(escrow.status)) actions.add("dispute");
  if (escrow.status === "DISPUTED") actions.add("evidence");

  return Array.from(actions);
}

export function participantDealActions(detail: any, role: "buyer" | "seller"): ParticipantDealAction[] {
  if (!detail) return [];
  return participantDealActionsForEscrow(detail.escrow, role);
}

export async function buildParticipantDealSummary(
  escrow: EscrowRecord,
  actorWhatsapp?: string | null,
  actorUserId?: string | null
) {
  const role = await roleForEscrowParticipant(escrow, actorWhatsapp, actorUserId);
  if (!role) return null;
  const payoutQuote = await calculateEscrowPayoutQuote(escrow.amount, escrow.currency, escrow.feePayer);

  let deliveryProof: { summary?: string; media?: any[]; deliveredAt?: string } | null = null;
  if (["DELIVERED", "COMPLETED", "PENDING_RELEASE", "RELEASED", "DISPUTED"].includes(escrow.status)) {
    const events = await escrowStore.listEvents(escrow.escrowId).catch(() => []);
    const delivEvent = events.slice().reverse().find((e) => e.eventType === "seller_delivery_proof_recorded");
    if (delivEvent) {
      let meta: any = {};
      try { meta = JSON.parse(delivEvent.metadata || "{}"); } catch {}
      deliveryProof = {
        summary: delivEvent.reason || meta.summary || "Work delivered",
        media: meta.media || [],
        deliveredAt: delivEvent.createdAt,
      };
    }
  }

  return {
    escrow: {
      escrowId: escrow.escrowId,
      /**
       * Where the deal was struck. sivan-payment reads this exact field to
       * label a deal as whatsapp / telegram / web in the user's agreement
       * list (identity.routes.ts). It was never included in this payload, so
       * every WhatsApp and Telegram deal arrived unlabelled and fell through
       * to the default — the web app told users a WhatsApp deal was created
       * on the web.
       */
      createdByChannel: escrow.createdByChannel,
      amount: escrow.amount,
      currency: escrow.currency,
      status: escrow.status,
      purpose: escrow.purpose,
      feePayer: escrow.feePayer || "buyer",
      platformFeeAmount: payoutQuote.platformFeeAmount,
      totalPlatformFee: payoutQuote.totalPlatformFee,
      totalWithFee: payoutQuote.totalWithFee,
      sellerNetAmount: payoutQuote.sellerNetAmount,
      buyerWhatsapp: escrow.buyerWhatsapp,
      buyerUserId: escrow.buyerUserId,
      sellerWhatsapp: escrow.sellerWhatsapp,
      sellerUserId: escrow.sellerUserId,
      deliveryProof: deliveryProof || undefined,
      createdAt: escrow.createdAt,
      updatedAt: escrow.updatedAt,
      fundingExpiresAt: escrow.fundingExpiresAt,
      activePaymentExpiresAt: escrow.activePaymentExpiresAt,
      paymentRegenerationCount: escrow.paymentRegenerationCount || 0,
      ...(role === "buyer" && escrow.paymentAuthorizationUrl
        ? { paymentAuthorizationUrl: escrow.paymentAuthorizationUrl }
        : {}),
    },
    readiness: {
      sellerProfileComplete: !["PENDING_PROFILE"].includes(escrow.status),
      payoutVerified: !["PENDING_PROFILE"].includes(escrow.status),
      sellerAccepted: !["PENDING_ACCEPTANCE", "PENDING_PROFILE"].includes(escrow.status),
      fundingVerified: ["IN_PROGRESS", "COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status),
      buyerCompleted: ["COMPLETED", "PENDING_RELEASE", "RELEASED"].includes(escrow.status),
      releaseRequested: escrow.status === "PENDING_RELEASE",
      nextAction: participantDealStatus(escrow.status),
    },
    participant: {
      role,
      displayStatus: participantDealStatus(escrow.status),
      allowedActions: participantDealActionsForEscrow(escrow, role),
    },
  };
}

export async function buildParticipantDeal(
  detail: any,
  actorWhatsapp?: string | null,
  actorUserId?: string | null
) {
  if (!detail) return null;
  const role = await roleForEscrowParticipant(detail.escrow, actorWhatsapp, actorUserId);
  if (!role) return null;

  const quote = detail.payoutQuote || await calculateEscrowPayoutQuote(detail.escrow.amount, detail.escrow.currency, detail.escrow.feePayer);

  let deliveryProof: { summary?: string; media?: any[]; deliveredAt?: string } | null = null;
  if (["DELIVERED", "COMPLETED", "PENDING_RELEASE", "RELEASED", "DISPUTED"].includes(detail.escrow.status)) {
    const events = detail.events || await escrowStore.listEvents(detail.escrow.escrowId).catch(() => []);
    const delivEvent = Array.isArray(events) ? events.slice().reverse().find((e: any) => e.eventType === "seller_delivery_proof_recorded") : undefined;
    if (delivEvent) {
      let meta: any = {};
      try { meta = typeof delivEvent.metadata === "string" ? JSON.parse(delivEvent.metadata || "{}") : (delivEvent.metadata || {}); } catch {}
      deliveryProof = {
        summary: delivEvent.reason || meta.summary || "Work delivered",
        media: meta.media || [],
        deliveredAt: delivEvent.createdAt,
      };
    }
  }

  return {
    escrow: {
      escrowId: detail.escrow.escrowId,
      amount: detail.escrow.amount,
      currency: detail.escrow.currency,
      status: detail.escrow.status,
      purpose: detail.escrow.purpose,
      deliveryProof,
      feePayer: detail.escrow.feePayer || "buyer",
      platformFeeAmount: quote.platformFeeAmount,
      totalPlatformFee: quote.totalPlatformFee,
      totalWithFee: quote.totalWithFee,
      sellerNetAmount: quote.sellerNetAmount,
      buyerWhatsapp: detail.buyer?.whatsappNumber || detail.escrow.buyerWhatsapp,
      buyerTelegramUserId: detail.buyer?.telegramUserId,
      sellerWhatsapp: detail.seller?.whatsappNumber || detail.escrow.sellerWhatsapp,
      sellerTelegramUserId: detail.seller?.telegramUserId,
      createdAt: detail.escrow.createdAt,
      updatedAt: detail.escrow.updatedAt,
      fundingExpiresAt: detail.escrow.fundingExpiresAt,
      activePaymentExpiresAt: detail.escrow.activePaymentExpiresAt,
      paymentRegenerationCount: detail.escrow.paymentRegenerationCount || 0,
      ...(role === "buyer" && detail.escrow.paymentAuthorizationUrl
        ? { paymentAuthorizationUrl: detail.escrow.paymentAuthorizationUrl }
        : {}),
    },
    readiness: {
      sellerProfileComplete: detail.readiness.sellerProfileComplete,
      payoutVerified: detail.readiness.payoutVerified,
      sellerAccepted: detail.readiness.sellerAccepted,
      fundingVerified: detail.readiness.fundingVerified,
      buyerCompleted: detail.readiness.buyerCompleted,
      releaseRequested: detail.readiness.releaseRequested,
      nextAction: detail.readiness.nextAction,
    },
    participant: {
      role,
      displayStatus: participantDealStatus(detail.escrow.status),
      allowedActions: participantDealActions(detail, role),
    },
  };
}
