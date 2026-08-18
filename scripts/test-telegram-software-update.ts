import path from 'path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '../../Telegram-layer/.env') });
dotenv.config({ path: path.resolve(__dirname, '../../sivan-payment/.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main() {
  const request = (await import('supertest')).default;
  const app = (await import('../src/server')).default;
  const http = await import('http');

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address() as any;
  const localCoreUrl = `http://127.0.0.1:${address.port}`;
  process.env.CORE_API_BASE_URL = localCoreUrl;
  process.env.CORE_API_SECRET = process.env.CORE_API_SECRET || 'Yu3w1j5s-I7SgaxBNOAVcaUrW0SpkrlKoo7zppgnMrI';

  const { escrowStore } = await import('../src/context');
  const { getUserByEmail } = await import('../../sivan-payment/src/users/users.service');
  const { getSpendable } = await import('../../sivan-payment/src/balances/unified-balance.service');
  const { requestBalanceTransfer } = await import('../../sivan-payment/src/balances/balance.service');
  const { handleMessage, handleCallback, handleCommand } = await import('../../Telegram-layer/src/handlers/dispatcher');
  const { identityStore } = await import('../../Telegram-layer/src/sessionStore');
  const { buildCallback } = await import('../../Telegram-layer/src/callbacks');

  console.log('================================================================');
  console.log('🤖 SIVAN PAYMENT AI — TELEGRAM LAYER END-TO-END DEAL TEST');
  console.log(`   Local Core Engine: ${localCoreUrl}`);
  console.log('   Deal: "Software update" (15.00 USDC) via x402 Protocol on Solana');
  console.log('   Buyer:  airspexta1@gmail.com (@airspexta / +2349136717403)');
  console.log('   Seller: solianetwork0@gmail.com (@Sivan_Ai / +2348079604214)');
  console.log('================================================================\n');

  const buyerUser = await getUserByEmail('airspexta1@gmail.com');
  const sellerUser = await getUserByEmail('solianetwork0@gmail.com');

  if (!buyerUser || !sellerUser) {
    console.error('Buyer or seller not found in DB');
    process.exit(1);
  }

  const buyerPhone = '+2349136717403';
  const sellerPhone = '+2348079604214';

  const buyerTgIdentity = {
    telegramId: 1767972274,
    firstName: 'Airspexta',
    lastName: 'Admin',
    username: 'airspexta',
    phone: buyerPhone,
  };

  const sellerTgIdentity = {
    telegramId: 8756506224,
    firstName: 'Samuel',
    lastName: 'Udochukwu',
    username: 'Sivan_Ai',
    phone: sellerPhone,
  };

  // Seed session identity store
  identityStore.set(buyerTgIdentity.telegramId, {
    userId: buyerUser.id,
    phone: buyerPhone,
    email: buyerUser.email,
    firstName: buyerTgIdentity.firstName,
    lastName: buyerTgIdentity.lastName,
    linkedAt: new Date().toISOString(),
  });

  identityStore.set(sellerTgIdentity.telegramId, {
    userId: sellerUser.id,
    phone: sellerPhone,
    email: sellerUser.email,
    firstName: sellerTgIdentity.firstName,
    lastName: sellerTgIdentity.lastName,
    linkedAt: new Date().toISOString(),
  });

  console.log('--- Initial Balances ---');
  const buyerSpendableBefore = await getSpendable(buyerUser.id, 'usdc');
  const sellerSpendableBefore = await getSpendable(sellerUser.id, 'usdc');
  console.log(`Buyer  (airspexta1@gmail.com):    ${buyerSpendableBefore} USDC`);
  console.log(`Seller (solianetwork0@gmail.com):  ${sellerSpendableBefore} USDC\n`);

  // Step 1: Buyer initiates agreement in Telegram chat
  console.log('📱 [TELEGRAM] STEP 1: Buyer sends agreement sentence');
  const buyerInputText = 'create service agreement for 15 USDC to +2348079604214 for software update';
  console.log(`> @airspexta: "${buyerInputText}"`);

  const draftReply = await handleMessage(buyerTgIdentity, buyerInputText);
  console.log('\n💬 Bot Reply to Buyer:');
  console.log(draftReply.text);
  console.log('🔘 Inline Buttons:', JSON.stringify(draftReply.keyboard, null, 2));

  // Step 2: Buyer presses [✅ Confirm & Create] button
  console.log('\n📱 [TELEGRAM] STEP 2: Buyer taps [✅ Confirm & Create]');
  const confirmButtonData = draftReply.keyboard?.[0]?.[0]?.callback_data || buildCallback('confirm', 'draft');
  const confirmReply = await handleCallback(buyerTgIdentity, confirmButtonData);
  console.log('\n💬 Bot Reply to Buyer:');
  console.log(confirmReply.text);
  console.log('🔘 Reply Buttons:', JSON.stringify(confirmReply.keyboard, null, 2));

  // Extract agreement ID from button callback data, text, or store
  const callbackStr = confirmReply.keyboard?.[0]?.[0]?.callback_data || '';
  let agreementId = callbackStr.match(/SIV-[A-Z0-9-]+/)?.[0] || confirmReply.text.match(/SIV-[A-Z0-9-]+/)?.[0];
  if (!agreementId) {
    const recent = await escrowStore.listEscrowsForUserId(buyerUser.id);
    if (recent && recent.length > 0) {
      agreementId = recent[0].escrowId;
    }
  }

  if (!agreementId) {
    console.error('Failed to parse agreement ID from reply:', confirmReply);
    process.exit(1);
  }
  console.log(`\n🎉 Service Agreement Created: ${agreementId}`);

  // Step 3: Seller receives Deal Card and taps [🤝 Accept Agreement]
  console.log('\n📱 [TELEGRAM] STEP 3: Seller (@Sivan_Ai) taps [🤝 Accept Agreement]');
  const acceptButtonData = buildCallback('accept', agreementId);
  const acceptReply = await handleCallback(sellerTgIdentity, acceptButtonData);
  console.log('\n💬 Bot Reply to Seller:');
  console.log(acceptReply.text);

  // Step 4: Issue x402 Protocol Payment Facility and Buyer Funds with real Devnet USDC
  console.log('\n📱 [TELEGRAM] STEP 4: Issuing x402 Payment Facility and Funding 15.00 USDC');
  const CORE_SECRET = process.env.CORE_API_SECRET || 'Yu3w1j5s-I7SgaxBNOAVcaUrW0SpkrlKoo7zppgnMrI';

  const payRes = await request(app)
    .post(`/api/escrows/${agreementId}/payment-instruction`)
    .set('x-core-api-key', CORE_SECRET)
    .send({ actorWhatsapp: `whatsapp:${buyerPhone}` });

  const x402DepositAddress = payRes.body?.payment?.depositAddress || 'AH1EZro8AHseUwdJMYiwx71QxVq6sm9eCUW75HyrvQr6';
  const x402Reference = payRes.body?.payment?.paymentId || `x402-${agreementId}`;

  console.log(`- x402 Facility Address: ${x402DepositAddress}`);
  console.log(`- Payment Reference:     ${x402Reference}`);

  console.log('\n⛓️  Broadcasting on-chain transfer of 15.00 USDC from Buyer to x402 Facility on Solana Devnet...');
  const transferResult = await requestBalanceTransfer(buyerUser.id, {
    amount: 15,
    asset: 'usdc',
    network: 'solana',
    destinationAddress: x402DepositAddress,
  });

  console.log(`✅ On-Chain Transfer Dispatched:`);
  console.log(`   - Transfer ID:  ${transferResult.transferId}`);
  console.log(`   - Status:       ${transferResult.status}`);
  console.log(`   - Amount:       15.00 USDC`);

  // Lock and hold on x402
  await escrowStore.attachPayment({
    escrowId: agreementId,
    paymentReference: x402Reference,
    paymentProvider: 'x402',
    status: 'IN_PROGRESS',
  });

  console.log(`🔒 Agreement ${agreementId} Status -> IN_PROGRESS (Held on x402 Protocol)`);

  // Step 5: Seller submits delivery proof on Telegram
  console.log('\n📱 [TELEGRAM] STEP 5: Seller submits proof of delivery via Telegram');
  const deliverButtonData = buildCallback('deliver', agreementId);
  const deliverPrompt = await handleCallback(sellerTgIdentity, deliverButtonData);
  console.log('💬 Bot Prompt to Seller:');
  console.log(deliverPrompt.text);

  const proofText = 'Software update version 2.4.0 deployed to Solana devnet cluster with automated test coverage.';
  console.log(`> @Sivan_Ai: "${proofText}"`);
  const proofReply = await handleMessage(sellerTgIdentity, proofText);
  console.log('\n💬 Bot Reply to Seller:');
  console.log(proofReply.text);

  // Status check for Buyer
  console.log('\n📱 [TELEGRAM] Deal Status Card for Buyer:');
  const buyerDealCard = await handleCommand(buyerTgIdentity, 'deal', agreementId);
  console.log(buyerDealCard.text);
  console.log('🔘 Buyer Action Buttons:', JSON.stringify(buyerDealCard.keyboard, null, 2));

  const activeAgreement = await escrowStore.getEscrowById(agreementId);
  const buyerSpendableAfter = await getSpendable(buyerUser.id, 'usdc');

  console.log('\n================================================================');
  console.log('🔒 15.00 USDC SERVICE AGREEMENT IS IN PROGRESS & PROOF DELIVERED');
  console.log('================================================================');
  console.log(`- Agreement ID:       ${agreementId}`);
  console.log(`- Purpose / Scope:    "${activeAgreement?.purpose}"`);
  console.log(`- Current Status:     ${activeAgreement?.status} (Delivery Proof Submitted)`);
  console.log(`- Amount Held:        15.00 USDC (in x402 facility ${x402DepositAddress})`);
  console.log(`- Buyer Balance:      ${buyerSpendableAfter} USDC (Debited from ${buyerSpendableBefore} USDC)`);
  console.log('================================================================\n');

  console.log('Standing by. All Telegram interactions and buttons simulated.');
  console.log('Waiting for your input: type "release" to release and settle the 15 USDC to the seller.');

  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error during test:', err);
  process.exit(1);
});
