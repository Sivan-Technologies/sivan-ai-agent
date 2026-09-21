import { describe, it, expect, vi, afterEach } from 'vitest';
import { BscSettlementService, bscSettlementService } from '../src/services/bscSettlement';

describe('BNB Chain (BSC) Settlement Engine Test Suite', () => {
  const service = new BscSettlementService();

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('correctly identifies BNB Chain / BSC agreements', () => {
    expect(service.isBscAgreement({ network: 'bsc' })).toBe(true);
    expect(service.isBscAgreement({ network: 'bnb' })).toBe(true);
    expect(service.isBscAgreement({ currency: 'USDT_BSC' })).toBe(true);
    expect(service.isBscAgreement({ currency: 'USDC_BSC' })).toBe(true);
    expect(service.isBscAgreement({ network: 'solana' })).toBe(false);
    expect(service.isBscAgreement({ network: 'stellar' })).toBe(false);
    expect(service.isBscAgreement({ network: 'base' })).toBe(false);
  });

  it('rejects invalid BSC EVM destination addresses', async () => {
    await expect(
      service.executeSettlement({
        agreementId: 'agr_bsc_invalid_addr',
        sellerUserId: 'usr_seller_1',
        sellerBscAddress: 'invalid_non_evm_address',
        grossAmountUsdc: 25,
        feeAmountUsdc: 0.25,
        netAmountUsdc: 24.75,
        actor: 'buyer',
        channel: 'telegram',
      })
    ).rejects.toThrow(/Invalid BSC destination address/);
  });

  it('executes simulated BSC settlement and returns verified BscScan receipt', async () => {
    const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const mockExplorerUrl = `https://bscscan.com/tx/${mockTxHash}`;

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        txHash: mockTxHash,
        explorerUrl: mockExplorerUrl,
      }),
      text: async () => '',
    })));

    const result = await service.executeSettlement({
      agreementId: 'agr_bsc_valid_001',
      sellerUserId: 'usr_seller_2',
      sellerBscAddress: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
      grossAmountUsdc: 50,
      feeAmountUsdc: 0.5,
      netAmountUsdc: 49.5,
      asset: 'usdt',
      actor: 'buyer',
      channel: 'telegram',
    });

    expect(result.success).toBe(true);
    expect(result.agreementId).toBe('agr_bsc_valid_001');
    expect(result.network).toBe('bsc');
    expect(result.asset).toBe('usdt');
    expect(result.releasedAmount).toBe(49.5);
    expect(result.feeDeducted).toBe(0.5);
    expect(result.destinationAddress).toBe('0x742d35Cc6634C0532925a3b844Bc454e4438f44e');
    expect(result.txHash.startsWith('0x')).toBe(true);
    expect(result.explorerUrl.includes('bscscan.com/tx/')).toBe(true);
  });

  it('exports singleton instance bscSettlementService', () => {
    expect(bscSettlementService instanceof BscSettlementService).toBe(true);
  });
});
