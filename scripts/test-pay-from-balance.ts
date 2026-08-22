import request from 'supertest';
import app from '../src/server';
import { escrowStore } from '../src/context';

async function main() {
  console.log('=== SIVAN AI: PAY-FROM-BALANCE END-TO-END TEST ===\n');

  const CORE_SECRET = process.env.CORE_API_SECRET || 'Yu3w1j5s-I7SgaxBNOAVcaUrW0SpkrlKoo7zppgnMrI';
  const buyerPhone = 'whatsapp:+2348079604214';
  const sellerPhone = 'whatsapp:+2349136717403';

  console.log('--- Step 1: User Accounts ---');
  await escrowStore.upsertUserByWhatsapp(buyerPhone, 'buyer');
  await escrowStore.upsertUserByWhatsapp(sellerPhone, 'seller');

  // Step 2: Create 12.00 USDC Service Agreement
  console.log('\n--- Step 2: Creating Service Agreement for "Logo design work" (12.00 USDC) ---');
  const createPayload = {
    clientRequestId: `req-${Date.now()}`,
    creatorWhatsapp: buyerPhone,
    buyerWhatsapp: buyerPhone,
    sellerWhatsapp: sellerPhone,
    amount: 12,
    currency: 'USDC',
    purpose: 'Logo design work',
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

  // Step 3: Seller Accepts Service Agreement
  console.log(`\n--- Step 3: Seller Accepts Agreement ---`);
  const acceptRes = await request(app)
    .post(`/api/escrows/${agreementId}/accept`)
    .set('x-core-api-key', CORE_SECRET)
    .send({ actorWhatsapp: sellerPhone });

  console.log('Accept Status:', acceptRes.status);
  console.log('Accepted State:', acceptRes.body?.escrow?.escrow?.status || acceptRes.body?.escrow?.status);

  // Step 4: Pay from Balance
  console.log(`\n--- Step 4: Buyer Pays from Sivan Balance ---`);
  const payRes = await request(app)
    .post(`/api/escrows/${agreementId}/pay-from-balance`)
    .set('x-core-api-key', CORE_SECRET)
    .send({ actorWhatsapp: buyerPhone });

  console.log('Pay-from-Balance Status:', payRes.status);
  const finalState = payRes.body?.escrow?.escrow?.status || payRes.body?.escrow?.status;
  console.log('Final State:', finalState);

  if (payRes.status === 200 && (finalState === 'IN_PROGRESS' || finalState === 'FUNDED')) {
    console.log('\n==================================================');
    console.log('🎉 PAY-FROM-BALANCE END-TO-END TEST PASSED SUCCESSFULLY!');
    console.log('==================================================\n');
    setTimeout(() => process.exit(0), 100);
  } else {
    console.error('❌ Pay-from-balance test failed:', payRes.body);
    setTimeout(() => process.exit(1), 100);
  }
}

main().catch((err) => {
  console.error('Test error:', err);
  process.exit(1);
});
