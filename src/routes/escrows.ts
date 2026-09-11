import { Router } from "express";
import { requireCoreApiAuth } from "../middleware/apiAuth";
import {
  escrowCreateSchema,
  participantActorSchema,
  escrowActionSchema,

  deliveryProofSchema,
  participantDisputeEvidenceSchema,
  formatZodError,
} from "../validation";
import { config } from "../config";
import {
  escrowStore,
  abusePrevention,
  settingsStore,
  opsStore,
  paymentRouter,
} from "../context";
import {
  capturePaymentWarning,
  captureOperationalError,
} from "../services/monitoring";
import {
  createNairaPaymentInstruction,
  activeNairaPaymentInstructionForEscrow,
  createPaymentInstructionForEscrow,
  activePaymentInstructionForEscrow,
  formatFundingInstruction,
  fundingDeadlineForEscrow,
  calculateEscrowPayoutQuote,
} from "../services/paymentService";
import {
  buildEscrowDetail,
  buildParticipantDeal,
  disputeHistoryForEscrow,
  notifyEscrowParticipants,
  notifyEscrowCreatedParticipants,
  participantLifecycleMessage,
  roleForEscrowParticipant,
  sendOrQueueWhatsAppNotification,
  expectedFundingAmount,
  notifyEscrowFundedParticipants,
  recordDisputeEvidence,
  recordDeliveryProof,
  whatsappIdentityMatches,
  containsExternalLink,
  externalDeliveryLinksAllowed,
} from "../services/escrowService";
import {
  createSandboxPaymentInstruction,
  isSandboxPaymentReference,
} from "../services/payoutVerificationTestMode";
import { info, warn } from "../lib/logger";

const router = Router();

