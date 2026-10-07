/**
 * Decides WHO gets notified about an escrow lifecycle event and WHAT each side
 * is told, then hands delivery to notificationDispatcher.
 *
 * Extracted verbatim from escrowService.ts as step 7 of the god-service split
 * (FUTURE_BUILD_GOD_SERVICE_SPLIT.md Part 1). No logic changes.
 *
 * NOTE: also absorbs notifyEscrowFundedParticipants and notifyBuyerDeliverySubmitted,
 * which the plan's responsibility map omitted but which are plainly orchestrators.
 */
import { EscrowRecord } from "./escrowStore";
import { escrowStore } from "../context";
import { queueWhatsAppNotification, sendOrQueueWhatsAppNotification } from "./notificationDispatcher";
import { escrowCreatedMessage, participantLifecycleMessage } from "./messageFormatter";
import { buildParticipantDeal } from "./dealCardBuilder";
// TEMPORARY until step 9 moves buildEscrowDetail into escrowDetailBuilder.ts
import { buildEscrowDetail } from "./escrowService";
import { getPresignedDownloadUrl } from "./storageService";

export async function notifyEscrowCreatedParticipants(escrow: EscrowRecord, options: { notifyBuyer?: boolean; notifySeller?: boolean } = {}) {
  const detail = await buildEscrowDetail(escrow.escrowId);
  if (!detail) return;
  const buyerWhatsapp = detail.buyer?.whatsappNumber;
  const sellerWhatsapp = detail.seller?.whatsappNumber || detail.escrow.sellerWhatsapp;
  const notifyBuyer = options.notifyBuyer ?? false;
  const notifySeller = options.notifySeller ?? true;

  const buyerTelegramId = detail.buyer?.telegramUserId || undefined;
  const sellerTelegramId = detail.seller?.telegramUserId || undefined;

  await Promise.all([
    notifyBuyer && buyerWhatsapp ? buildParticipantDeal(detail, buyerWhatsapp).then((dealCard) =>
      sendOrQueueWhatsAppNotification({
        to: buyerWhatsapp,
        telegramUserId: buyerTelegramId,
        message: escrowCreatedMessage(detail.escrow, "buyer"),
        reason: "buyer_agreement_created",
        escrowId: detail.escrow.escrowId,
        dealCard: dealCard ? {
          escrow: dealCard.escrow,
          participant: dealCard.participant,
        } : undefined,
      })
    ) : Promise.resolve(),
    notifySeller && sellerWhatsapp ? buildParticipantDeal(detail, sellerWhatsapp).then((dealCard) =>
      sendOrQueueWhatsAppNotification({
        to: sellerWhatsapp,
        telegramUserId: sellerTelegramId,
        message: escrowCreatedMessage(detail.escrow, "seller"),
        reason: "seller_invite",
        escrowId: detail.escrow.escrowId,
        dealCard: dealCard ? {
          escrow: dealCard.escrow,
          participant: dealCard.participant,
        } : undefined,
      })
    ) : Promise.resolve(),
  ]);
}

/**
 * Tell both sides of an escrow that something changed.
 *
 * Addresses PEOPLE, not phone numbers. The previous version collected
 * whatsappNumber strings and dropped the falsy ones, so a participant with a
 * Telegram handle and no phone produced no target at all: no message, no error,
 * and the counterparty still got theirs. One side saw a live deal, the other
 * heard nothing.
 *
 * escrow.sellerWhatsapp is kept as a recipient in its own right because a
 * seller who has been invited but never registered has no user row yet - a bare
 * number is all we have for them. It is skipped when it duplicates a phone we
 * already resolved from a user record.
 */
