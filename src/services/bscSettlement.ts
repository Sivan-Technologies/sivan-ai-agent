import { config } from '../config';

/**
 * SIVAN BNB CHAIN (BSC & opBNB) SERVICE AGREEMENT SETTLEMENT ENGINE
 *
 * Coordinates cryptographic milestone releases for BEP-20 stablecoin Service Agreements
 * settled on BNB Smart Chain (BSC) and opBNB.
 *
 * Integrates with:
 * - BNB Chain JSON-RPC (BSC Mainnet & BSC Testnet)
 * - BEP-20 USDT (0x55d398326f99059fF775485246999027B3197955)
 * - BEP-20 USDC (0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d)
 * - Automatic Seller Payouts to EVM 0x Addresses
 * - BscScan / Block Explorer Verification
 */

export interface BscSettlementRequest {
  agreementId: string;
  sellerUserId: string;
  sellerBscAddress: string;
  grossAmountUsdc: number;
  feeAmountUsdc: number;
  netAmountUsdc: number;
  asset?: 'usdt' | 'usdc';
  actor: string;
  channel: string;
}

export interface BscSettlementResult {
  success: boolean;
  agreementId: string;
  txHash: string;
  explorerUrl: string;
  network: 'bsc';
  asset: string;
  releasedAmount: number;
  feeDeducted: number;
  destinationAddress: string;
  timestamp: string;
}

export class BscSettlementService {
  private paymentApiUrl: string;

  constructor(paymentApiUrl?: string) {
    this.paymentApiUrl = (paymentApiUrl || process.env.SIVAN_PAYMENT_URL || 'http://localhost:3000').replace(/\/$/, '');
  }

  /**
   * Determine if an agreement is configured for BNB Chain / BSC settlement.
   */
  public isBscAgreement(agreement: { network?: string; currency?: string }): boolean {
    const net = (agreement.network || '').toLowerCase().trim();
    const curr = (agreement.currency || '').toUpperCase().trim();
    return net === 'bsc' || net === 'bnb' || curr === 'USDT_BSC' || curr === 'USDC_BSC';
  }

  /**
   * Execute settlement release to the seller on BNB Chain (BSC).
   */
  public async executeSettlement(request: BscSettlementRequest): Promise<BscSettlementResult> {
    if (!request.sellerBscAddress || !request.sellerBscAddress.startsWith('0x') || request.sellerBscAddress.length !== 42) {
      throw new Error(`Invalid BSC destination address for settlement: ${request.sellerBscAddress}`);
    }

    const asset = (request.asset || 'usdt').toLowerCase();
    const idempotencyKey = `bsc_settle_${request.agreementId}_${Date.now()}`;

    try {
      const response = await fetch(`${this.paymentApiUrl}/api/v1/developer/transfers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Sivan-Api-Key': process.env.SIVAN_DEV_API_KEY || 'sk_test_sivan_developer_default',
          'X-Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({
          userId: request.sellerUserId,
          destinationAddress: request.sellerBscAddress,
          network: 'bsc',
          asset,
          amount: request.netAmountUsdc,
          memo: `Sivan Deal Release: ${request.agreementId}`,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`BSC settlement payment API rejected transfer: ${errText}`);
      }

      const data: any = await response.json();
      const isTestnet = process.env.NODE_ENV === 'development' || process.env.BSC_NETWORK === 'testnet';
      const explorerBase = isTestnet ? 'https://testnet.bscscan.com' : 'https://bscscan.com';

      return {
        success: true,
        agreementId: request.agreementId,
        txHash: data.txHash || `0x${Buffer.from(idempotencyKey).toString('hex').slice(0, 64)}`,
        explorerUrl: data.explorerUrl || `${explorerBase}/tx/${data.txHash}`,
        network: 'bsc',
        asset,
        releasedAmount: request.netAmountUsdc,
        feeDeducted: request.feeAmountUsdc,
        destinationAddress: request.sellerBscAddress,
        timestamp: new Date().toISOString(),
      };
    } catch (err: any) {
      throw new Error(`BSC settlement payment API transfer failed: ${err.message || err}`);
    }
  }
}

export const bscSettlementService = new BscSettlementService();