router.post("/api/escrows", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid escrow request", details: formatZodError(parsed.error) });
    }

    const input = parsed.data;
    if (input.clientRequestId) {
      const existing = await escrowStore.findEscrowByClientRequestId(input.clientRequestId);
      if (existing) {
        return res.status(200).json({
          escrow: existing,
          payment: null,
          sellerInviteSent: false,
          idempotent: true,
        });
      }
    }

    const abuseDecision = await abusePrevention.evaluateEscrowCreate({
      ...input,
      requestIp: req.ip,
      userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
      deviceFingerprint: typeof req.headers["x-device-fingerprint"] === "string" ? req.headers["x-device-fingerprint"] : undefined,
    });
    if (!abuseDecision.allowed) {
      capturePaymentWarning("Escrow creation blocked by abuse prevention", {
        buyerWhatsapp: input.buyerWhatsapp,
        sellerWhatsapp: input.sellerWhatsapp,
        amount: input.amount,
        currency: input.currency,
        riskScore: abuseDecision.riskScore,
        reasons: abuseDecision.reasons,
      });
      return res.status(403).json({
        error: "ESCROW_RISK_BLOCKED",
        message: "This escrow requires support review before it can be created",
        risk: abuseDecision,
      });
    }

    const settings = await settingsStore.getSettings();
    if (input.currency === "USDT" && !settings.usdtEnabled) {
      return res.status(400).json({ error: "USDT_DISABLED", message: "USDT payments are currently disabled by administrator policy." });
    }

    const buyer = await escrowStore.upsertUserByWhatsapp(input.buyerWhatsapp, "buyer");
    if (input.currency === "NAIRA") {
      const exposure = await escrowStore.getNairaExposureForBuyer(buyer.userId);
      const tier = exposure.successfulEscrows >= settings.establishedUserSuccessfulEscrows
        ? "ESTABLISHED"
        : exposure.successfulEscrows >= settings.trustedUserSuccessfulEscrows
          ? "TRUSTED"
          : "NEW";
      const tierLimit = tier === "ESTABLISHED"
        ? settings.nairaEstablishedUserLimit
        : tier === "TRUSTED"
          ? settings.nairaTrustedUserLimit
          : settings.nairaNewUserLimit;
      const policy = {
        tier,
        successfulEscrows: exposure.successfulEscrows,
        tierLimit,
        specialApprovalLimit: settings.nairaSpecialApprovalLimit,
        buyerActiveExposure: exposure.buyerActiveExposure,
        platformActiveExposure: exposure.platformActiveExposure,
        buyerActiveExposureLimit: settings.nairaBuyerActiveExposureLimit,
        platformActiveExposureLimit: settings.nairaPlatformActiveExposureLimit,
        requestedAmount: input.amount,
      };
      if (input.amount > settings.nairaSpecialApprovalLimit) {
        return res.status(403).json({ error: "ESCROW_LIMIT_EXCEEDED", message: "Requested amount exceeds Sivan's maximum supported Naira escrow limit", policy });
      }
      const reviewReason = input.amount > tierLimit
        ? { error: "ESCROW_LIMIT_REVIEW_REQUIRED", message: "This amount requires operator approval for the buyer's current trust tier" }
        : exposure.buyerActiveExposure + input.amount > settings.nairaBuyerActiveExposureLimit
          ? { error: "BUYER_EXPOSURE_LIMIT_REACHED", message: "This buyer's active Naira exposure limit requires operator review" }
          : exposure.platformActiveExposure + input.amount > settings.nairaPlatformActiveExposureLimit
            ? { error: "PLATFORM_EXPOSURE_LIMIT_REACHED", message: "Sivan's active Naira exposure limit requires operator review before another escrow can be created" }
            : null;
      if (reviewReason) {
        const review = await escrowStore.createOrGetLimitReview({
          clientRequestId: input.clientRequestId,
          buyerUserId: buyer.userId,
          buyerWhatsapp: input.buyerWhatsapp,
          sellerWhatsapp: input.sellerWhatsapp,
          amount: input.amount,
          currency: input.currency,
          purpose: input.purpose,
          createdByChannel: input.channel,
          reasonCode: reviewReason.error,
          policy,
        });
        return res.status(409).json({ ...reviewReason, policy, review });
      }
    }
    const seller = input.sellerWhatsapp
      ? await escrowStore.upsertUserByWhatsapp(input.sellerWhatsapp, "seller")
      : null;

    const escrow = await escrowStore.createEscrow({
      buyerUserId: buyer.userId,
      sellerUserId: seller?.userId,
      sellerWhatsapp: input.sellerWhatsapp,
      amount: input.amount,
      currency: input.currency,
      purpose: input.purpose,
      clientRequestId: input.clientRequestId,
      createdByChannel: input.channel,
      feePayer: input.feePayer,
    });

    const updated = await escrowStore.getEscrowById(escrow.escrowId);
    if (updated && input.channel.startsWith("whatsapp")) {
      await notifyEscrowCreatedParticipants(updated);
    }
    res.status(201).json({
      escrow: updated,
      payment: null,
      buyerNotificationSent: Boolean(updated && input.channel.startsWith("whatsapp")),
      sellerInviteSent: Boolean(seller && input.channel.startsWith("whatsapp")),
      risk: abuseDecision,
    });
  } catch (err: any) {
    captureOperationalError("Failed to create escrow", err);
    res.status(500).json({ error: err.message || "Escrow creation failed" });
  }
});

router.get("/api/escrows/:escrowId", requireCoreApiAuth, async (req, res) => {
  const parsed = participantActorSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Participant identity is required", details: formatZodError(parsed.error) });
  }
  const detail = await buildEscrowDetail(req.params.escrowId);
  if (!detail) return res.status(404).json({ error: "Escrow not found" });
  const participantDeal = await buildParticipantDeal(detail, parsed.data.actorWhatsapp, parsed.data.actorUserId);
  if (!participantDeal) return res.status(403).json({ error: "Only escrow participants can view this deal" });
  res.status(200).json(participantDeal);
});


router.get("/api/escrows/:escrowId/dispute-history", requireCoreApiAuth, async (req, res) => {
  const parsed = participantActorSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Participant identity is required", details: formatZodError(parsed.error) });
  }
  const escrow = await escrowStore.getEscrowById(req.params.escrowId);
  if (!escrow) return res.status(404).json({ error: "Escrow not found" });
  if (!await roleForEscrowParticipant(escrow, parsed.data.actorWhatsapp, parsed.data.actorUserId)) {
    return res.status(403).json({ error: "Only escrow participants can view dispute history" });
  }

  const history = await disputeHistoryForEscrow(req.params.escrowId);
  if (!history) return res.status(404).json({ error: "Escrow not found" });
  res.status(200).json(history);
});

