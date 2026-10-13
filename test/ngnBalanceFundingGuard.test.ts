import { describe, it, expect } from 'vitest';
import { requiresNgnLedgerFunding } from '../src/services/ngnBalanceFundingGuard';

describe('legacy balance funding NGN guard', () => {
  it('requires actual ledger funding for both NGN spellings', () => {
    expect(requiresNgnLedgerFunding('NAIRA')).toBe(true);
    expect(requiresNgnLedgerFunding('ngn')).toBe(true);
  });
  it('does not change crypto funding paths', () => {
    expect(requiresNgnLedgerFunding('USDC')).toBe(false);
    expect(requiresNgnLedgerFunding('USDT')).toBe(false);
  });
});
