import { config } from '../config';

/**
 * SIVAN STELLAR SERVICE AGREEMENT SETTLEMENT ENGINE
 *
 * Coordinates cryptographic milestone releases for USDC Service Agreements
 * settled on the Stellar network.
 *
 * Integrates with:
 * - Stellar Horizon & Soroban RPC
 * - Zero-Gas Fee Sponsorship (CAP-0015)
 * - Automatic Seller Payouts to Stellar Public Keys (G...)
 */

export interface StellarSettlementRequest {
  agreementId: string;
  sellerUserId: string;
  sellerStellarAddress: string;
  grossAmountUsdc: number;
  feeAmountUsdc: number;
  netAmountUsdc: number;
  actor: string;
  channel: string;
}

export interface StellarSettlementResult {
  success: boolean;
  agreementId: string;
  txHash: string;
  explorerUrl: string;
  network: 'stellar';
  releasedAmount: number;
  feeDeducted: number;
  destinationAddress: string;
  timestamp: string;
}

export class StellarSettlementService {
  private paymentApiUrl: string;

  constructor(paymentApiUrl?: string) {
    this.paymentApiUrl = (paymentApiUrl || process.env.SIVAN_PAYMENT_URL || 'http://localhost:3000').replace(/\/$/, '');
  }

  /**
   * Determine if an agreement is configured for Stellar settlement.
   */
  public isStellarAgreement(agreement: { network?: string; currency?: string }): boolean {
    const net = (agreement.network || '').toLowerCase().trim();
    const curr = (agreement.currency || '').toUpperCase().trim();
    return net === 'stellar' || curr === 'USDC_STELLAR';
  }

  /**
   * Execute settlement release to the seller on Stellar.
   */
  public async executeSettlement(request: StellarSettlementRequest): Promise<StellarSettlementResult> {
    if (!request.sellerStellarAddress || !request.sellerStellarAddress.startsWith('G')) {
      throw new Error(`Invalid Stellar destination address for settlement: ${request.sellerStellarAddress}`);
    }

    if (request.netAmountUsdc <= 0) {
      throw new Error(`Invalid settlement net amount: ${request.netAmountUsdc}`);
    }

    const idempotencyKey = `stl_settle_${request.agreementId}_${Date.now()}`;

    // Call Sivan Payment Multi-Chain Transfer API
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
          destinationAddress: request.sellerStellarAddress,
          network: 'stellar',
          asset: 'usdc',
          amount: request.netAmountUsdc,
          memo: `Sivan Deal: ${request.agreementId}`,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Stellar payment settlement failed [HTTP ${response.status}]: ${errText}`);
      }

      const data: any = await response.json();
      const txHash = data.txHash || data.transferId || `tx_${idempotencyKey}`;
      const isTestnet = process.env.APP_ENV !== 'production';
      const explorerUrl = isTestnet
        ? `https://stellar.expert/explorer/testnet/tx/${txHash}`
        : `https://stellar.expert/explorer/public/tx/${txHash}`;

      return {
        success: true,
        agreementId: request.agreementId,
        txHash,
        explorerUrl,
        network: 'stellar',
        releasedAmount: request.netAmountUsdc,
        feeDeducted: request.feeAmountUsdc,
        destinationAddress: request.sellerStellarAddress,
        timestamp: new Date().toISOString(),
      };
    } catch (error: any) {
      throw new Error(`Stellar payment settlement execution failed: ${error.message || error}`);
    }
  }
}

export const stellarSettlementService = new StellarSettlementService();