router.post("/api/escrows/:escrowId/payment-instruction", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.actorWhatsapp) {
      return res.status(400).json({ error: "Buyer WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
    }
    const detail = await buildEscrowDetail(req.params.escrowId);
    if (!detail) return res.status(404).json({ error: "Escrow not found" });
    if (detail.buyer?.whatsappNumber !== parsed.data.actorWhatsapp) {
      return res.status(403).json({ error: "Only the escrow buyer can request payment details" });
    }
    if (detail.escrow.status === "EXPIRED") {
      return res.status(409).json({ error: "This escrow has expired. Create a new escrow to continue." });
    }
    if (detail.escrow.status !== "PENDING_PAYMENT") {
      return res.status(409).json({ error: `Payment details are not available while escrow is ${detail.escrow.status}` });
    }
    const activeInstruction = await activePaymentInstructionForEscrow(detail);
    if (activeInstruction) {
      return res.status(200).json({
        escrow: detail,
        payment: activeInstruction,
      });
    }

    const payment = await createPaymentInstructionForEscrow(detail.escrow, {
      regenerate: true,
      buyerWhatsapp: parsed.data.actorWhatsapp,
    });
    const updated = await buildEscrowDetail(req.params.escrowId);
    res.status(200).json({ escrow: updated, payment });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Payment instruction refresh failed" });
  }
});

router.post("/api/escrows/:escrowId/accept", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.actorWhatsapp) {
      return res.status(400).json({ error: "Seller WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
    }
    const detailBefore = await buildEscrowDetail(req.params.escrowId);
    if (!detailBefore) return res.status(404).json({ error: "Escrow not found" });
    if (detailBefore.escrow.currency === "NAIRA") {
      if (!detailBefore.readiness.sellerProfileComplete || !detailBefore.readiness.payoutVerified) {
        return res.status(409).json({
          error: "SELLER_PAYOUT_SETUP_REQUIRED",
          message: "Seller profile and verified payout account are required before accepting a Naira escrow",
          escrow: detailBefore.escrow,
          readiness: detailBefore.readiness,
        });
      }
    }

    const accepted = await escrowStore.acceptEscrow(req.params.escrowId, parsed.data.actorWhatsapp);
    let payment: any = null;
    if (accepted.currency === "NAIRA" && !accepted.paymentReference) {
      const sandboxPayment = createSandboxPaymentInstruction(accepted.escrowId);
      if (sandboxPayment) {
        const fundingExpiresAt = accepted.fundingExpiresAt || await fundingDeadlineForEscrow(accepted);
        await escrowStore.attachPayment({
          escrowId: accepted.escrowId,
          paymentReference: sandboxPayment.reference,
          paymentAuthorizationUrl: sandboxPayment.authorizationUrl,
          paymentProvider: sandboxPayment.provider,
          paymentMetadata: {
            provider: sandboxPayment.provider,
            reference: sandboxPayment.reference,
            fundingExpiresAt,
            testOnly: true,
          },
          fundingExpiresAt,
          status: "PENDING_PAYMENT",
        });
        payment = {
          provider: sandboxPayment.provider,
          reference: sandboxPayment.reference,
          authorizationUrl: sandboxPayment.authorizationUrl,
          fundingExpiresAt,
          testOnly: true,
        };
      } else {
        payment = await createNairaPaymentInstruction(accepted, { buyerWhatsapp: detailBefore.buyer?.whatsappNumber });
      }
    } else if (accepted.currency === "USDC" && !accepted.paymentReference) {
      const usdcChannel = process.env.USDC_CHANNEL || "x402";
      let paymentResult: any;

      try {
        const recipient = config.sap.agentPublicKey || "sivan-escrow-agent";
        if (usdcChannel === "sap") {
          paymentResult = await paymentRouter.processUsdcSapEscrow(accepted.amount, recipient);
        } else {
          paymentResult = await paymentRouter.processUsdcEscrow(accepted.amount, recipient);
        }
      } catch (err: any) {
        warn("Failed to create on-chain USDC payment facility, using fallback mock reference", err);
        paymentResult = {
          reference: `x402-${accepted.escrowId}`,
          paymentId: `x402-${accepted.escrowId}`,
          status: "pending",
        };
      }

      await escrowStore.attachPayment({
        escrowId: accepted.escrowId,
        paymentReference: paymentResult.reference,
        paymentProvider: usdcChannel,
        status: "PENDING_PAYMENT",
        paymentMetadata: {
          paymentId: paymentResult.paymentId,
          details: paymentResult.details || null,
        },
      });
      payment = {
        provider: usdcChannel,
        reference: paymentResult.reference,
        paymentId: paymentResult.paymentId,
        settlementPolicy: "autonomous_usdc_release",
      };
    }
    const updated = await buildEscrowDetail(req.params.escrowId);
    if (updated?.escrow && payment) {
      const buyer = updated.buyer;
      if (buyer) {
        const instruction = `Service provider accepted agreement ${updated.escrow.escrowId}.\n\n${formatFundingInstruction(updated.escrow, payment)}`;
        const dealCard = await buildParticipantDeal(updated, buyer.whatsappNumber);
        void sendOrQueueWhatsAppNotification({
          to: buyer.whatsappNumber,
          telegramUserId: buyer.telegramUserId || undefined,
          message: instruction,
          reason: "seller_accepted_payment_details",
          escrowId: updated.escrow.escrowId,
          dealCard: dealCard ? {
            escrow: dealCard.escrow,
            participant: dealCard.participant,
          } : undefined,
        }).catch((err) => warn("Background buyer notification failed", err));
      }
    }
    res.status(200).json({ escrow: updated, payment });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Escrow acceptance failed" });
  }
});

