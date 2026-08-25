import { Router } from "express";
import { config } from "../config";
import crypto from "crypto";
import { formatZodError, paystackWebhookSchema } from "../validation";
import {
  paystackPaymentProvider,
  monnifyPaymentProvider,
  palmpayPaymentProvider,
  flutterwavePaymentProvider,
  nombaPaymentProvider,
  workflowStore,
  escrowStore,
  orchestrator,
  opsStore,
} from "../context";
import {
  capturePaymentWarning,
  captureOperationalError,
} from "../services/monitoring";
import {
  parseMaybeJson,
  firstPresent,
  reconcileEscrowPayment,
  notifyEscrowFundedParticipants,
  expectedFundingAmount,
} from "../services/escrowService";
import { formatTaskSummary, notifyWhatsAppBot } from "../services/notificationService";
import { getProviderForEscrow } from "../services/paymentService";
import { normalizeSettlementEvent, normalizeVerifiedPaymentEvent } from "../services/paymentEventNormalizer";
import { NombaPayoutClient } from "../services/nombaPayoutClient";
import { PalmPayPayoutClient } from "../services/palmpayPayoutClient";
import { info, warn } from "../lib/logger";
import express from "express";

const router = Router();
const nombaPayoutClient = new NombaPayoutClient(config.databaseMode);
const palmPayPayoutClient = new PalmPayPayoutClient(config.databaseMode);

// Stamp every inbound webhook with the active database mode.
// In Option A (separate Render services), each service only ever processes webhooks
// for its own database. This log line makes mode visible in all webhook traces.
router.use((req, _res, next) => {
  req.headers["x-sivan-db-mode"] = config.databaseMode;
  info(`Webhook received [mode=${config.databaseMode}]`, {
    path: req.path,
    method: req.method,
    mode: config.databaseMode,
  });
  next();
});

