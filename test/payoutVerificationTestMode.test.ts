import { describe, expect, it } from "vitest";
import { createSandboxPaymentInstruction, getPayoutVerificationTestResolution, isSandboxPaymentReference } from "../src/services/payoutVerificationTestMode";

const input = {
  accountNumber: "8102524846",
  whatsappNumber: "whatsapp:+2348000000000",
  sellerName: "Test Seller",
};

describe("payout verification test mode", () => {
  it("allows an explicitly listed account when using Flutterwave test credentials", () => {
    const result = getPayoutVerificationTestResolution(input, "999992", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-example",
    });

    expect(result).toEqual({
      accountNumber: input.accountNumber,
      accountName: input.sellerName,
      bankCode: "999992",
    });
  });

  it("allows an explicitly listed account when using FLUTTERWAVE_TEST_SECRET_KEY", () => {
    const result = getPayoutVerificationTestResolution(input, "999992", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      FLUTTERWAVE_TEST_SECRET_KEY: "FLWSECK_TEST-example",
    });

    expect(result).toEqual({
      accountNumber: input.accountNumber,
      accountName: input.sellerName,
      bankCode: "999992",
    });
  });

  it("fails closed for live Flutterwave credentials or an account outside the allowlist", () => {
    expect(getPayoutVerificationTestResolution(input, "999992", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      FLUTTERWAVE_SECRET_KEY: "FLWSECK_live_example",
    })).toBeNull();

    expect(getPayoutVerificationTestResolution(input, "999992", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: "0000000000",
      FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-example",
    })).toBeNull();
  });

  it("enforces the optional WhatsApp allowlist", () => {
    expect(getPayoutVerificationTestResolution(input, "999992", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      PAYOUT_VERIFICATION_TEST_WHATSAPP_NUMBERS: "whatsapp:+2348111111111",
      FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-example",
    })).toBeNull();
  });

  it("creates a sandbox payment reference only under the controlled test mode", () => {
    const payment = createSandboxPaymentInstruction("SIV-TEST-1", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-example",
      ACTIVE_PAYMENT_PROVIDER: "flutterwave",
    });
    expect(payment?.provider).toBe("flutterwave_sandbox_override");
    expect(payment?.reference).toMatch(/^sandbox-flutterwave-SIV-TEST-1-/);

    expect(createSandboxPaymentInstruction("SIV-TEST-1", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      FLUTTERWAVE_SECRET_KEY: "FLWSECK_live_example",
      ACTIVE_PAYMENT_PROVIDER: "flutterwave",
    })).toBeNull();
  });

  it("recognizes sandbox payment references only while controlled test mode is active", () => {
    const env = {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: input.accountNumber,
      FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-example",
      ACTIVE_PAYMENT_PROVIDER: "flutterwave",
    };
    expect(isSandboxPaymentReference("sandbox-flutterwave-SIV-TEST-1-123", env)).toBe(true);
    expect(isSandboxPaymentReference("flutterwave-live-reference", env)).toBe(false);
    expect(isSandboxPaymentReference("sandbox-flutterwave-SIV-TEST-1-123", {
      ...env,
      FLUTTERWAVE_SECRET_KEY: "FLWSECK_live_example",
    })).toBe(false);
  });

  it("allows any account when PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS is set to '*'", () => {
    const result = getPayoutVerificationTestResolution(input, "999992", {
      PAYOUT_VERIFICATION_TEST_MODE: "true",
      PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS: "*",
      FLUTTERWAVE_SECRET_KEY: "FLWSECK_TEST-example",
    });

    expect(result).toEqual({
      accountNumber: input.accountNumber,
      accountName: input.sellerName,
      bankCode: "999992",
    });
  });
});

