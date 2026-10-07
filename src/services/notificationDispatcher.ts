/**
 * Low-level notification delivery: queue a WhatsApp message, or attempt an
 * immediate send and fall back to the queue.
 *
 * Extracted verbatim from escrowService.ts as step 6 of the god-service split
 * (FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 1). No logic changes.
 */
import { opsStore } from "../context";
import { notifyWhatsAppBotStrict, notifyTelegramBot } from "./notificationService";
import { captureOperationalError, capturePaymentWarning } from "./monitoring";
import { sellerInviteMessage } from "./messageFormatter";

export function queueWhatsAppNotification(params: {
  to: string;
  message: string;
  reason: string;
  escrowId?: string;
  dealCard?: any;
  context?: Record<string, any>;
  media?: string[];
  telegramUserId?: string;
}) {
  void sendOrQueueWhatsAppNotification(params);
}

/**
 * Deliver one participant notification.
 *
 * Sends on BOTH channels rather than only WhatsApp. Until this took a
 * telegramUserId, every escrow lifecycle notification went through
 * notifyWhatsAppBotStrict alone, so a user who had linked Telegram was never
 * told their escrow moved unless they also watched WhatsApp.
 *
 * The two legs are deliberately not symmetrical:
 *
 *   - WhatsApp is awaited and its failure is queued for retry, because that is
 *     the channel we promise delivery on.
 *   - Telegram is fire-and-forget. notifyTelegramBot never throws, and a
 *     Telegram failure must not enqueue a retry job that would re-send the
 *     WhatsApp message too.
 *
 * `to` is skipped when it is not a real WhatsApp address. Accounts created
 * through the web carry a `web:<userId>` placeholder in whatsapp_number, and
 * sending that to the WhatsApp API fails every time - which would enqueue a
 * retry that can never succeed and would fill the job table with poison.
 */
export async function sendOrQueueWhatsAppNotification(params: {
  to: string;
  message: string;
  reason: string;
  escrowId?: string;
  dealCard?: any;
  context?: Record<string, any>;
  media?: string[];
  telegramUserId?: string;
}) {
  if (process.env.NODE_ENV === "test") return;

  const phone = params.to ? params.to.replace(/^whatsapp:/, "").trim() : "";
  void notifyTelegramBot(
    phone,
    params.message,
    params.dealCard,
    params.telegramUserId,
    params.media
  );

  if (!params.to?.startsWith("whatsapp:")) return;

  try {
    await notifyWhatsAppBotStrict(params.to, params.message, params.dealCard, params.media);
  } catch (err) {

    const context = {
      escrowId: params.escrowId,
      to: params.to,
      reason: params.reason,
      ...params.context,
    };
    const isRateLimited = err instanceof Error && /\b429\b|Too Many Requests/i.test(err.message);
    if (isRateLimited) {
      capturePaymentWarning("WhatsApp notification rate-limited; queued for retry", context);
    } else {
      captureOperationalError("Failed to send WhatsApp notification", err, context);
    }
    try {
      await opsStore.enqueueJob("whatsapp_notification", {
        to: params.to,
        message: params.message,
        escrowId: params.escrowId,
        reason: params.reason,
        ...(params.dealCard ? { dealCard: params.dealCard } : {}),
        ...(params.media ? { media: params.media } : {}),
      }, {
        maxAttempts: 5,
        runAfter: new Date(Date.now() + (isRateLimited ? 60_000 : 15_000)).toISOString(),
      });
    } catch (enqueueErr) {
      captureOperationalError("Failed to enqueue WhatsApp notification retry", enqueueErr, context);
    }
  }
}

export function queueSellerInviteNotification(params: {
  sellerWhatsapp: string;
  escrowId: string;
  currency: string;
  amount: number;
  purpose: string;
  context?: Record<string, any>;
}) {
  const message = sellerInviteMessage(params.escrowId, params.currency, params.amount, params.purpose);
  queueWhatsAppNotification({
    to: params.sellerWhatsapp,
    message,
    reason: "seller_invite",
    escrowId: params.escrowId,
    context: params.context,
  });
}
