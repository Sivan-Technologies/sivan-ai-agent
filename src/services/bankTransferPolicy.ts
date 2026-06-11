export function assertNairaBankTransferOnly(methods: string[], source = "NAIRA_PAYMENT_METHODS") {
  const normalized = methods.map((method) => method.trim().toLowerCase()).filter(Boolean);
  const accepted = new Set(["bank_transfer", "account_transfer"]);
  if (normalized.length !== 1 || !accepted.has(normalized[0])) {
    throw new Error(`Sivan Naira collection must be configured as bank transfer only via ${source}`);
  }
}
