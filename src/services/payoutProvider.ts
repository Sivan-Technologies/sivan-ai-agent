import { config } from "../config";
import { EscrowCurrency, EscrowRecord, PayoutAccountRecord, PayoutAccountTransferRecord } from "./escrowStore";
import { NombaPayoutClient } from "./nombaPayoutClient";
import { PalmPayPayoutClient } from "./palmpayPayoutClient";
import { PaystackClient } from "./paystackClient";
import { warn } from "../lib/logger";

export type PayoutProviderId =
  | "manual_bank_transfer"
  | "palmpay"
  | "flutterwave"
  | "monnify"
  | "nomba"
  | "paystack";

export type PayoutProviderStatus =
  | "succeeded"
  | "pending"
  | "failed"
  | "review_required";

export interface PayoutInitiationInput {
  escrow: EscrowRecord;
  payoutAccount?: (PayoutAccountRecord | PayoutAccountTransferRecord) | null;
  amount: number;
  currency: EscrowCurrency;
  requestedBy: string;
  idempotencyKey: string;
  manualPayoutReference?: string;
  payoutNotes?: string;
}

export interface PayoutInitiationResult {
  provider: PayoutProviderId;
  status: PayoutProviderStatus;
  reference: string;
  transferCode?: string;
  message: string;
  rawPayload?: Record<string, unknown>;
}

export interface PayoutProvider {
  id: PayoutProviderId;
  initiatePayout(input: PayoutInitiationInput): Promise<PayoutInitiationResult>;
}

function configuredActivePayoutProvider(): PayoutProviderId {
  const value = (process.env.ACTIVE_PAYOUT_PROVIDER || "manual_bank_transfer").trim().toLowerCase();
  if (["manual_bank_transfer", "palmpay", "flutterwave", "monnify", "nomba", "paystack"].includes(value)) {
    return value as PayoutProviderId;
  }
  return "manual_bank_transfer";
}

class ManualBankTransferPayoutProvider implements PayoutProvider {
  public readonly id = "manual_bank_transfer" as const;

  constructor(private platformMode?: "test" | "live" | "maintenance") {}

  public async initiatePayout(input: PayoutInitiationInput): Promise<PayoutInitiationResult> {
    const reference = input.manualPayoutReference?.trim();
    if (!reference) {
      throw new Error("Manual payout reference is required when ACTIVE_PAYOUT_PROVIDER=manual_bank_transfer");
    }
    const resolvedReference = this.platformMode === "test" ? `TEST-${reference}` : reference;
    return {
      provider: this.id,
      status: "succeeded",
      reference: resolvedReference,
      message: "Manual bank-transfer payout reference recorded by admin",
      rawPayload: {
        payoutNotes: input.payoutNotes || null,
        requestedBy: input.requestedBy,
        idempotencyKey: input.idempotencyKey,
        accountLast4: input.payoutAccount?.accountNumberLast4 || null,
        bankCode: input.payoutAccount?.bankCode || null,
      },
    };
  }
}

class DisabledAutomatedPayoutProvider implements PayoutProvider {
  public constructor(public readonly id: Exclude<PayoutProviderId, "manual_bank_transfer">) {}

  public async initiatePayout(_input: PayoutInitiationInput): Promise<PayoutInitiationResult> {
    if (this.id === "palmpay" && config.palmpay.payoutEnabled) {
      throw new Error("PalmPay automated payout client is not implemented yet; keep ACTIVE_PAYOUT_PROVIDER=manual_bank_transfer");
    }
    throw new Error(`${this.id} automated payout is disabled/not implemented; keep ACTIVE_PAYOUT_PROVIDER=manual_bank_transfer`);
  }
}

class PalmPayPayoutProvider implements PayoutProvider {
  public readonly id = "palmpay" as const;
  private readonly client = new PalmPayPayoutClient();

  constructor(private platformMode?: "test" | "live" | "maintenance") {}

