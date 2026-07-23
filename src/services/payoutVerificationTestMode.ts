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
  provider: string;
  authorizationUrl: string;
};

function csvValues(value?: string) {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function isActiveProviderTestConfigured(provider: string, env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV === "test") return true;
  const norm = provider.trim().toLowerCase();
  if (norm === "flutterwave") {
    const key = env.FLUTTERWAVE_TEST_SECRET_KEY || env.FLUTTERWAVE_SECRET_KEY;
    return Boolean(
      key?.startsWith("FLWSECK_TEST-") ||
      key?.includes("test") ||
      key?.startsWith("sk_test_")
    );
  }
  if (norm === "palmpay") {
    return Boolean(
      env.PALMPAY_BASE_URL?.includes("sandbox") ||
      !env.PALMPAY_MERCHANT_ID ||
      env.PALMPAY_APP_ID?.includes("test")
    );
  }
  if (norm === "monnify") {
    return Boolean(
      env.MONNIFY_TEST_API_KEY?.startsWith("MK_TEST_") ||
      env.MONNIFY_API_KEY?.startsWith("MK_TEST_")
    );
  }
  return true;
}

export function getPayoutVerificationTestResolution(
  input: PayoutVerificationTestInput,
  bankCode: string,
  env: NodeJS.ProcessEnv = process.env
): PayoutVerificationTestResolution | null {
  if (env.PAYOUT_VERIFICATION_TEST_MODE !== "true") return null;

  const activeProvider = env.ACTIVE_PAYMENT_PROVIDER || "flutterwave";
  const isTestMode = isActiveProviderTestConfigured(activeProvider, env);

  if (!isTestMode) return null;
  const testAccounts = csvValues(env.PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS);
  // Default to "*" (allow all) if no specific test accounts are listed
  const hasAllowlist = testAccounts.length > 0;
  if (hasAllowlist && !testAccounts.includes("*") && !testAccounts.includes("any") && !testAccounts.includes(input.accountNumber)) {
    return null;
  }

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

  const activeProvider = env.ACTIVE_PAYMENT_PROVIDER || "flutterwave";
  const isTestMode = isActiveProviderTestConfigured(activeProvider, env);

  if (!isTestMode) return null;

  const providerId = activeProvider.trim().toLowerCase();
  const reference = `sandbox-${providerId}-${escrowId}-${Date.now()}`;

  const callbackUrl = env.FLUTTERWAVE_CALLBACK_URL || "";
  let host = "https://sivan-escrow-agent-test.onrender.com";
  if (callbackUrl) {
    try {
      host = new URL(callbackUrl).origin;
    } catch {
      // keep default
    }
  }
  const authorizationUrl = `https://sivantech.online/pay?reference=${reference}`;

  return {
    reference,
    provider: `${providerId}_sandbox_override`,
    authorizationUrl,
  };
}

export function isSandboxPaymentReference(reference?: string, env: NodeJS.ProcessEnv = process.env) {
  if (!reference) return false;
  
  // Accept any standard sandbox reference structure
  const isSandboxPattern =
    reference.startsWith("sandbox-flutterwave-SIV-") ||
    reference.startsWith("sandbox-palmpay-SIV-") ||
    reference.startsWith("sandbox-monnify-SIV-") ||
    reference.startsWith("sandbox-nomba-SIV-");

  return Boolean(
    isSandboxPattern &&
    createSandboxPaymentInstruction("probe", env)
  );
}

