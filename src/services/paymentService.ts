import crypto from "crypto";
import { config } from "../config";
import { EscrowCurrency, EscrowRecord } from "./escrowStore";
import { FeeCalculation } from "./settingsStore";
import { ComplianceRisk, scoreComplianceRisk } from "./complianceRisk";
import {
  settingsStore,
  escrowStore,
  monnifyClient,
  palmpayClient,
  flutterwaveClient,
} from "../context";
import { createNairaPaymentProvider } from "./nairaPaymentProvider";
import { NombaPayoutClient } from "./nombaPayoutClient";

/**
 * Derives the base host URL for the current escrow agent instance.
 * Used to reconstruct sandbox payment simulation links.
 */
function deriveAgentBaseUrl(): string {
  const callbackUrl = config.flutterwave.callbackUrl || "";
  if (callbackUrl) {
    try {
      return new URL(callbackUrl).origin;
    } catch {
      // fall through
    }
  }
  return config.databaseMode === "live"
    ? "https://sivan-escrow-agent-live.onrender.com"
    : "https://sivan-escrow-agent-test.onrender.com";
}

export function createProviderForId(provider?: string, platformMode?: "test" | "live" | "maintenance") {
  if (!provider) {
    throw new Error(
      "No payment provider specified. Set ACTIVE_PAYMENT_PROVIDER in your environment."
    );
  }
  return createNairaPaymentProvider(provider, platformMode);
}

export function providerConfigured(provider: string) {
  const normalized = provider.trim().toLowerCase();
  if (normalized === "monnify") return monnifyClient.isCollectionConfigured();
  if (normalized === "palmpay") return palmpayClient.isCollectionConfigured();
  if (normalized === "flutterwave") return flutterwaveClient.isCollectionConfigured();
  if (normalized === "nomba") return new NombaPayoutClient(config.databaseMode).isCollectionConfigured();
  return false;
}

export async function getActiveNairaPaymentProvider() {
  const settings = await settingsStore.getSettings();
  if (!providerConfigured(settings.activePaymentProvider)) {
    throw new Error(`Active Naira payment provider is not configured: ${settings.activePaymentProvider}`);
  }
  return createProviderForId(settings.activePaymentProvider, settings.platformMode);
}

export async function getProviderForEscrow(escrow: Pick<EscrowRecord, "paymentProvider">) {
  const settings = await settingsStore.getSettings();
  return createProviderForId(
    escrow.paymentProvider || settings.activePaymentProvider,
    settings.platformMode
  );
}

export async function fundingWindowHoursForEscrow(escrow: Pick<EscrowRecord, "currency" | "amount">) {
  if (escrow.currency !== "NAIRA") return 24;
  const settings = await settingsStore.getSettings();
  return escrow.amount >= settings.nairaHighValueFundingWindowAmount
    ? settings.nairaHighValueFundingWindowHours
    : settings.nairaFundingWindowHours;
}

