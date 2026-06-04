import { describe, expect, it } from "vitest";
import { createSandboxPaymentInstruction, getPayoutVerificationTestResolution, isSandboxPaymentReference } from "../src/services/payoutVerificationTestMode";

const input = {
  accountNumber: "8102524846",
  whatsappNumber: "whatsapp:+2348000000000",
  sellerName: "Test Seller",
};

describe("payout verification test mode", () => {
  it("allows an explicitly listed account when using Paystack test credentials", () => {
    const result = getPayoutVerificationTestResolution(input, "999992", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      PAYSTACK_SECRET_KEY: "sk_test_example",
    });

    expect(result).toEqual({
      accountNumber: input.accountNumber,
      accountName: input.sellerName,
      bankCode: "999992",
    });
  });

  it("fails closed for live Paystack credentials or an account outside the allowlist", () => {
    expect(getPayoutVerificationTestResolution(input, "999992", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      PAYSTACK_SECRET_KEY: "sk_live_example",
    })).toBeNull();

    expect(getPayoutVerificationTestResolution(input, "999992", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: "0000000000",
      PAYSTACK_SECRET_KEY: "sk_test_example",
    })).toBeNull();
  });

  it("enforces the optional WhatsApp allowlist", () => {
    expect(getPayoutVerificationTestResolution(input, "999992", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      PAYOUT_VERIFICATION_TEST_WHATSAPP_NUMBERS: "whatsapp:+2348111111111",
      PAYSTACK_SECRET_KEY: "sk_test_example",
    })).toBeNull();
  });

  it("creates a sandbox payment reference only under the controlled test mode", () => {
    const payment = createSandboxPaymentInstruction("SIV-TEST-1", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      PAYSTACK_SECRET_KEY: "sk_test_example",
    });
    expect(payment?.provider).toBe("paystack_sandbox_override");
    expect(payment?.reference).toMatch(/^sandbox-paystack-SIV-TEST-1-/);

    expect(createSandboxPaymentInstruction("SIV-TEST-1", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      PAYSTACK_SECRET_KEY: "sk_live_example",
    })).toBeNull();
  });

  it("recognizes sandbox payment references only while controlled test mode is active", () => {
    const env = {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      PAYSTACK_SECRET_KEY: "sk_test_example",
    };
    expect(isSandboxPaymentReference("sandbox-paystack-SIV-TEST-1-123", env)).toBe(true);
    expect(isSandboxPaymentReference("paystack-live-reference", env)).toBe(false);
    expect(isSandboxPaymentReference("sandbox-paystack-SIV-TEST-1-123", {
      ...env,
      PAYSTACK_SECRET_KEY: "sk_live_example",
    })).toBe(false);
  });
});