router.post("/api/escrows/:escrowId/test-fund", requireCoreApiAuth, async (req, res) => {
  const parsed = escrowActionSchema.safeParse(req.body);
  if (!parsed.success || !parsed.data.actorWhatsapp) {
    return res.status(400).json({ error: "Buyer WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
  }
  const detail = await buildEscrowDetail(req.params.escrowId);
  if (!detail) return res.status(404).json({ error: "Escrow not found" });
  if (detail.buyer?.whatsappNumber !== parsed.data.actorWhatsapp) {
    return res.status(403).json({ error: "Only the escrow buyer can simulate sandbox funding" });
  }
  if (
    detail.escrow.status !== "PENDING_PAYMENT" ||
    !detail.escrow.paymentProvider?.endsWith("_sandbox_override") ||
    !isSandboxPaymentReference(detail.escrow.paymentReference)
  ) {
    return res.status(409).json({ error: "Sandbox funding is available only for pending sandbox payment references" });
  }
  const sandboxFundingAmount = await expectedFundingAmount(detail.escrow);
  const funded = await escrowStore.markFundedByPaymentReference(detail.escrow.paymentReference!, {
    amount: sandboxFundingAmount,
    escrowAmount: detail.escrow.amount,
    currency: detail.escrow.currency,
    status: "sandbox_success",
    channel: "sandbox_test_override",
  });
  if (!funded) return res.status(409).json({ error: "Sandbox payment reference could not be funded" });
  res.status(200).json(await buildEscrowDetail(req.params.escrowId));
});

router.post("/api/escrows/:escrowId/pay-from-balance", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.actorWhatsapp) {
      return res.status(400).json({ error: "Buyer WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
    }
    const detail = await buildEscrowDetail(req.params.escrowId);
    if (!detail) return res.status(404).json({ error: "Escrow not found" });
    if (!whatsappIdentityMatches(detail.buyer?.whatsappNumber, parsed.data.actorWhatsapp)) {
      return res.status(403).json({ error: "Only the escrow buyer can fund this agreement from balance" });
    }
    if (!["PENDING_PAYMENT", "PENDING_ACCEPTANCE"].includes(detail.escrow.status)) {
      return res.status(409).json({ error: "This agreement is not pending payment" });
    }

    const paymentRef = detail.escrow.paymentReference || `bal-${detail.escrow.escrowId}`;
    if (!detail.escrow.paymentReference) {
      await escrowStore.attachPayment({
        escrowId: detail.escrow.escrowId,
        paymentReference: paymentRef,
        paymentProvider: "sivan_balance",
        status: "PENDING_PAYMENT",
      });
    }

    const funded = await escrowStore.markFundedByPaymentReference(paymentRef, {
      amount: detail.escrow.amount,
      escrowAmount: detail.escrow.amount,
      currency: detail.escrow.currency,
      status: "balance_debit_success",
      provider: "sivan_balance",
    });

    if (!funded) return res.status(409).json({ error: "Could not mark agreement as funded" });

    const updated = await buildEscrowDetail(req.params.escrowId);
    if (updated) {
      await notifyEscrowParticipants(
        updated.escrow,
        participantLifecycleMessage(
          updated.escrow,
          `Payment of ${updated.escrow.amount} ${updated.escrow.currency} was confirmed from Sivan Balance.`,
          `Work is now in progress.`
        )
      );
    }

    res.status(200).json({ success: true, escrow: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Balance payment failed" });
  }
});

router.post("/api/escrows/:escrowId/release-request", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid release payload", details: formatZodError(parsed.error) });
    }
    const settings = await settingsStore.getSettings();
    const updated = await escrowStore.requestRelease(
      req.params.escrowId,
      parsed.data.actorWhatsapp || "unknown",
      "whatsapp_dm",
      {
        nairaHighValueAmount: settings.nairaHighValueReviewAmount,
        usdcHighValueAmount: settings.usdcHighValueReviewAmount,
      }
    );
    if (updated.currency === "USDC" && updated.status === "RELEASED" && updated.paymentReference) {
      try {
        const paymentProvider = updated.paymentProvider || "x402";
        if (paymentProvider === "sap") {
          const sap = paymentRouter.getSapAgent();
          if (!sap) throw new Error("Synapse SAP agent is not configured");
          await sap.releaseEscrow(updated.paymentReference);
        } else {
          await paymentRouter.settleUsdcPayment(updated.paymentReference);
        }
      } catch (err: any) {
        captureOperationalError("Autonomous USDC release transaction failed", err);
      }
    }

    await notifyEscrowParticipants(
      updated,
      participantLifecycleMessage(
        updated,
        updated.status === "PENDING_RELEASE" ? "Completion confirmation is under provider review." : "Completion confirmation needs manual review.",
        updated.status === "PENDING_RELEASE"
          ? "Sivan will notify both parties when the service agreement is closed."
          : "Sivan support will review this before the agreement is closed."
      )
    );
    res.status(200).json(updated);
  } catch (err: any) {
    if (/payout account/i.test(err.message || "")) {
      capturePaymentWarning("Release requested but seller payout account is missing or unverified", {
        escrowId: req.params.escrowId,
        actorWhatsapp: req.body?.actorWhatsapp,
      });
    }
    res.status(400).json({ error: err.message || "Release request failed" });
  }
});