export async function notifyEscrowParticipants(escrow: EscrowRecord, message: string) {
  const [buyer, seller] = await Promise.all([
    escrowStore.getUserById(escrow.buyerUserId),
    escrow.sellerUserId ? escrowStore.getUserById(escrow.sellerUserId) : Promise.resolve(null),
  ]);

  const recipients: Array<{ to: string; telegramUserId?: string }> = [];
  const seen = new Set<string>();

  const add = (to?: string | null, telegramUserId?: string | null) => {
    // A recipient needs at least one reachable handle.
    if (!to && !telegramUserId) return;
    // Dedupe on whichever handle identifies them. The buyer and seller of the
    // same escrow are different accounts, so a collision here means the same
    // person listed twice (user record plus raw sellerWhatsapp).
    const key = telegramUserId ? `tg:${telegramUserId}` : `wa:${to}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (to) seen.add(`wa:${to}`);
    recipients.push({ to: to || "", telegramUserId: telegramUserId || undefined });
  };

  add(buyer?.whatsappNumber, buyer?.telegramUserId);
  add(seller?.whatsappNumber, seller?.telegramUserId);
  add(escrow.sellerWhatsapp);

  recipients.forEach((recipient) => queueWhatsAppNotification({
    to: recipient.to,
    telegramUserId: recipient.telegramUserId,
    message,
    reason: "escrow_participant_update",
    escrowId: escrow.escrowId,
  }));
}

export async function notifyEscrowFundedParticipants(escrow: EscrowRecord) {
  const detail = await buildEscrowDetail(escrow.escrowId);
  if (!detail) return;

  const rawBuyer = detail.buyer?.whatsappNumber || detail.escrow.buyerWhatsapp || detail.escrow.buyerUserId || "";
  const rawSeller = detail.seller?.whatsappNumber || detail.escrow.sellerWhatsapp || detail.escrow.sellerUserId || "";

  const extractTgId = (val: string) => {
    if (!val) return undefined;
    if (val.startsWith("tg:")) return val.replace("tg:", "");
    if (val.startsWith("telegram:")) return val.replace("telegram:", "");
    if (/^\d{6,12}$/.test(val)) return val;
    return undefined;
  };

  const buyerWhatsapp = detail.buyer?.whatsappNumber || (rawBuyer.startsWith("whatsapp:") ? rawBuyer : undefined);
  const sellerWhatsapp = detail.seller?.whatsappNumber || (rawSeller.startsWith("whatsapp:") ? rawSeller : undefined);

  const buyerTelegramUserId = detail.buyer?.telegramUserId || extractTgId(rawBuyer);
  const sellerTelegramUserId = detail.seller?.telegramUserId || extractTgId(rawSeller);

  const buyerTarget = buyerWhatsapp || (buyerTelegramUserId ? `tg:${buyerTelegramUserId}` : rawBuyer);
  const sellerTarget = sellerWhatsapp || (sellerTelegramUserId ? `tg:${sellerTelegramUserId}` : rawSeller);

  const message = participantLifecycleMessage(
    detail.escrow,
    "Payment has been confirmed and locked into the service agreement.",
    "Reply STATUS or tap View status to see what to do next."
  );

  await Promise.all([
    buyerTarget ? buildParticipantDeal(detail, buyerTarget).then((dealCard) =>
      queueWhatsAppNotification({
        to: buyerWhatsapp || (rawBuyer.startsWith("whatsapp:") ? rawBuyer : ""),
        telegramUserId: buyerTelegramUserId || undefined,
        message,
        reason: "escrow_funded",
        escrowId: detail.escrow.escrowId,
        dealCard: dealCard ? {
          escrow: dealCard.escrow,
          participant: dealCard.participant,
        } : undefined,
      })
    ) : Promise.resolve(),
    sellerTarget ? buildParticipantDeal(detail, sellerTarget).then((dealCard) =>
      queueWhatsAppNotification({
        to: sellerWhatsapp || (rawSeller.startsWith("whatsapp:") ? rawSeller : ""),
        telegramUserId: sellerTelegramUserId || undefined,
        message,
        reason: "escrow_funded",
        escrowId: detail.escrow.escrowId,
        dealCard: dealCard ? {
          escrow: dealCard.escrow,
          participant: dealCard.participant,
        } : undefined,
      })
    ) : Promise.resolve(),
  ]);
}

export async function notifyBuyerDeliverySubmitted(
  escrow: EscrowRecord,
  summary: string,
  media: Array<{ url: string }> = []
) {
  const detail = await buildEscrowDetail(escrow.escrowId);
  const buyerWhatsapp = detail?.buyer?.whatsappNumber;
  const buyerTelegramUserId = detail?.buyer?.telegramUserId;
  if (!detail || (!buyerWhatsapp && !buyerTelegramUserId)) return;
  const dealCard = await buildParticipantDeal(detail, buyerWhatsapp || `tg:${buyerTelegramUserId}`);

  const resolvedMedia = await Promise.all(
    media.map(async (m: any) => {
      if (m.url && m.url.startsWith("r2://")) {
        try {
          const url = await getPresignedDownloadUrl(m.url.substring(5));
          if (url.includes("sivan-mock-presigned-url.test") && m.originalUrl) {
            return { ...m, url: m.originalUrl };
          }
          return { ...m, url };
        } catch {
          return m;
        }
      }
      return m;
    })
  );

  const mediaUrls = resolvedMedia.map((m) => m.url).filter(Boolean);
  queueWhatsAppNotification({
    to: buyerWhatsapp || "",
    telegramUserId: buyerTelegramUserId || undefined,
    message: participantLifecycleMessage(
      detail.escrow,
      "The service provider has submitted delivery proof.",
      `Review the delivery, then reply COMPLETE ${detail.escrow.escrowId} if you are satisfied or DISPUTE ${detail.escrow.escrowId} if there is a problem.`
    ),
    reason: "seller_delivery_submitted",
    escrowId: detail.escrow.escrowId,
    dealCard: dealCard ? {
      escrow: dealCard.escrow,
      participant: dealCard.participant,
    } : undefined,
    context: { summary: summary || "Seller submitted delivery proof" },
    media: mediaUrls,
  });
}
