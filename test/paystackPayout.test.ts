import { describe, expect, it, vi } from "vitest";
import { PaystackPayoutProvider, getPayoutProviderForEscrow, createPayoutProvider } from "../src/services/payoutProvider";
import { PaystackClient } from "../src/services/paystackClient";
import { config } from "../src/config";

describe("Paystack Payout & Transfer Integration", () => {
  it("creates transfer recipient and initiates transfer in test mode", async () => {
    const provider = new PaystackPayoutProvider("test");
    expect(provider.id).toBe("paystack");

    const escrow: any = {
      escrowId: "esc-paystack-test-01",
      amount: 25000,
      currency: "NAIRA",
      paymentProvider: "paystack",
      status: "IN_PROGRESS",
    };

    const payoutAccount: any = {
      payoutAccountId: "payout-01",
      accountNumber: "0123456789",
      accountNumberRaw: "0123456789",
      bankCode: "058",
      bankName: "Guaranty Trust Bank",
      accountName: "Sivan Seller",
      resolvedAccountName: "Sivan Seller",
    };

    const result = await provider.initiatePayout({
      escrow,
      payoutAccount,
      amount: 24500,
      currency: "NAIRA",
      requestedBy: "admin_tester",
      idempotencyKey: "release-esc-paystack-test-01",
    });

    expect(result.provider).toBe("paystack");
    expect(result.status).toBe("pending");
    expect(result.reference).toBe("SIVAN-release-esc-paystack-test-01");
    expect(result.transferCode).toMatch(/^TRF_SIM_/);
  });

  it("throws clear error when payout account or bank details are missing", async () => {
    const provider = new PaystackPayoutProvider("test");
    const escrow: any = {
      escrowId: "esc-missing-account",
      amount: 10000,
      currency: "NAIRA",
    };

    await expect(
      provider.initiatePayout({
        escrow,
        payoutAccount: null,
        amount: 9800,
        currency: "NAIRA",
        requestedBy: "admin_tester",
        idempotencyKey: "release-missing",
      })
    ).rejects.toThrow("Seller payout account is required for Paystack transfer");

    await expect(
      provider.initiatePayout({
        escrow,
        payoutAccount: { accountNumberRaw: "", bankCode: "058", accountName: "Tester" } as any,
        amount: 9800,
        currency: "NAIRA",
        requestedBy: "admin_tester",
        idempotencyKey: "release-missing-num",
      })
    ).rejects.toThrow("Seller account number is required for Paystack transfer");
  });

  it("routes escrow payout provider according to paystack transferEnabled configuration", () => {
    const escrow: any = {
      escrowId: "esc-routing-test",
      amount: 50000,
      currency: "NAIRA",
      paymentProvider: "paystack",
    };

    // When disabled, falls back to manual bank transfer
    const originalSetting = config.paystack.transferEnabled;
    try {
      config.paystack.transferEnabled = false;
      const providerDisabled = getPayoutProviderForEscrow(escrow, "test");
      expect(providerDisabled.id).toBe("manual_bank_transfer");

      // When enabled, routes to paystack automated transfer
      config.paystack.transferEnabled = true;
      const providerEnabled = getPayoutProviderForEscrow(escrow, "test");
      expect(providerEnabled.id).toBe("paystack");
    } finally {
      config.paystack.transferEnabled = originalSetting;
    }
  });

  it("allows explicit payout provider creation by admin override", () => {
    const paystackProvider = createPayoutProvider("paystack", "test");
    expect(paystackProvider.id).toBe("paystack");

    const manualProvider = createPayoutProvider("manual_bank_transfer", "test");
    expect(manualProvider.id).toBe("manual_bank_transfer");
  });
});