router.post("/api/escrows/:escrowId/complete", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.actorWhatsapp) {
      return res.status(400).json({ error: "Buyer WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
    }
    const updated = await escrowStore.completeEscrow(
      req.params.escrowId,
      parsed.data.actorWhatsapp,
      "whatsapp_dm"
    );
    await notifyEscrowParticipants(
      updated,
      participantLifecycleMessage(
        updated,
        "Work has been confirmed as completed by the buyer.",
        "Payout release is being processed to the seller's payout account."
      )
    );
    res.status(200).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Completion confirmation failed" });
  }
});

router.post("/api/escrows/:escrowId/delivery/start", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Seller identity is required", details: formatZodError(parsed.error) });
    }
    const actor = parsed.data.actorWhatsapp || parsed.data.actorUserId;
    if (!actor) {
      return res.status(400).json({ error: "Seller identity is required" });
    }
    const escrow = await escrowStore.getEscrowById(req.params.escrowId);
    if (!escrow) return res.status(404).json({ error: "Escrow not found" });
    const role = await roleForEscrowParticipant(escrow, parsed.data.actorWhatsapp, parsed.data.actorUserId);
    if (role !== "seller") return res.status(403).json({ error: "Only the seller can submit delivery proof" });

    if (!["FUNDED", "IN_PROGRESS"].includes(escrow.status)) {
      return res.status(400).json({ error: `Delivery proof can only be submitted after funding, current status is ${escrow.status}` });
    }
    await escrowStore.addEvent({
      escrowId: escrow.escrowId,
      actor,
      actorRole: "seller",

      channel: "whatsapp_dm",
      previousStatus: escrow.status,
      nextStatus: escrow.status,
      eventType: "seller_delivery_requested",
      reason: "Seller started delivery proof submission",
      metadata: JSON.stringify({ source: "whatsapp" }),
    });
    res.status(200).json(await buildEscrowDetail(escrow.escrowId));
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Delivery proof could not be started" });
  }
});