  public async initiatePayout(input: PayoutInitiationInput): Promise<PayoutInitiationResult> {
    if (this.platformMode === "test") {
      return {
        provider: this.id,
        status: "succeeded",
        reference: `TEST-PALMPAY-${Date.now()}`,
        message: "Test mode: Simulated PalmPay payout succeeded",
        rawPayload: { simulated: true },
      };
    }
    if (!config.palmpay.payoutEnabled) {
      throw new Error("PalmPay payout is disabled. Set PALMPAY_PAYOUT_ENABLED=true only after payout proof passes.");
    }
    const payoutAccount = input.payoutAccount as PayoutAccountTransferRecord | undefined | null;
    if (!payoutAccount?.accountNumberRaw) throw new Error("Seller payout account number is unavailable for PalmPay transfer");
    if (!payoutAccount.bankCode) throw new Error("Seller payout bank code is required for PalmPay transfer");
    const payeeName = payoutAccount.resolvedAccountName || payoutAccount.accountName || "Sivan Seller";
    const safeOrderId = `PPO${input.escrow.escrowId}${Date.now()}`
      .replace(/[^A-Za-z0-9]/g, "")
      .slice(0, 32);
    const result = await this.client.initiatePayout({
      orderId: safeOrderId,
      payeeName,
      payeeBankCode: payoutAccount.bankCode,
      payeeBankAccNo: payoutAccount.accountNumberRaw,
      amount: input.amount,
      currency: input.currency,
      remark: `Sivan ${input.escrow.escrowId}`,
    });
    return {
      provider: this.id,
      status: result.status,
      reference: result.orderNo || result.orderId,
      message: result.message || `PalmPay payout ${result.status}`,
      rawPayload: {
        orderId: result.orderId,
        orderNo: result.orderNo || null,
        sessionId: result.sessionId || null,
        fee: result.fee || null,
        status: result.status,
      },
    };
  }
}

class NombaPayoutProvider implements PayoutProvider {
  public readonly id = "nomba" as const;
  private readonly client: NombaPayoutClient;

  constructor(private platformMode?: "test" | "live" | "maintenance") {
    this.client = new NombaPayoutClient(platformMode);
  }

  public async initiatePayout(input: PayoutInitiationInput): Promise<PayoutInitiationResult> {
    if (this.platformMode === "test") {
      return {
        provider: this.id,
        status: "succeeded",
        reference: `TEST-NOMBA-${Date.now()}`,
        message: "Test mode: Simulated Nomba payout succeeded",
        rawPayload: { simulated: true },
      };
    }
    if (!config.nomba.payoutEnabled) {
      throw new Error("Nomba payout is disabled. Set NOMBA_PAYOUT_ENABLED=true only after sandbox transfer and webhook proof pass.");
    }
    const payoutAccount = input.payoutAccount as PayoutAccountTransferRecord | undefined | null;
    if (!payoutAccount?.accountNumberRaw) throw new Error("Seller payout account number is unavailable for Nomba transfer");
    if (!payoutAccount.bankCode) throw new Error("Seller payout bank code is required for Nomba transfer");
    const accountName = payoutAccount.resolvedAccountName || payoutAccount.accountName;
    if (!accountName) throw new Error("Seller payout account name is required for Nomba transfer");

    const merchantTxRef = `NOMBA_${input.idempotencyKey}`
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .slice(0, 64);
    const result = await this.client.initiateBankTransfer({
      merchantTxRef,
      accountNumber: payoutAccount.accountNumberRaw,
      accountName,
      bankCode: payoutAccount.bankCode,
      amount: input.amount,
      currency: input.currency,
      senderName: config.nomba.senderName,
      narration: input.payoutNotes || `Sivan escrow release ${input.escrow.escrowId}`,
    });

    return {
      provider: this.id,
      status: result.status,
      reference: result.transactionId || result.merchantTxRef,
      message: result.message || `Nomba transfer ${result.status}`,
      rawPayload: {
        merchantTxRef: result.merchantTxRef,
        transactionId: result.transactionId || null,
        fee: result.fee || null,
        status: result.status,
      },
    };
  }
}

export class PaystackPayoutProvider implements PayoutProvider {
  public readonly id = "paystack" as const;
  private readonly client: PaystackClient;

  constructor(private platformMode?: "test" | "live" | "maintenance") {
    this.client = new PaystackClient();
  }

