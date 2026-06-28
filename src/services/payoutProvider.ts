import { config } from "../config";
import { EscrowCurrency, EscrowRecord, PayoutAccountRecord, PayoutAccountTransferRecord } from "./escrowStore";
import { NombaPayoutClient } from "./nombaPayoutClient";
import { PalmPayPayoutClient } from "./palmpayPayoutClient";

export type PayoutProviderId =
  | "manual_bank_transfer"
  | "palmpay"
  | "flutterwave"
  | "monnify"
  | "nomba";

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
  message: string;
  rawPayload?: Record<string, unknown>;
}

export interface PayoutProvider {
  id: PayoutProviderId;
  initiatePayout(input: PayoutInitiationInput): Promise<PayoutInitiationResult>;
}

function configuredActivePayoutProvider(): PayoutProviderId {
  const value = (process.env.ACTIVE_PAYOUT_PROVIDER || "manual_bank_transfer").trim().toLowerCase();
  if (["manual_bank_transfer", "palmpay", "flutterwave", "monnify", "nomba"].includes(value)) {
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
  private readonly client = new NombaPayoutClient();

  constructor(private platformMode?: "test" | "live" | "maintenance") {}

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

export function createPayoutProvider(
  provider: PayoutProviderId = configuredActivePayoutProvider(),
  platformMode?: "test" | "live" | "maintenance"
): PayoutProvider {
  if (provider === "manual_bank_transfer") return new ManualBankTransferPayoutProvider(platformMode);
  if (provider === "palmpay") return new PalmPayPayoutProvider(platformMode);
  if (provider === "nomba") return new NombaPayoutProvider(platformMode);
  return new DisabledAutomatedPayoutProvider(provider);
}

export function getActivePayoutProvider(
  platformMode?: "test" | "live" | "maintenance"
): PayoutProvider {
  return createPayoutProvider(configuredActivePayoutProvider(), platformMode);
}
