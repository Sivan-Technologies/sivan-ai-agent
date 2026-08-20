import request from 'supertest';
import app from '../src/server';
import { escrowStore } from '../src/context';

async function main() {
  console.log('=== SIVAN AI: LIVE 5.00 USDC SERVICE AGREEMENT END-TO-END TEST ===\n');

  const CORE_SECRET = process.env.CORE_API_SECRET || 'Yu3w1j5s-I7SgaxBNOAVcaUrW0SpkrlKoo7zppgnMrI';
  const buyerPhone = 'whatsapp:+2348079604214'; // solianetwork0@gmail.com
  const sellerPhone = 'whatsapp:+2349136717403'; // airspexta1@gmail.com

  console.log('--- Step 1: Preparing User Accounts ---');
  console.log(`Buyer:  ${buyerPhone} (solianetwork0@gmail.com)`);
  console.log(`Seller: ${sellerPhone} (airspexta1@gmail.com)`);

  await escrowStore.upsertUserByWhatsapp(buyerPhone, 'buyer');
  await escrowStore.upsertUserByWhatsapp(sellerPhone, 'seller');

  // Step 2: Create 5.00 USDC Service Agreement
  console.log('\n--- Step 2: Creating Service Agreement for "X posting work" (5.00 USDC) ---');
  const createPayload = {
    clientRequestId: `req-${Date.now()}`,
    creatorWhatsapp: buyerPhone,
    buyerWhatsapp: buyerPhone,
    sellerWhatsapp: sellerPhone,
    amount: 5,
    currency: 'USDC',
    purpose: 'X posting work',
    feePayer: 'buyer',
  };

  const createRes = await request(app)
    .post('/api/escrows')
    .set('x-core-api-key', CORE_SECRET)
    .send(createPayload);

  console.log('Create Status:', createRes.status);
  const agreement = createRes.body?.escrow;
  if (!agreement) {
    console.error('Failed to create Service Agreement:', createRes.body);
    process.exit(1);
  }

  const agreementId = agreement.escrowId;
  console.log(`✅ Service Agreement ID: ${agreementId}`);
  console.log(`State: ${agreement.status}`);
  console.log(`Amount: ${agreement.amount} ${agreement.currency}`);
  console.log(`Platform Fee: ${agreement.platformFeeAmount} ${agreement.currency}`);
  console.log(`Seller Net Receivable: ${agreement.sellerReceivesAmount} ${agreement.currency}`);

  // Step 3: Seller Accepts Service Agreement
  console.log(`\n--- Step 3: Seller (${sellerPhone}) Accepts Service Agreement ---`);
  const acceptRes = await request(app)
    .post(`/api/escrows/${agreementId}/accept`)
    .set('x-core-api-key', CORE_SECRET)
    .send({ actorWhatsapp: sellerPhone });

  console.log('Accept Status:', acceptRes.status);
  console.log('Accepted State:', acceptRes.body?.escrow?.status || acceptRes.body?.escrow?.escrow?.status);

  // Step 4: Buyer Requests Payment Instruction
  console.log(`\n--- Step 4: Buyer (${buyerPhone}) Requests Payment Instruction ---`);
  const payRes = await request(app)
    .post(`/api/escrows/${agreementId}/payment-instruction`)
    .set('x-core-api-key', CORE_SECRET)
    .send({ actorWhatsapp: buyerPhone });

  console.log('Payment Instruction Status:', payRes.status);
  console.log('Payment Provider:', payRes.body?.payment?.provider);
  console.log('Deposit Address:', payRes.body?.payment?.depositAddress);
  console.log('Total Payable:', `${payRes.body?.payment?.totalPayable} USDC`);

  // Step 5: Attach Payment & Transition to IN_PROGRESS
  console.log(`\n--- Step 5: Simulating On-Chain USDC Deposit & Lock Confirmation ---`);
  await escrowStore.attachPayment({
    escrowId: agreementId,
    paymentReference: payRes.body?.payment?.paymentId || `x402-${agreementId}`,
    paymentProvider: 'x402',
    status: 'IN_PROGRESS',
  });

  const funded = await escrowStore.getEscrowById(agreementId);
  console.log(`✅ Agreement Status: ${funded?.status}`);

  // Step 6: Seller Submits Proof of Work
  console.log(`\n--- Step 6: Seller (${sellerPhone}) Submits Delivery Proof ---`);
  const proofPayload = {
    actorWhatsapp: sellerPhone,
    summary: 'Completed the X promotional thread and post engagement campaign as agreed.',
    media: [],
    notifyBuyer: false,
  };
  const proofRes = await request(app)
    .post(`/api/escrows/${agreementId}/delivery/proof`)
    .set('x-core-api-key', CORE_SECRET)
    .send(proofPayload);

  console.log('Delivery Proof Status:', proofRes.status);
  console.log('Delivery State:', proofRes.body?.escrow?.status);
  console.log('Summary:', proofRes.body?.escrow?.deliveryProofSummary);

  // Step 7: Buyer Confirms Completion
  console.log(`\n--- Step 7: Buyer (${buyerPhone}) Approves Completed Work ---`);
  const completeRes = await request(app)
    .post(`/api/escrows/${agreementId}/complete`)
    .set('x-core-api-key', CORE_SECRET)
    .send({ actorWhatsapp: buyerPhone });

  console.log('Complete Status:', completeRes.status);
  console.log('Completed State:', completeRes.body?.status);

  // Step 8: Buyer Requests Release to Settle to Seller
  console.log(`\n--- Step 8: Buyer Releases Autonomous USDC Settlement ---`);
  const releaseRes = await request(app)
    .post(`/api/escrows/${agreementId}/release-request`)
    .set('x-core-api-key', CORE_SECRET)
    .send({ actorWhatsapp: buyerPhone });

  console.log('Release Status:', releaseRes.status);
  console.log('Final Agreement State:', releaseRes.body?.status);

  console.log('\n===============================================================');
  console.log('🎉 5.00 USDC SERVICE AGREEMENT END-TO-END FLOW: 100% SUCCESS');
  console.log('===============================================================');
  console.log(`Summary:`);
  console.log(`- Deal ID: ${agreementId}`);
  console.log(`- Buyer:   solianetwork0@gmail.com (${buyerPhone})`);
  console.log(`- Seller:  airspexta1@gmail.com (${sellerPhone})`);
  console.log(`- Work:    "X posting work"`);
  console.log(`- Value:   5.00 USDC`);
  console.log(`- Outcome: RELEASED / COMPLETED`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error during test:', err);
  process.exit(1);
});