function safeSecretEquals(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function twilioDebuggerSecretValid(req: express.Request) {
  const configured = process.env.TWILIO_DEBUGGER_WEBHOOK_SECRET || "";
  // Fail closed. An unset secret previously left this endpoint open in every
  // non-production deploy (and whenever NODE_ENV was simply unset). The caller
  // surfaces a 503 in that case, so a missing secret is reported as a
  // configuration error rather than silently accepting unauthenticated events.
  if (!configured) return false;
  const provided = String(req.query.secret || req.headers["x-sivan-twilio-debugger-secret"] || "");
  return Boolean(provided) && safeSecretEquals(provided, configured);
}

router.post("/webhooks/twilio-debugger", async (req, res) => {
  if (!twilioDebuggerSecretValid(req)) {
    return res.status(process.env.TWILIO_DEBUGGER_WEBHOOK_SECRET ? 401 : 503).json({
      error: process.env.TWILIO_DEBUGGER_WEBHOOK_SECRET ? "Unauthorized" : "TWILIO_DEBUGGER_WEBHOOK_SECRET is required",
    });
  }

  const body = req.body || {};
  const payload = parseMaybeJson(body.Payload || body.payload || body.EventPayload || body.eventPayload || body);
  const payloadObject = payload && typeof payload === "object" ? payload : {};
  const level = String(firstPresent(body.Level, body.level, payloadObject.level, payloadObject.Level, "warning")).toUpperCase();
  const eventSid = String(firstPresent(body.Sid, body.sid, payloadObject.sid, payloadObject.Sid, payloadObject.event_sid, payloadObject.eventSid, "unknown"));
  const accountSid = firstPresent(body.AccountSid, body.account_sid, body.accountSid, payloadObject.account_sid, payloadObject.AccountSid, payloadObject.accountSid, "unknown");
  const errorCode = firstPresent(payloadObject.error_code, payloadObject.errorCode, payloadObject.ErrorCode, payloadObject.code, payloadObject.Code, body.ErrorCode, body.error_code, "unknown");
  const message = firstPresent(
    payloadObject.message,
    payloadObject.Message,
    payloadObject.description,
    payloadObject.Description,
    payloadObject.error_description,
    payloadObject.errorDescription,
    body.Message,
    body.message,
    body.Description,
    body.description,
    "Twilio Debugger event received"
  );
  const hasSpecificPayload = eventSid !== "unknown" || accountSid !== "unknown" || errorCode !== "unknown" || message !== "Twilio Debugger event received";
  if (!hasSpecificPayload) {
    warn("Twilio Debugger event received without structured details", {
      bodyKeys: Object.keys(body).slice(0, 20),
      rawBodyLength: ((req as any).rawBody || "").length,
    });
    return res.status(200).json({ received: true, ignored: "missing_structured_details" });
  }

  capturePaymentWarning(`Twilio Debugger ${level}: ${message}`, {
    provider: "twilio",
    eventSid,
    accountSid,
    parentAccountSid: firstPresent(body.ParentAccountSid, body.parent_account_sid, payloadObject.parent_account_sid, payloadObject.ParentAccountSid),
    timestamp: firstPresent(body.Timestamp, body.timestamp, payloadObject.timestamp, payloadObject.Timestamp, new Date().toISOString()),
    level,
    errorCode,
    moreInfo: firstPresent(payloadObject.more_info, payloadObject.MoreInfo, payloadObject.moreInfo, body.MoreInfo, body.more_info),
  });

  res.status(200).json({ received: true });
});

router.post("/webhooks/paystack", async (req, res) => {
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  let normalizedPaymentReference = "";
  try {
    const signature = String(req.headers["x-paystack-signature"] || "");
    if (!signature) {
      capturePaymentWarning("Missing Paystack webhook signature header", { path: req.path });
      return res.status(400).send({ error: "Missing signature header" });
    }

    const verified = await paystackPaymentProvider.verifyWebhookSignature(rawBody, signature);
    if (!verified) {
      capturePaymentWarning("Invalid Paystack webhook signature", { paymentReference: req.body?.data?.reference || "unknown" });
      return res.status(400).send({ error: "Invalid webhook signature" });
    }

    const parsedEvent = paystackWebhookSchema.safeParse(req.body);
    if (!parsedEvent.success) {
      capturePaymentWarning("Invalid Paystack webhook payload", { details: formatZodError(parsedEvent.error) });
      return res.status(400).send({ error: "Invalid webhook payload", details: formatZodError(parsedEvent.error) });
    }

    const event = parsedEvent.data;
    const normalizedWebhook = paystackPaymentProvider.normalizeWebhook(event);
    if (normalizedWebhook.paymentReference === "ping") {
      return res.status(200).send({ status: "ping_received" });
    }

    normalizedPaymentReference = normalizedWebhook.paymentReference;
    info("Paystack webhook received", normalizedWebhook.eventType, normalizedWebhook.paymentReference);
    await workflowStore.addWebhookEvent(
      normalizedWebhook.eventId || crypto.randomUUID(),
      normalizedWebhook.paymentReference,
      `paystack:${normalizedWebhook.eventType}`,
      JSON.stringify(event)
    );

    // Handle Paystack Transfer (Payout) Webhook Events
    if (normalizedWebhook.eventType.startsWith("transfer.")) {
      const transferReference = String(event.data?.reference || normalizedWebhook.paymentReference || "").trim();
      const transferCode = String(event.data?.transfer_code || "").trim();

      const relatedTransaction =
        (transferReference ? await escrowStore.getTransactionByProviderReference("paystack", transferReference) : null) ||
        (transferCode ? await escrowStore.getTransactionByProviderReference("paystack", transferCode) : null);

      if (relatedTransaction) {
        await escrowStore.addEvent({
          escrowId: relatedTransaction.escrowId,
          actor: "paystack",
          actorRole: "payment_provider",
          channel: "webhook",
          previousStatus: undefined,
          nextStatus: undefined,
          eventType: "payout_provider_event_received",
          reason: normalizedWebhook.eventType,
          metadata: {
            provider: "paystack",
            reference: transferReference,
            transferCode,
            payoutStatus: event.data?.status || normalizedWebhook.eventType,
            payload: event,
          },
        });

        if (normalizedWebhook.eventType === "transfer.success") {
          info("Paystack transfer completed successfully", {
            escrowId: relatedTransaction.escrowId,
            reference: transferReference,
            transferCode,
          });
        } else if (normalizedWebhook.eventType === "transfer.failed" || normalizedWebhook.eventType === "transfer.reversed") {
          capturePaymentWarning(`Paystack transfer payout failed/reversed: ${normalizedWebhook.eventType}`, {
            escrowId: relatedTransaction.escrowId,
            reference: transferReference,
            transferCode,
            eventType: normalizedWebhook.eventType,
          });
          await opsStore.enqueueJob("payout_review", {
            escrowId: relatedTransaction.escrowId,
            provider: "paystack",
            reference: transferReference || transferCode,
            eventType: normalizedWebhook.eventType,
            reason: `paystack_transfer_${normalizedWebhook.eventType.replace("transfer.", "")}`,
          }, { maxAttempts: 3 });
        }
      } else {
        capturePaymentWarning("Paystack transfer webhook did not match any Sivan payout transaction", {
          reference: transferReference,
          transferCode,
          eventType: normalizedWebhook.eventType,
        });
      }

      return res.status(200).send({ status: "received" });
    }

    if (normalizedWebhook.eventType !== "charge.success") {
      return res.status(200).send({ status: "received" });
    }

    const escrow = await escrowStore.findEscrowByPaymentReference(normalizedWebhook.paymentReference);
    if (!escrow) {
      capturePaymentWarning("Paystack webhook did not match any escrow", {
        paymentReference: normalizedWebhook.paymentReference,
        eventType: normalizedWebhook.eventType,
      });
      return res.status(202).send({ status: "unmatched" });
    }
    if (escrow.paymentProvider && escrow.paymentProvider !== "paystack" && escrow.paymentProvider !== "paystack_sandbox_override") {
      capturePaymentWarning("Paystack webhook matched escrow with different provider", {
        escrowId: escrow.escrowId,
        escrowProvider: escrow.paymentProvider,
        paymentReference: normalizedWebhook.paymentReference,
      });
      return res.status(409).send({ error: "Payment reference belongs to a different provider" });
    }

    const transaction = await paystackPaymentProvider.verifyPayment(normalizedWebhook.paymentReference);
    if (transaction.paymentReference !== normalizedWebhook.paymentReference) {
      capturePaymentWarning("Paystack verification reference mismatch", {
        webhookReference: normalizedWebhook.paymentReference,
        verifiedReference: transaction.paymentReference,
      });
      return res.status(202).send({ status: "verification_reference_mismatch" });
    }

    const paymentEvent = normalizeVerifiedPaymentEvent({
      webhook: normalizedWebhook,
      verifiedPayment: transaction,
      escrow,
      expectedAmount: await expectedFundingAmount(escrow),
      signatureVerified: true,
      raw: event,
    });
    const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "webhook", paymentEvent);
    if (funded.status === "IN_PROGRESS") {
      info("Escrow funded from verified Paystack webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
      await notifyEscrowFundedParticipants(funded);
    } else if (funded.status === "REVIEW_REQUIRED") {
      info("Escrow payment moved to review from Paystack webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
    }
    return res.status(200).send({ status: "received" });
  } catch (err: any) {
    if (normalizedPaymentReference) {
      try {
        await opsStore.enqueueJob("webhook_recovery", {
          paymentReference: normalizedPaymentReference,
          provider: "paystack",
          eventType: req.body?.event || "unknown",
          reason: "paystack_webhook_processing_failed",
        }, { maxAttempts: 8 });
      } catch (enqueueErr: any) {
        captureOperationalError("Failed to enqueue Paystack webhook recovery job", enqueueErr, { paymentReference: normalizedPaymentReference });
      }
    }
    captureOperationalError("Paystack webhook processing failed", err, { paymentReference: normalizedPaymentReference || "unknown" });
    return res.status(500).send({ error: "Webhook processing failed" });
  }
});

router.post("/webhooks/monnify", async (req, res) => {
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  let normalizedPaymentReference = "";
  try {
    const signature = req.headers["monnify-signature"] as string;
    if (!signature) {
      capturePaymentWarning("Missing Monnify webhook signature header", { path: req.path });
      return res.status(400).send({ error: "Missing signature header" });
    }

    const verified = await monnifyPaymentProvider.verifyWebhookSignature(rawBody, signature);
    if (!verified) {
      capturePaymentWarning("Invalid Monnify webhook signature", { paymentReference: req.body?.eventData?.paymentReference || "unknown" });
      return res.status(400).send({ error: "Invalid webhook signature" });
    }

    let normalizedWebhook;
    try {
      normalizedWebhook = monnifyPaymentProvider.normalizeWebhook(req.body);
    } catch (err: any) {
      capturePaymentWarning("Invalid Monnify webhook payload: " + err.message, { path: req.path });
      return res.status(400).send({ error: err.message });
    }

    if (normalizedWebhook.paymentReference === "ping") {
      return res.status(200).send({ status: "ping_received" });
    }

    normalizedPaymentReference = normalizedWebhook.paymentReference;
    info("Monnify webhook received", normalizedWebhook.eventType, normalizedWebhook.paymentReference);
    await workflowStore.addWebhookEvent(
      normalizedWebhook.eventId || crypto.randomUUID(),
      normalizedWebhook.paymentReference,
      `monnify:${normalizedWebhook.eventType}`,
      JSON.stringify(req.body)
    );

    if (normalizedWebhook.eventType === "SETTLEMENT") {
      const transactions = Array.isArray(req.body?.eventData?.transactions) ? req.body.eventData.transactions : [];
      for (const transaction of transactions) {
        const paymentReference = String(transaction.paymentReference || transaction.product?.reference || "").trim();
        if (!paymentReference) continue;
        const escrow = await escrowStore.findEscrowByPaymentReference(paymentReference);
        if (!escrow) continue;
        const settlementEvent = normalizeSettlementEvent({
          provider: "monnify",
          eventId: normalizedWebhook.eventId,
          escrowReference: escrow.escrowId,
          providerReference: String(req.body?.eventData?.settlementReference || paymentReference),
          amount: Number(req.body?.eventData?.amount || transaction.amount || 0),
          currency: "NGN",
          raw: req.body,
          signatureVerified: true,
        });
        await escrowStore.addEvent({
          escrowId: escrow.escrowId,
          actor: "monnify",
          actorRole: "payment_provider",
          channel: "webhook",
          previousStatus: escrow.status,
          nextStatus: escrow.status,
          eventType: "settlement_received",
          reason: req.body?.eventData?.settlementReference || "monnify_settlement",
          metadata: {
            normalizedEvent: settlementEvent,
            provider: "monnify",
            settlementReference: req.body?.eventData?.settlementReference,
            settlementAmount: req.body?.eventData?.amount,
            transaction,
          },
        });
      }
      return res.status(200).send({ status: "received" });
    }

    if (normalizedWebhook.eventType !== "SUCCESSFUL_TRANSACTION") {
      return res.status(200).send({ status: "received" });
    }

    const escrow = await escrowStore.findEscrowByPaymentReference(normalizedWebhook.paymentReference);
    if (!escrow) {
      capturePaymentWarning("Monnify webhook did not match any escrow", {
        paymentReference: normalizedWebhook.paymentReference,
        eventType: normalizedWebhook.eventType,
      });
      return res.status(202).send({ status: "unmatched" });
    }
    if (escrow.paymentProvider && escrow.paymentProvider !== "monnify") {
      capturePaymentWarning("Monnify webhook matched escrow with different provider", {
        escrowId: escrow.escrowId,
        escrowProvider: escrow.paymentProvider,
        paymentReference: normalizedWebhook.paymentReference,
      });
      return res.status(409).send({ error: "Payment reference belongs to a different provider" });
    }

    const transaction = await monnifyPaymentProvider.verifyPayment(normalizedWebhook.paymentReference);
    if (transaction.paymentReference !== normalizedWebhook.paymentReference) {
      capturePaymentWarning("Monnify verification reference mismatch", {
        webhookReference: normalizedWebhook.paymentReference,
        verifiedReference: transaction.paymentReference,
      });
      return res.status(202).send({ status: "verification_reference_mismatch" });
    }

    const paymentEvent = normalizeVerifiedPaymentEvent({
      webhook: normalizedWebhook,
      verifiedPayment: transaction,
      escrow,
      expectedAmount: await expectedFundingAmount(escrow),
      signatureVerified: true,
      raw: req.body,
    });
    const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "webhook", paymentEvent);
    if (funded.status === "IN_PROGRESS") {
      info("Escrow funded from verified Monnify webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
      await notifyEscrowFundedParticipants(funded);
    } else if (funded.status === "REVIEW_REQUIRED") {
      info("Escrow payment moved to review from Monnify webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
    }
    return res.status(200).send({ status: "received" });
  } catch (err: any) {
    if (normalizedPaymentReference) {
      try {
        await opsStore.enqueueJob("webhook_recovery", {
          paymentReference: normalizedPaymentReference,
          provider: "monnify",
          eventType: req.body?.eventType || "unknown",
          reason: "monnify_webhook_processing_failed",
        }, { maxAttempts: 8 });
      } catch (enqueueErr: any) {
        captureOperationalError("Failed to enqueue Monnify webhook recovery job", enqueueErr, { paymentReference: normalizedPaymentReference });
      }
    }
    captureOperationalError("Monnify webhook processing failed", err, { paymentReference: normalizedPaymentReference || "unknown" });
    return res.status(500).send({ error: "Webhook processing failed" });
  }
});

router.post("/webhooks/palmpay", async (req, res) => {
  let normalizedPaymentReference = "";
  try {
    const signature = String(req.body?.sign || req.headers["signature"] || "");
    if (!signature) {
      capturePaymentWarning("Missing PalmPay webhook signature", { path: req.path });
      return res.status(400).send("missing signature");
    }

    const verified = typeof (palmpayPaymentProvider as any).verifyWebhookPayload === "function"
      ? (palmpayPaymentProvider as any).verifyWebhookPayload(req.body || {}, signature)
      : false;
    if (!verified) {
      capturePaymentWarning("Invalid PalmPay webhook signature", { paymentReference: req.body?.orderId || "unknown" });
      return res.status(400).send("invalid signature");
    }

    info("PalmPay signature verification PASSED", { orderId: req.body?.orderId });
    info("PalmPay raw webhook payload", { body: req.body });

    let normalizedWebhook;
    try {
      normalizedWebhook = palmpayPaymentProvider.normalizeWebhook(req.body);
    } catch (err: any) {
      capturePaymentWarning("Invalid PalmPay webhook payload: " + err.message, { path: req.path });
      return res.status(400).send(err.message);
    }

    normalizedPaymentReference = normalizedWebhook.paymentReference;
    info("PalmPay webhook received", normalizedWebhook.eventType, normalizedWebhook.paymentReference);
    await workflowStore.addWebhookEvent(
      normalizedWebhook.eventId || crypto.randomUUID(),
      normalizedWebhook.paymentReference,
      `palmpay:${normalizedWebhook.eventType}`,
      JSON.stringify(req.body)
    );

    if (normalizedWebhook.eventType !== "order.2") {
      return res.status(200).send("success");
    }

    const escrow = await escrowStore.findEscrowByPaymentReference(normalizedWebhook.paymentReference);
    if (!escrow) {
      capturePaymentWarning("PalmPay webhook did not match any escrow", {
        paymentReference: normalizedWebhook.paymentReference,
        eventType: normalizedWebhook.eventType,
      });
      return res.status(202).send("success");
    }
    if (escrow.paymentProvider && escrow.paymentProvider !== "palmpay") {
      capturePaymentWarning("PalmPay webhook matched escrow with different provider", {
        escrowId: escrow.escrowId,
        escrowProvider: escrow.paymentProvider,
        paymentReference: normalizedWebhook.paymentReference,
      });
      return res.status(409).send("provider mismatch");
    }

    const transaction = await palmpayPaymentProvider.verifyPayment(normalizedWebhook.paymentReference);
    if (transaction.paymentReference !== normalizedWebhook.paymentReference) {
      capturePaymentWarning("PalmPay verification reference mismatch", {
        webhookReference: normalizedWebhook.paymentReference,
        verifiedReference: transaction.paymentReference,
      });
      return res.status(202).send("success");
    }

    const paymentEvent = normalizeVerifiedPaymentEvent({
      webhook: normalizedWebhook,
      verifiedPayment: transaction,
      escrow,
      expectedAmount: await expectedFundingAmount(escrow),
      signatureVerified: true,
      raw: req.body,
    });
    const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "webhook", paymentEvent);
    if (funded.status === "IN_PROGRESS") {
      info("Escrow funded from verified PalmPay webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
      await notifyEscrowFundedParticipants(funded);
    } else if (funded.status === "REVIEW_REQUIRED") {
      info("Escrow payment moved to review from PalmPay webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
    }
    return res.status(200).send("success");
  } catch (err: any) {
    if (normalizedPaymentReference) {
      try {
        await opsStore.enqueueJob("webhook_recovery", {
          paymentReference: normalizedPaymentReference,
          provider: "palmpay",
          eventType: `order.${req.body?.orderStatus ?? "unknown"}`,
          reason: "palmpay_webhook_processing_failed",
        }, { maxAttempts: 8 });
      } catch (enqueueErr: any) {
        captureOperationalError("Failed to enqueue PalmPay webhook recovery job", enqueueErr, { paymentReference: normalizedPaymentReference });
      }
    }
    captureOperationalError("PalmPay webhook processing failed", err, { paymentReference: normalizedPaymentReference || req.body?.orderId || "unknown" });
    return res.status(500).send("webhook processing failed");
  }
});

router.post("/webhooks/palmpay/payout", async (req, res) => {
  let reference = "";
  try {
    const signature = String(req.body?.sign || req.headers["signature"] || "");
    if (!signature) {
      capturePaymentWarning("Missing PalmPay payout webhook signature", { path: req.path });
      return res.status(400).send("missing signature");
    }

    if (!palmPayPayoutClient.verifyWebhookSignature(req.body || {}, signature)) {
      capturePaymentWarning("Invalid PalmPay payout webhook signature", {
        orderId: req.body?.orderId || "unknown",
        orderNo: req.body?.orderNo || "unknown",
      });
      return res.status(400).send("invalid signature");
    }

    const normalizedWebhook = palmPayPayoutClient.normalizeWebhook(req.body);
    reference = normalizedWebhook.orderNo || normalizedWebhook.orderId;
    await workflowStore.addWebhookEvent(
      normalizedWebhook.eventId || crypto.randomUUID(),
      reference,
      `palmpay:${normalizedWebhook.eventType}`,
      JSON.stringify(req.body)
    );

    const relatedTransaction =
      await escrowStore.getTransactionByProviderReference("palmpay", reference) ||
      (normalizedWebhook.orderId ? await escrowStore.getTransactionByProviderReference("palmpay", normalizedWebhook.orderId) : null);

    if (relatedTransaction) {
      await escrowStore.addEvent({
        escrowId: relatedTransaction.escrowId,
        actor: "palmpay",
        actorRole: "payment_provider",
        channel: "webhook",
        previousStatus: undefined,
        nextStatus: undefined,
        eventType: "payout_provider_event_received",
        reason: normalizedWebhook.eventType,
        metadata: {
          provider: "palmpay",
          reference,
          payoutStatus: normalizedWebhook.status,
          payload: req.body,
        },
      });
      await opsStore.enqueueJob("payout_review", {
        escrowId: relatedTransaction.escrowId,
        provider: "palmpay",
        reference,
        eventType: normalizedWebhook.eventType,
        reason: "palmpay_payout_webhook_requires_operator_or_requery_confirmation",
      }, { maxAttempts: 3 });
    } else {
      capturePaymentWarning("PalmPay payout webhook did not match a Sivan payout transaction", {
        reference,
        orderId: normalizedWebhook.orderId || "unknown",
        orderNo: normalizedWebhook.orderNo || "unknown",
        eventType: normalizedWebhook.eventType,
      });
    }

    return res.status(200).send("success");
  } catch (err: any) {
    if (reference) {
      try {
        await opsStore.enqueueJob("payout_review", {
          provider: "palmpay",
          reference,
          reason: "palmpay_payout_webhook_processing_failed",
        }, { maxAttempts: 3 });
      } catch (enqueueErr: any) {
        captureOperationalError("Failed to enqueue PalmPay payout review job", enqueueErr, { reference });
      }
    }
    captureOperationalError("PalmPay payout webhook processing failed", err, { reference: reference || req.body?.orderId || "unknown" });
    return res.status(500).send("webhook processing failed");
  }
});

router.post("/webhooks/flutterwave", async (req, res) => {
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  let normalizedPaymentReference = "";
  try {
    const signature = String(
      req.headers["verif-hash"] ||
      req.headers["flutterwave-signature"] ||
      req.headers["x-flutterwave-signature"] ||
      ""
    );
    if (!signature) {
      capturePaymentWarning("Missing Flutterwave webhook signature header", { path: req.path });
      return res.status(400).send({ error: "Missing signature header" });
    }

    const verified = await flutterwavePaymentProvider.verifyWebhookSignature(rawBody, signature);
    if (!verified) {
      capturePaymentWarning("Invalid Flutterwave webhook signature", { paymentReference: req.body?.data?.reference || "unknown" });
      return res.status(400).send({ error: "Invalid webhook signature" });
    }

    info("Flutterwave signature verification PASSED", { reference: req.body?.data?.reference });
    info("Flutterwave raw webhook payload", { body: req.body });

    let normalizedWebhook;
    try {
      normalizedWebhook = flutterwavePaymentProvider.normalizeWebhook(req.body);
    } catch (err: any) {
      capturePaymentWarning("Invalid Flutterwave webhook payload: " + err.message, { path: req.path });
      return res.status(400).send({ error: err.message });
    }

    if (normalizedWebhook.paymentReference === "ping") {
      return res.status(200).send({ status: "ping_received" });
    }

    normalizedPaymentReference = normalizedWebhook.paymentReference;
    info("Flutterwave webhook received", normalizedWebhook.eventType, normalizedWebhook.paymentReference);
    await workflowStore.addWebhookEvent(
      normalizedWebhook.eventId || crypto.randomUUID(),
      normalizedWebhook.paymentReference,
      `flutterwave:${normalizedWebhook.eventType}`,
      JSON.stringify(req.body)
    );

    if (normalizedWebhook.eventType !== "charge.completed") {
      return res.status(200).send({ status: "received" });
    }

    const escrow = await escrowStore.findEscrowByPaymentReference(normalizedWebhook.paymentReference);
    if (!escrow) {
      capturePaymentWarning("Flutterwave webhook did not match any escrow", {
        paymentReference: normalizedWebhook.paymentReference,
        eventType: normalizedWebhook.eventType,
      });
      return res.status(202).send({ status: "unmatched" });
    }
    if (escrow.paymentProvider && escrow.paymentProvider !== "flutterwave") {
      capturePaymentWarning("Flutterwave webhook matched escrow with different provider", {
        escrowId: escrow.escrowId,
        escrowProvider: escrow.paymentProvider,
        paymentReference: normalizedWebhook.paymentReference,
      });
      return res.status(409).send({ error: "Payment reference belongs to a different provider" });
    }

    const verificationReference = config.databaseMode === "test"
      ? normalizedWebhook.paymentReference
      : (normalizedWebhook.transactionReference || normalizedWebhook.paymentReference);
    const transaction = await flutterwavePaymentProvider.verifyPayment(verificationReference);
    if (transaction.paymentReference !== normalizedWebhook.paymentReference) {
      capturePaymentWarning("Flutterwave verification reference mismatch", {
        webhookReference: normalizedWebhook.paymentReference,
        verifiedReference: transaction.paymentReference,
      });
      return res.status(202).send({ status: "verification_reference_mismatch" });
    }

    const paymentEvent = normalizeVerifiedPaymentEvent({
      webhook: normalizedWebhook,
      verifiedPayment: transaction,
      escrow,
      expectedAmount: await expectedFundingAmount(escrow),
      signatureVerified: true,
      raw: req.body,
    });
    const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "webhook", paymentEvent);
    if (funded.status === "IN_PROGRESS") {
      info("Escrow funded from verified Flutterwave webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
      await notifyEscrowFundedParticipants(funded);
    } else if (funded.status === "REVIEW_REQUIRED") {
      info("Escrow payment moved to review from Flutterwave webhook", {
        escrowId: funded.escrowId,
        paymentReference: normalizedWebhook.paymentReference,
      });
    }
    return res.status(200).send({ status: "received" });
  } catch (err: any) {
    if (normalizedPaymentReference) {
      try {
        await opsStore.enqueueJob("webhook_recovery", {
          paymentReference: normalizedPaymentReference,
          provider: "flutterwave",
          eventType: req.body?.type || req.body?.event || "unknown",
          reason: "flutterwave_webhook_processing_failed",
        }, { maxAttempts: 8 });
      } catch (enqueueErr: any) {
        captureOperationalError("Failed to enqueue Flutterwave webhook recovery job", enqueueErr, { paymentReference: normalizedPaymentReference });
      }
    }
    captureOperationalError("Flutterwave webhook processing failed", err, { paymentReference: normalizedPaymentReference || "unknown" });
    return res.status(500).send({ error: "Webhook processing failed" });
  }
});

router.post("/webhooks/nomba", async (req, res) => {
  const rawBody = (req as any).rawBody || JSON.stringify(req.body);
  let reference = "";
  try {
    const signature = firstPresent(req.headers["nomba-signature"], req.headers["nomba-sig-value"]) as string | undefined;
    const timestamp = req.headers["nomba-timestamp"] as string | undefined;
    if (!signature) {
      capturePaymentWarning("Missing Nomba webhook signature header", { path: req.path });
      return res.status(400).send({ error: "Missing signature header" });
    }

    if (!nombaPayoutClient.verifyWebhookSignature(rawBody, signature, timestamp)) {
      capturePaymentWarning("Invalid Nomba webhook signature", { path: req.path });
      return res.status(400).send({ error: "Invalid webhook signature" });
    }

    const body = req.body || {};
    const data = body.data && typeof body.data === "object" ? body.data : {};
    const transaction = data.transaction && typeof data.transaction === "object" ? data.transaction : data;
    const eventType = String(firstPresent(body.event_type, body.eventType, body.type, body.event, "unknown"));
    // For pay-in webhooks, our assigned paymentReference lives in merchantTxRef.
    // Prioritise it over Nomba's internal transactionId so escrow lookup succeeds immediately.
    reference = String(firstPresent(
      transaction.merchantTxRef,
      transaction.meta?.merchantTxRef,
      transaction.id,
      transaction.transactionId,
      transaction.transactionRef,
      transaction.transactionReference,
      body.request_id,
      body.requestId,
      crypto.randomUUID()
    ));

    await workflowStore.addWebhookEvent(
      `nomba:${eventType}:${reference}:${firstPresent(body.request_id, body.requestId, crypto.randomUUID())}`,
      reference,
      `nomba:${eventType}`,
      JSON.stringify(body)
    );

    const relatedTransaction =
      await escrowStore.getTransactionByProviderReference("nomba", reference) ||
      (transaction.meta?.merchantTxRef ? await escrowStore.getTransactionByProviderReference("nomba", String(transaction.meta.merchantTxRef)) : null) ||
      (transaction.merchantTxRef ? await escrowStore.getTransactionByProviderReference("nomba", String(transaction.merchantTxRef)) : null);

    if (relatedTransaction && relatedTransaction.transactionType === "release") {
      await escrowStore.addEvent({
        escrowId: relatedTransaction.escrowId,
        actor: "nomba",
        actorRole: "payment_provider",
        channel: "webhook",
        previousStatus: undefined,
        nextStatus: undefined,
        eventType: "payout_provider_event_received",
        reason: eventType,
        metadata: {
          provider: "nomba",
          reference,
          payload: body,
        },
      });
      await opsStore.enqueueJob("payout_review", {
        escrowId: relatedTransaction.escrowId,
        provider: "nomba",
        reference,
        eventType,
        reason: "nomba_payout_webhook_requires_operator_or_requery_confirmation",
      }, { maxAttempts: 3 });
    } else {
      const escrow = await escrowStore.findEscrowByPaymentReference(reference) ||
        (transaction.meta?.merchantTxRef ? await escrowStore.findEscrowByPaymentReference(String(transaction.meta.merchantTxRef)) : null) ||
        (transaction.merchantTxRef ? await escrowStore.findEscrowByPaymentReference(String(transaction.merchantTxRef)) : null);

      if (escrow) {
        if (escrow.paymentProvider && escrow.paymentProvider !== "nomba" && escrow.paymentProvider !== "nomba_sandbox_override") {
          capturePaymentWarning("Nomba webhook matched escrow with different provider", {
            escrowId: escrow.escrowId,
            escrowProvider: escrow.paymentProvider,
            paymentReference: reference,
          });
          return res.status(409).send({ error: "Payment reference belongs to a different provider" });
        }

        if (eventType === "payment_success" || eventType === "charge.completed" || eventType === "SUCCESS" || eventType === "SUCCESSFUL" || eventType === "SUCCEEDED") {
          // For Nomba checkout webhooks, the payload already carries the payment details.
          // Extract amount/status directly from the webhook before making an API requery,
          // so that sandbox and live checkout orders are handled correctly without a "Tag mismatch" error.
          const webhookAmount = Number(transaction.amount || 0);
          const webhookStatus = String(transaction.status || "").toUpperCase();
          const isCheckoutRef = reference.startsWith("nomba-") || reference.startsWith("sandbox-nomba-");
          const webhookConfirmsSuccess = ["SUCCESS", "SUCCESSFUL", "COMPLETED", "SUCCEEDED"].includes(webhookStatus) && webhookAmount > 0;

          let transactionData: any;
          if (isCheckoutRef && webhookConfirmsSuccess) {
            // Trust the webhook payload directly for checkout references
            transactionData = {
              provider: "nomba",
              status: "success",
              paymentReference: reference,
              transactionReference: transaction.id || transaction.transactionId || reference,
              amount: webhookAmount,
              currency: "NGN",
              raw: body,
            };
          } else {
            transactionData = await nombaPaymentProvider.verifyPayment(reference);
          }

          if (transactionData.paymentReference !== reference && transactionData.paymentReference !== escrow.paymentReference) {
            capturePaymentWarning("Nomba verification reference mismatch", {
              webhookReference: reference,
              verifiedReference: transactionData.paymentReference,
            });
            return res.status(202).send({ status: "verification_reference_mismatch" });
          }

          const paymentEvent = normalizeVerifiedPaymentEvent({
            webhook: {
              provider: "nomba",
              eventId: `nomba:${eventType}:${reference}`,
              eventType,
              paymentReference: reference,
              raw: body,
            },
            verifiedPayment: transactionData,
            escrow,
            expectedAmount: await expectedFundingAmount(escrow),
            signatureVerified: true,
            raw: body,
          });

          const funded = await reconcileEscrowPayment(escrow.escrowId, transactionData, "webhook", paymentEvent);
          if (funded.status === "IN_PROGRESS") {
            info("Escrow funded from verified Nomba webhook", {
              escrowId: funded.escrowId,
              paymentReference: reference,
            });
            await notifyEscrowFundedParticipants(funded);
          } else if (funded.status === "REVIEW_REQUIRED") {
            info("Escrow payment moved to review from Nomba webhook", {
              escrowId: funded.escrowId,
              paymentReference: reference,
            });
          }
        }
      } else {
        capturePaymentWarning("Nomba webhook did not match any escrow or payout transaction", {
          reference,
          eventType,
        });
      }
    }

    return res.status(200).send({ status: "received" });
  } catch (err: any) {
    if (reference) {
      try {
        await opsStore.enqueueJob("payout_review", {
          provider: "nomba",
          reference,
          reason: "nomba_webhook_processing_failed",
        }, { maxAttempts: 3 });
      } catch (enqueueErr: any) {
        captureOperationalError("Failed to enqueue Nomba payout review job", enqueueErr, { reference });
      }
    }
    captureOperationalError("Nomba webhook processing failed", err, { reference: reference || "unknown" });
    return res.status(500).send({ error: "Webhook processing failed" });
  }
});

const renderSuccessHtml = (title: string, message: string) => `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${title} - Sivan AI</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; padding: 20px; text-align: center; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 40px 30px; max-width: 420px; width: 100%; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5); }
    .icon { font-size: 54px; margin-bottom: 16px; }
    h2 { margin: 0 0 12px 0; font-size: 24px; color: #38bdf8; }
    p { color: #94a3b8; font-size: 15px; line-height: 1.5; margin-bottom: 24px; }
    .footer { font-size: 12px; color: #64748b; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h2>${title}</h2>
    <p>${message}</p>
    <div class="footer">Sivan payment AI</div>
  </div>
</body>
</html>
`;

router.get(["/payment/callback", "/api/payment/callback"], async (req, res) => {
  const reference = String(req.query.reference || req.query.trxref || "").trim();
  if (reference) {
    try {
      const escrow = await escrowStore.findEscrowByPaymentReference(reference);
      if (escrow) {
        if (escrow.status === "PENDING_PAYMENT" || escrow.status === "CREATED") {
          const provider = getProviderForEscrow(escrow) as any;
          const transaction = await provider.verifyTransaction(reference).catch(() => null);
          if (transaction && transaction.status === "success") {
            const funded = await reconcileEscrowPayment(escrow.escrowId, transaction, "webhook");
            if (funded) {
              await notifyEscrowFundedParticipants(funded);
            }
          }
        } else if (escrow.status === "FUNDED" || escrow.status === "IN_PROGRESS") {
          await notifyEscrowFundedParticipants(escrow);
        }
      }
    } catch (err: any) {
      warn("Payment callback auto-reconciliation warning", { reference, error: err?.message || String(err) });
    }
  }

  res.setHeader("Content-Type", "text/html");
  res.status(200).send(renderSuccessHtml(
    "Payment Received!",
    "Your payment has been successfully recorded. Your funds are safely held in Sivan payment AI service agreement.<br><br>You can close this window and return to Telegram or WhatsApp."
  ));
});

export default router;
export { safeSecretEquals, twilioDebuggerSecretValid };
