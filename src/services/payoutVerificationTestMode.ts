type PayoutVerificationTestInput = {
  accountNumber: string;
  whatsappNumber: string;
  sellerName: string;
};

export type PayoutVerificationTestResolution = {
  accountNumber: string;
  accountName: string;
  bankCode: string;
};

export type SandboxPaymentInstruction = {
  reference: string;
  provider: "paystack_sandbox_override";
};

function csvValues(value?: string) {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getPayoutVerificationTestResolution(
  input: PayoutVerificationTestInput,
  bankCode: string,
  env: NodeJS.ProcessEnv = process.env
): PayoutVerificationTestResolution | null {
  if (env.PAYOUT_VERIFICATION_TEST_MODE !== "true") return null;
  if (!env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_")) return null;
  if (!csvValues(env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS).includes(input.accountNumber)) return null;

  const allowedWhatsappNumbers = csvValues(env.PAYOUT_VERIFICATION_TEST_WHATSAPP_NUMBERS);
  if (allowedWhatsappNumbers.length > 0 && !allowedWhatsappNumbers.includes(input.whatsappNumber)) return null;

  const sellerName = input.sellerName.trim();
  if (!sellerName) return null;

  return {
    accountNumber: input.accountNumber,
    accountName: sellerName,
    bankCode,
  };
}

export function createSandboxPaymentInstruction(
  escrowId: string,
  env: NodeJS.ProcessEnv = process.env
): SandboxPaymentInstruction | null {
  if (env.PAYOUT_VERIFICATION_TEST_MODE !== "true") return null;
  if (!env.PAYSTACK_SECRET_KEY?.startsWith("sk_test_")) return null;
  if (!csvValues(env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS).length) return null;

  return {
    reference: `sandbox-paystack-${escrowId}-${Date.now()}`,
    provider: "paystack_sandbox_override",
  };
}

export function isSandboxPaymentReference(reference?: string, env: NodeJS.ProcessEnv = process.env) {
  return Boolean(
    reference?.startsWith("sandbox-paystack-SIV-") &&
    createSandboxPaymentInstruction("probe", env)
  );
}
