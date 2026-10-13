/** The legacy endpoint is a status sync, not a payment-ledger debit.
 * NGN must never treat an actor identity + service key as proof of funding.
 * Leave crypto behavior outside this NGN-only change.
 */
export function requiresNgnLedgerFunding(currency: string): boolean {
  return ['NAIRA','NGN'].includes(String(currency).toUpperCase());
}