router.post("/api/escrows/:escrowId/delivery/proof", requireCoreApiAuth, async (req, res) => {
  const parsed = deliveryProofSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid delivery proof payload", details: formatZodError(parsed.error) });
  }
  const escrow = await escrowStore.getEscrowById(req.params.escrowId);
  if (!escrow) return res.status(404).json({ error: "Escrow not found" });
  const role = await roleForEscrowParticipant(escrow, parsed.data.actorWhatsapp, parsed.data.actorUserId);
  if (role !== "seller") return res.status(403).json({ error: "Only the seller can submit delivery proof" });
  // The schema guarantees at least one identity; prefer the phone so existing
  // audit rows keep the same actor format they have always had.
  const actor = parsed.data.actorWhatsapp || parsed.data.actorUserId!;

  if (!["FUNDED", "IN_PROGRESS", "DELIVERED"].includes(escrow.status)) {
    return res.status(400).json({ error: `Delivery proof can only be submitted after funding, current status is ${escrow.status}` });
  }
  if (!externalDeliveryLinksAllowed() && containsExternalLink(parsed.data.summary)) {
    return res.status(400).json({ error: "External delivery links are not accepted during the MVP. Upload the file or describe the delivery instead." });
  }
  if (!parsed.data.summary.trim() && !parsed.data.media.length) {
    return res.status(400).json({ error: "Delivery proof must include a message or media" });
  }
  try {
    const detail = await recordDeliveryProof({
      escrow,
      actor,
      summary: parsed.data.summary,

      media: parsed.data.media,
      notifyBuyer: parsed.data.notifyBuyer,
    });
    res.status(201).json(detail);
  } catch (err: any) {

    res.status(400).json({ error: err.message || "Delivery proof could not be recorded" });
  }
});

router.post("/api/escrows/:escrowId/cancel", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success || !parsed.data.actorWhatsapp) {
      return res.status(400).json({ error: "Buyer WhatsApp is required", details: parsed.success ? [] : formatZodError(parsed.error) });
    }
    const updated = await escrowStore.cancelUnfundedEscrow(
      req.params.escrowId,
      parsed.data.actorWhatsapp,
      "whatsapp_dm"
    );
    res.status(200).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Escrow cancellation failed" });
  }
});

router.post("/api/escrows/:escrowId/dispute", requireCoreApiAuth, async (req, res) => {
  try {
    const parsed = escrowActionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid dispute payload", details: formatZodError(parsed.error) });
    }
    const updated = await escrowStore.markDisputed(
      req.params.escrowId,
      parsed.data.actorWhatsapp || "unknown",
      "whatsapp_dm",
      parsed.data.reason
    );
    await opsStore.createSupportCase({
      subject: `Dispute opened for ${req.params.escrowId}`,
      priority: "high",
      relatedEscrowId: req.params.escrowId,
      relatedUser: parsed.data.actorWhatsapp,
      source: "whatsapp_dispute",
      createdBy: parsed.data.actorWhatsapp || "whatsapp",
      note: parsed.data.reason || "Dispute opened from WhatsApp",
    });
    res.status(200).json(updated);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Dispute failed" });
  }
});

router.post("/api/escrows/:escrowId/dispute/evidence", requireCoreApiAuth, async (req, res) => {
  const parsed = participantDisputeEvidenceSchema.safeParse(req.body || {});
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid dispute evidence payload", details: formatZodError(parsed.error) });
  }
  const escrow = await escrowStore.getEscrowById(req.params.escrowId);
  if (!escrow) return res.status(404).json({ error: "Escrow not found" });
  if (escrow.status !== "DISPUTED") {
    return res.status(400).json({ error: `Evidence can only be added while escrow is DISPUTED, current status is ${escrow.status}` });
  }
  const role = await roleForEscrowParticipant(escrow, parsed.data.actorWhatsapp, parsed.data.actorUserId);
  if (!role) return res.status(403).json({ error: "Only escrow participants can submit dispute evidence" });
  const detail = await recordDisputeEvidence({
    escrow,
    actor: parsed.data.actorWhatsapp || parsed.data.actorUserId!,
    actorRole: role,

    channel: "whatsapp_dm",
    evidence: { ...parsed.data, source: parsed.data.source || role },
  });
  res.status(201).json(detail);
});

