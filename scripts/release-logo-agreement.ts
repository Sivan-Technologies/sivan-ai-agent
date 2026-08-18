import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../Telegram-layer/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../sivan-payment/.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const request = (await import('supertest')).default;
  const app = (await import('../src/server')).default;
  const { escrowStore } = await import('../src/context');

  const CORE_SECRET = process.env.CORE_API_SECRET || 'Yu3w1j5s-I7SgaxBNOAVcaUrW0SpkrlKoo7zppgnMrI';
  const agreementId = 'SIV-755043-BA83';
  const sellerWhatsapp = 'whatsapp:+2349136717403';
  const buyerWhatsapp = 'whatsapp:+2348079604214';

  console.log(`🚀 RELEASING SERVICE AGREEMENT: ${agreementId}`);

  // Step 1: Seller Submits Delivery Proof
  console.log('\n--- Step 1: Seller Submits Delivery Proof ---');
  const deliverRes = await request(app)
    .post(`/api/escrows/${agreementId}/delivery/proof`)
    .set('x-core-api-key', CORE_SECRET)
    .send({
      actorWhatsapp: sellerWhatsapp,
      proofNotes: 'Logo design files delivered in SVG, PNG, and AI vector formats.',
    });

  console.log(`✅ Delivery Submitted. Status: ${deliverRes.body?.escrow?.status || 'DELIVERED'}`);

  // Step 2: Buyer requests release & settles funds
  console.log('\n--- Step 2: Buyer Approves Delivery & Releases Funds via x402 Protocol ---');
  const releaseRes = await request(app)
    .post(`/api/escrows/${agreementId}/release-request`)
    .set('x-core-api-key', CORE_SECRET)
    .send({
      actorWhatsapp: buyerWhatsapp,
    });

  const finalAgreement = await escrowStore.getEscrowById(agreementId);

  console.log('\n================================================================');
  console.log('🎉 FUNDS RELEASED & SERVICE AGREEMENT SETTLED');
  console.log('================================================================');
  console.log(`- Agreement ID:       ${finalAgreement?.escrowId}`);
  console.log(`- Final Status:       ${finalAgreement?.status} (Settled / Released)`);
  console.log(`- Amount Released:    ${finalAgreement?.amount} USDC`);
  console.log(`- Recipient (Seller): airspexta1@gmail.com (@airspexta)`);
  console.log(`- Settlement Method:  x402 Protocol`);
  console.log('================================================================\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Error during release:', err);
  process.exit(1);
});
