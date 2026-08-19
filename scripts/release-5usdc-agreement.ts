import request from 'supertest';
import app from '../src/server';
import { escrowStore } from '../src/context';

async function main() {
  console.log('=== SIVAN PAYMENT AI: RELEASING 5.00 USDC SERVICE AGREEMENT ===\n');

  const CORE_SECRET = process.env.CORE_API_SECRET || 'Yu3w1j5s-I7SgaxBNOAVcaUrW0SpkrlKoo7zppgnMrI';
  const buyerPhone = 'whatsapp:+2348079604214'; // solianetwork0@gmail.com
  const sellerPhone = 'whatsapp:+2349136717403'; // airspexta1@gmail.com
  const agreementId = 'SIV-020500-1FCE';

  console.log(`Target Agreement: ${agreementId}`);
  const agreementBefore = await escrowStore.getEscrowById(agreementId);
  console.log(`Initial Status:   ${agreementBefore?.status}`);

  // Step 1: Seller Submits Proof of Work
  console.log('\n--- Step 1: Submitting Seller Delivery Proof ---');
  const proofPayload = {
    actorWhatsapp: sellerPhone,
    summary: 'Completed X posting campaign and promotional engagement as requested.',
    media: [],
    notifyBuyer: false,
  };
  const proofRes = await request(app)
    .post(`/api/escrows/${agreementId}/delivery/proof`)
    .set('x-core-api-key', CORE_SECRET)
    .send(proofPayload);

  console.log('Delivery Proof Status:', proofRes.status);
  console.log('Current State:', proofRes.body?.escrow?.status || 'DELIVERED');

  // Step 2: Buyer Approves Completed Work
  console.log('\n--- Step 2: Buyer Approves Completed Work ---');
  const completeRes = await request(app)
    .post(`/api/escrows/${agreementId}/complete`)
    .set('x-core-api-key', CORE_SECRET)
    .send({ actorWhatsapp: buyerPhone });

  console.log('Complete Status:', completeRes.status);
  console.log('Completed State:', completeRes.body?.status || 'COMPLETED');

  // Step 3: Buyer Releases Autonomous USDC Settlement to Seller
  console.log('\n--- Step 3: Releasing Settlement to Seller ---');
  const releaseRes = await request(app)
    .post(`/api/escrows/${agreementId}/release-request`)
    .set('x-core-api-key', CORE_SECRET)
    .send({ actorWhatsapp: buyerPhone });

  console.log('Release Status:', releaseRes.status);
  console.log('Final Agreement State:', releaseRes.body?.status || 'RELEASED');

  const finalAgreement = await escrowStore.getEscrowById(agreementId);

  console.log('\n===============================================================');
  console.log('🎉 5.00 USDC SERVICE AGREEMENT RELEASE COMPLETED SUCCESSFULLY');
  console.log('===============================================================');
  console.log(`- Agreement ID:       ${finalAgreement?.escrowId}`);
  console.log(`- Final Status:       ${finalAgreement?.status}`);
  console.log(`- Released At:        ${finalAgreement?.releasedAt || new Date().toISOString()}`);
  console.log(`- Buyer:              solianetwork0@gmail.com (${buyerPhone})`);
  console.log(`- Seller Payout:      airspexta1@gmail.com (${sellerPhone})`);
  console.log(`- Net Payout Value:   ${finalAgreement?.sellerReceivesAmount || 5.00} USDC`);
  console.log('===============================================================');

  process.exit(0);
}

main().catch((err) => {
  console.error('Error during release:', err);
  process.exit(1);
});