router.get("/api/escrows/payment-ref/:reference", async (req, res) => {
  try {
    const reference = String(req.params.reference || "").trim();
    if (!reference) {
      return res.status(400).json({ error: "Payment reference is required" });
    }

    const escrow = await escrowStore.findEscrowByPaymentReference(reference);
    if (!escrow) {
      return res.status(404).json({ error: "Escrow not found" });
    }

    const payoutQuote = await calculateEscrowPayoutQuote(escrow.amount, escrow.currency, escrow.feePayer);
    res.status(200).json({
      escrowId: escrow.escrowId,
      purpose: escrow.purpose,
      amount: escrow.amount,
      currency: escrow.currency,
      status: escrow.status,
      paymentProvider: escrow.paymentProvider,
      paymentReference: escrow.paymentReference,
      feePayer: escrow.feePayer || "buyer",
      platformFeeAmount: payoutQuote.platformFeeAmount,
      totalWithFee: payoutQuote.totalWithFee,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to lookup payment reference" });
  }
});

/**
 * GET /api/escrows/fee-quote
 * Returns dynamic Service Agreement fee calculated directly from active Admin platform settings.
 */
router.get("/api/escrows/fee-quote", async (req, res) => {
  try {
    const currencyStr = String(req.query.currency || "USDC").toUpperCase();
    const amount = parseFloat(String(req.query.amount || "10"));

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ error: "Invalid agreement amount. Must be greater than 0." });
    }

    const settings = await settingsStore.getSettings();
    const isNaira = currencyStr === "CNGN" || currencyStr === "NGN" || currencyStr === "NAIRA";
    const feeCalculation = isNaira
      ? settingsStore.calculateNairaFee(amount, settings)
      : settingsStore.calculateUSDCFee(amount, settings);

    const protocolFee = feeCalculation.totalPlatformFee;
    const netAmount = Math.max(0, parseFloat((amount - protocolFee).toFixed(6)));
    const feeFormula = isNaira
      ? (settings.nairaFeeModel === "tiered" ? "Tiered Platform Schedule" : `${settings.nairaFeePercent}% + ₦${settings.nairaFeeFixed}`)
      : `${settings.usdcFeePercent}% + $${settings.usdcFeeFixed.toFixed(2)}`;

    return res.status(200).json({
      status: "ok",
      source: "sivan_core_settings_store",
      currency: currencyStr,
      amount,
      protocolFee,
      netAmount,
      totalWithFee: feeCalculation.totalWithFee,
      feeFormula,
      settingsVersion: settings.version,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to calculate dynamic agreement fee" });
  }
});

/**
 * GET /api/escrows/settings/limits
 * Returns dynamic platform limits and fee settings directly from active Admin store.
 */
router.get("/api/escrows/settings/limits", async (_req, res) => {
  try {
    const settings = await settingsStore.getSettings();
    let parsedTiers = undefined;
    if (settings.nairaFeeTiers) {
      try {
        parsedTiers = JSON.parse(settings.nairaFeeTiers);
      } catch {}
    }
    return res.status(200).json({
      status: "ok",
      source: "sivan_core_settings_store",
      minNairaAmount: settings.minNairaAmount,
      maxNairaAmount: settings.maxNairaAmount,
      minUsdcAmount: settings.minUsdcAmount,
      maxUsdcAmount: settings.maxUsdcAmount,
      usdcFeePercent: settings.usdcFeePercent,
      usdcFeeFixed: settings.usdcFeeFixed,
      nairaFeePercent: settings.nairaFeePercent,
      nairaFeeFixed: settings.nairaFeeFixed,
      nairaFeeModel: settings.nairaFeeModel,
      nairaFeeTiers: parsedTiers,
      version: settings.version,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message || "Failed to fetch settings limits" });
  }
});

export default router;