  public async initiatePayout(input: PayoutInitiationInput): Promise<PayoutInitiationResult> {
    const payoutAccount = input.payoutAccount as PayoutAccountTransferRecord | undefined | null;
    if (!payoutAccount) {
      throw new Error("Seller payout account is required for Paystack transfer");
    }
    const rawAccountNumber = payoutAccount.accountNumberRaw || (payoutAccount as any).accountNumber;
    if (!rawAccountNumber) {
      throw new Error("Seller account number is required for Paystack transfer");
    }
    if (!payoutAccount.bankCode) {
      throw new Error("Seller payout bank code is required for Paystack transfer");
    }

    const transferReference = `SIVAN-${input.idempotencyKey || input.escrow.escrowId}`
      .replace(/[^A-Za-z0-9_-]/g, "_")
      .slice(0, 64);

    if (this.platformMode === "test") {
      return {
        provider: this.id,
        status: "pending",
        reference: transferReference,
        transferCode: `TRF_SIM_${Date.now()}`,
        message: "Test mode: Simulated Paystack transfer queued",
        rawPayload: { simulated: true },
      };
    }

    if (!config.paystack.transferEnabled) {
      throw new Error(
        "Paystack transfers are disabled. Set PAYSTACK_TRANSFER_ENABLED=true only after verifying your Paystack balance account supports transfers."
      );
    }

    const accountName =
      payoutAccount.resolvedAccountName || payoutAccount.accountName;
    if (!accountName) {
      throw new Error("Seller payout account name is required for Paystack transfer");
    }

    // Re-use cached recipient code so we don't register the same bank account twice.
    let recipientCode = payoutAccount.providerRecipientCode || "";
    if (!recipientCode) {
      const recipient = await this.client.createTransferRecipient(
        payoutAccount.accountNumberRaw,
        payoutAccount.bankCode,
        accountName
      );
      recipientCode = recipient.recipientCode;
      // Best-effort cache — if this write fails we will create the recipient again next time,
      // which Paystack deduplicates on their side anyway.
      try {
        const { escrowStore } = await import("../context.js");
        if (payoutAccount.payoutAccountId) {
          await escrowStore.updatePayoutAccountRecipientCode?.(
            payoutAccount.payoutAccountId,
            recipientCode
          );
        }
      } catch (cacheErr: any) {
        warn("Could not cache Paystack recipient code on payout account", {
          payoutAccountId: payoutAccount.payoutAccountId,
          error: cacheErr?.message,
        });
      }
    }

    const result = await this.client.initiateTransfer(
      input.amount,
      recipientCode,
      transferReference,
      input.payoutNotes || `Sivan agreement payout ${input.escrow.escrowId}`
    );

    const providerStatus: PayoutProviderStatus =
      result.status === "success" ? "succeeded"
      : result.status === "failed" ? "failed"
      : "pending";

    return {
      provider: this.id,
      status: providerStatus,
      reference: result.transferCode || result.reference,
      message: `Paystack transfer ${result.status}`,
      rawPayload: {
        transferCode: result.transferCode,
        reference: result.reference,
        recipientCode,
        status: result.status,
        amount: result.amount,
        reason: result.reason || null,
      },
    };
  }
}

export function createPayoutProvider(
  provider: PayoutProviderId = configuredActivePayoutProvider(),
  platformMode?: "test" | "live" | "maintenance"
): PayoutProvider {
  if (provider === "manual_bank_transfer") return new ManualBankTransferPayoutProvider(platformMode);
  if (provider === "palmpay") return new PalmPayPayoutProvider(platformMode);
  if (provider === "nomba") return new NombaPayoutProvider(platformMode);
  if (provider === "paystack") return new PaystackPayoutProvider(platformMode);
  return new DisabledAutomatedPayoutProvider(provider);
}

export function getActivePayoutProvider(
  platformMode?: "test" | "live" | "maintenance"
): PayoutProvider {
  return createPayoutProvider(configuredActivePayoutProvider(), platformMode);
}

export function getPayoutProviderForEscrow(
  escrow: EscrowRecord,
  platformMode?: "test" | "live" | "maintenance"
): PayoutProvider {
  if (escrow.currency !== "NAIRA") {
    return createPayoutProvider("manual_bank_transfer", platformMode);
  }

  const payInProvider = (escrow.paymentProvider || "").replace(/_sandbox_override$/, "").toLowerCase();

  // Mirror the pay-in provider as the payout provider by default.
  // Each provider is only activated when its payout feature flag is on,
  // or when running in test mode.

  if (payInProvider === "paystack" && config.paystack.transferEnabled) {
    return createPayoutProvider("paystack", platformMode);
  }

  if (payInProvider === "nomba" && config.nomba.payoutEnabled) {
    return createPayoutProvider("nomba", platformMode);
  }

  if (payInProvider === "palmpay" && config.palmpay.payoutEnabled) {
    return createPayoutProvider("palmpay", platformMode);
  }

  return getActivePayoutProvider(platformMode);
}
