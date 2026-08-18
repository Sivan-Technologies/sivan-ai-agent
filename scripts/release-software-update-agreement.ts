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
  const { handleCallback, handleMessage } = await import('../../Telegram-layer/src/handlers/dispatcher');
  const { identityStore } = await import('../../Telegram-layer/src/sessionStore');
  const { buildCallback } = await import('../../Telegram-layer/src/callbacks');
  const { Connection, Keypair, PublicKey, sendAndConfirmTransaction, Transaction } = await import('@solana/web3.js');
  const { createTransferInstruction, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction } = await import('@solana/spl-token');
  const bs58 = (await import('bs58')).default;

  const agreementId = 'SIV-471082-91BE';
  const buyerUser = await getUserByEmail('airspexta1@gmail.com');
  const sellerUser = await getUserByEmail('solianetwork0@gmail.com');
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

  identityStore.set(buyerTgIdentity.telegramId, {
    userId: buyerUser.id,
    phone: buyerPhone,
    email: buyerUser.email,
    firstName: buyerTgIdentity.firstName,
    lastName: buyerTgIdentity.lastName,
    linkedAt: new Date().toISOString(),
  });

  console.log('================================================================');
  console.log(`🚀 RELEASING 15.00 USDC SERVICE AGREEMENT: ${agreementId}`);
  console.log('================================================================\n');

  // Step 1: Buyer clicks [Release Funds] in Telegram
  console.log('📱 [TELEGRAM] Buyer clicks [Release Funds] callback');
  const releaseCallbackData = buildCallback('release', agreementId);
  const confirmScreen = await handleCallback(buyerTgIdentity, releaseCallbackData);
  console.log('\n💬 Bot Confirmation Prompt:');
  console.log(confirmScreen.text);

  // Step 2: Buyer confirms destructive action [Yes, Release]
  console.log('\n📱 [TELEGRAM] Buyer taps [✅ Yes, Release]');
  const confirmActionData = buildCallback('confirm', `release|${agreementId}`);
  const releaseReply = await handleCallback(buyerTgIdentity, confirmActionData);
  console.log('\n💬 Bot Release Reply:');
  console.log(releaseReply.text);

  // Step 3: Execute on-chain transfer of 15.00 USDC to Seller's Devnet Wallet
  console.log('\n⛓️  Settling 15.00 USDC On-Chain from x402 Facility to Seller Wallet...');
  const privateKeyBase58 = '38fgRr9y2vyi11spmbWZrhbA1RF5YdMk6ZMeNg5b5sqhcRZ91imzakHDhp9YUo8Q7TUMRxW7uQBpQBfTp7Z3C9fY';
  const secretKey = bs58.decode(privateKeyBase58);
  const facilityKeypair = Keypair.fromSecretKey(secretKey);
  const sellerWallet = new PublicKey('W7ydftpwxsEE7732N2w5UTHDFrBvYUDmAeuGCZwPDu7');
  const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const sourceAta = getAssociatedTokenAddressSync(USDC_MINT, facilityKeypair.publicKey);
  const destAta = getAssociatedTokenAddressSync(USDC_MINT, sellerWallet);

  const tx = new Transaction();
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      facilityKeypair.publicKey,
      destAta,
      sellerWallet,
      USDC_MINT
    ),
    createTransferInstruction(
      sourceAta,
      destAta,
      facilityKeypair.publicKey,
      15000000 // 15 USDC
    )
  );

  const txHash = await sendAndConfirmTransaction(connection, tx, [facilityKeypair]);
  console.log('✅ On-Chain Settlement Complete! Tx Signature:', txHash);

  // Update agreement state
  await escrowStore.transitionEscrow(agreementId, 'RELEASED', {
    actor: `whatsapp:${buyerPhone}`,
    actorRole: 'buyer',
    channel: 'telegram',
    eventType: 'autonomous_usdc_release',
    reason: 'Buyer confirmed release on Telegram layer',
    metadata: { txHash },
  });

  const finalAgreement = await escrowStore.getEscrowById(agreementId);
  const buyerBalAfter = await getSpendable(buyerUser.id, 'usdc');
  const sellerBalAfter = await getSpendable(sellerUser.id, 'usdc');

  console.log('\n================================================================');
  console.log('🎉 15.00 USDC SERVICE AGREEMENT RELEASED & SETTLED ON-CHAIN');
  console.log('================================================================');
  console.log(`- Agreement ID:       ${finalAgreement?.escrowId}`);
  console.log(`- Status:             ${finalAgreement?.status}`);
  console.log(`- Solana Devnet Tx:   ${txHash}`);
  console.log(`- Buyer Balance:      ${buyerBalAfter} USDC`);
  console.log(`- Seller Balance:     ${sellerBalAfter} USDC`);
  console.log('================================================================\n');

  process.exit(0);
}

main().catch((err) => {
  console.error('Error during release:', err);
  process.exit(1);
});
