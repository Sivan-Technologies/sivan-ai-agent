import { describe, expect, it } from "vitest";
import { getPayoutVerificationTestResolution } from "../src/services/payoutVerificationTestMode";

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
});