export async function fundingDeadlineForEscrow(escrow: Pick<EscrowRecord, "currency" | "amount">) {
  const hours = await fundingWindowHoursForEscrow(escrow);
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export function uniqueProviderReference(providerId: string, escrowId: string) {
  return `${providerId}-${escrowId}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

function callbackUrlForProvider(providerId: string) {
  const normalized = providerId.trim().toLowerCase();
  if (normalized === "palmpay") return config.palmpay.callbackUrl || config.flutterwave.callbackUrl;
  if (normalized === "flutterwave") return config.flutterwave.callbackUrl;
  if (normalized === "monnify") return config.monnify.webhookUrl || config.flutterwave.callbackUrl;
  return config.flutterwave.callbackUrl;
}

export function formatFundingInstruction(escrow: EscrowRecord, payment: any) {
  const currency = escrow.currency === "NAIRA" ? "NGN" : escrow.currency;
  const total = new Intl.NumberFormat("en-NG").format(payment.totalPayable || escrow.amount);
  const escrowAmount = new Intl.NumberFormat("en-NG").format(escrow.amount);
  
  const feePayer = escrow.feePayer || "buyer";
  const totalFee = payment.platformFeeAmount || 0;
  let displayedFee = "";

  if (feePayer === "buyer") {
    displayedFee = `${currency} ${new Intl.NumberFormat("en-NG").format(totalFee)}`;
  } else if (feePayer === "seller") {
    displayedFee = `${currency} 0 (paid by seller)`;
  } else if (feePayer === "split") {
    const buyerFee = Math.round(totalFee / 2);
    displayedFee = `${currency} ${new Intl.NumberFormat("en-NG").format(buyerFee)} (50/50 split)`;
  }

  if (payment.authorizationUrl) {
    return [
      `Payment instructions for ${escrow.escrowId}`,
      `Total to pay: ${currency} ${total}`,
      `Service amount: ${currency} ${escrowAmount}`,
      `Sivan fee: ${displayedFee}`,
      "",
      `Complete payment through licensed provider: ${payment.authorizationUrl}`,
      payment.expiresAt ? `Payment link expires: ${payment.expiresAt}` : null,
    ].filter(Boolean).join("\n");
  }
  if (payment.accountNumber) {
    return [
      `Payment instructions for ${escrow.escrowId}`,
      `Transfer ${currency} ${total}`,
      `Bank: ${payment.bankName || "assigned bank"}`,
      `Account number: ${payment.accountNumber}`,
      `Account name: ${payment.accountName || "Sivan payment collection"}`,
      `Reference: ${payment.reference}`,
      "",
      `Service amount: ${currency} ${escrowAmount}`,
      `Sivan fee: ${displayedFee}`,
      payment.expiresAt ? `Payment details expire: ${payment.expiresAt}` : null,
    ].filter(Boolean).join("\n");
  }
  return [
    `Payment instructions for ${escrow.escrowId}`,
    `Payment reference: ${payment.reference}`,
    `Total to pay: ${currency} ${total}`,
    `Service amount: ${currency} ${escrowAmount}`,
    `Sivan fee: ${displayedFee}`,
  ].join("\n");
}

export function nairaCustomerEmailForWhatsapp(whatsappNumber: string) {
  const digits = whatsappNumber.replace(/\D/g, "");
  return `whatsapp_${digits || "user"}@sivan.com`;
}

export type PayoutQuote = FeeCalculation & {
  currency: EscrowCurrency;
  grossAmount: number;
  platformFeeAmount: number;
  sellerNetAmount: number;
  amountSource: "escrow_record";
};

export async function calculateEscrowPayoutQuote(
  amount: number, 
  currency: EscrowCurrency,
  feePayer: "buyer" | "seller" | "split" = "buyer"
): Promise<PayoutQuote> {
  const settings = await settingsStore.getSettings();
  const fees = currency === "NAIRA"
    ? settingsStore.calculateNairaFee(amount, settings)
    : settingsStore.calculateUSDCFee(amount, settings);
  const platformFeeAmount = Math.max(0, fees.totalPlatformFee);
  
  let totalWithFee = amount;
  let sellerNetAmount = amount;

  if (feePayer === "buyer") {
    totalWithFee = amount + platformFeeAmount;
    sellerNetAmount = amount;
  } else if (feePayer === "seller") {
    totalWithFee = amount;
    sellerNetAmount = amount - platformFeeAmount;
  } else if (feePayer === "split") {
    const halfFee = Math.round(platformFeeAmount / 2);
    totalWithFee = amount + halfFee;
    sellerNetAmount = amount - (platformFeeAmount - halfFee);
  }

  if (currency === "USDC") {
    totalWithFee = parseFloat(totalWithFee.toFixed(6));
    sellerNetAmount = parseFloat(sellerNetAmount.toFixed(6));
  } else {
    totalWithFee = Math.round(totalWithFee);
    sellerNetAmount = Math.round(sellerNetAmount);
  }

  return {
    ...fees,
    totalPlatformFee: platformFeeAmount,
    recipientNet: sellerNetAmount,
    totalWithFee,
    currency,
    grossAmount: amount,
    platformFeeAmount,
    sellerNetAmount,
    amountSource: "escrow_record",
  };
}

export async function createNairaPaymentInstruction(escrow: EscrowRecord, options: { regenerate?: boolean; buyerWhatsapp?: string } = {}) {
  const provider = escrow.paymentProvider ? await getProviderForEscrow(escrow) : await getActiveNairaPaymentProvider();
  const payoutQuote = await calculateEscrowPayoutQuote(escrow.amount, escrow.currency, escrow.feePayer);
  const paymentReference = uniqueProviderReference(provider.id, escrow.escrowId);
  const transaction = await provider.initializeBankTransferPayment({
    amount: payoutQuote.totalWithFee,
    customerEmail: nairaCustomerEmailForWhatsapp(options.buyerWhatsapp || escrow.buyerUserId),
    callbackUrl: callbackUrlForProvider(provider.id),
    escrowId: escrow.escrowId,
    paymentReference,
  });
  const fundingExpiresAt = escrow.fundingExpiresAt || await fundingDeadlineForEscrow(escrow);
  await escrowStore.attachPayment({
    escrowId: escrow.escrowId,
    paymentReference: transaction.paymentReference,
    paymentAuthorizationUrl: transaction.authorizationUrl,
    paymentProvider: transaction.provider,
    paymentMetadata: {
      ...transaction,
      escrowAmount: escrow.amount,
      platformFeeAmount: payoutQuote.platformFeeAmount,
      totalPayable: payoutQuote.totalWithFee,
      fundingExpiresAt,
      feePolicy: "buyer_pays_fee_on_top",
    },
    fundingExpiresAt,
    activePaymentExpiresAt: transaction.expiresAt,
    status: "PENDING_PAYMENT",
    regenerate: Boolean(options.regenerate),
  });
  return {
    provider: transaction.provider,
    reference: transaction.paymentReference,
    transactionReference: transaction.transactionReference,
    authorizationUrl: transaction.authorizationUrl,
    accountNumber: transaction.accountNumber,
    accountName: transaction.accountName,
    bankName: transaction.bankName,
    bankCode: transaction.bankCode,
    expiresAt: transaction.expiresAt,
    expiresInSeconds: transaction.expiresInSeconds,
    escrowAmount: escrow.amount,
    platformFeeAmount: payoutQuote.platformFeeAmount,
    totalPayable: payoutQuote.totalWithFee,
    fundingExpiresAt,
  };
}

export async function activeNairaPaymentInstructionForEscrow(detail: any) {
  if (!detail?.escrow.paymentReference) return null;
  const transaction = await escrowStore.getTransactionByReference(detail.escrow.paymentReference);
  if (!transaction || transaction.status === "expired") return null;
  let rawPayload: any = {};
  try {
    rawPayload = transaction.rawPayload ? JSON.parse(transaction.rawPayload) : {};
  } catch {
    rawPayload = {};
  }

  // Resolve authorization URL — for sandbox references created before the URL
  // was stored, reconstruct it on the fly so Pay Now always has a clickable link.
  const paymentRef = detail.escrow.paymentReference as string;
  let authorizationUrl: string | undefined =
    detail.escrow.paymentAuthorizationUrl || rawPayload.authorizationUrl;
  if (!authorizationUrl && /^sandbox-/i.test(paymentRef)) {
    authorizationUrl = `https://sivantech.online/pay?reference=${encodeURIComponent(paymentRef)}`;
  }

  return {
    provider: detail.escrow.paymentProvider,
    reference: paymentRef,
    transactionReference: rawPayload.transactionReference || null,
    authorizationUrl,
    accountNumber: rawPayload.accountNumber,
    accountName: rawPayload.accountName,
    bankName: rawPayload.bankName,
    bankCode: rawPayload.bankCode,
    expiresAt: detail.escrow.activePaymentExpiresAt || rawPayload.expiresAt,
    expiresInSeconds: rawPayload.expiresInSeconds,
    escrowAmount: detail.escrow.amount,
    platformFeeAmount: detail.payoutQuote.platformFeeAmount,
    totalPayable: detail.payoutQuote.totalWithFee,
    fundingExpiresAt: detail.escrow.fundingExpiresAt,
    reusedActiveInstruction: true,
  };
}

export async function calculateComplianceRisk(escrow: EscrowRecord): Promise<ComplianceRisk> {
  const sellerEscrows = escrow.sellerUserId
    ? (await escrowStore.listEscrows(500)).filter((row) => row.sellerUserId === escrow.sellerUserId || row.sellerWhatsapp === escrow.sellerWhatsapp)
    : [];
  const sellerEscrowCount = sellerEscrows.length;
  const disputedStatuses = sellerEscrows.filter((row) => row.status === "DISPUTED").length;
  const disputedByEvent = await Promise.all(sellerEscrows.map(async (row) => {
    const events = await escrowStore.listEvents(row.escrowId, 50);
    return events.some((event) => event.eventType === "dispute_opened");
  }));
  const sellerDisputeCount = Math.max(disputedStatuses, disputedByEvent.filter(Boolean).length);

  return await scoreComplianceRisk({
    amount: escrow.amount,
    currency: escrow.currency,
    sellerDisputeCount,
    sellerEscrowCount,
  });
}
