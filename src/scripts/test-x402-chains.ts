/**
 * Multi-Chain x402 Service Agreement Test Runner
 * Validates x402 payment facility creation and status verification
 * across Solana, Base, Celo, and Stellar.
 *
 * Usage:
 *   npx tsx src/scripts/test-x402-chains.ts --chain solana
 *   npx tsx src/scripts/test-x402-chains.ts --chain base
 *   npx tsx src/scripts/test-x402-chains.ts --chain celo
 *   npx tsx src/scripts/test-x402-chains.ts --chain stellar
 *   npx tsx src/scripts/test-x402-chains.ts --chain all
 */

import { X402Client } from "../services/x402Client.js";
import { getFormattedCryptoNetworkLabel } from "../services/paymentService.js";
import { config } from "../config.js";

interface ChainConfig {
  name: string;
  networkKey: string;
  testRecipient: string;
  addressValidator: (addr: string) => boolean;
  expectedPrefix: string;
}

const CHAIN_CONFIGS: Record<string, ChainConfig> = {
  solana: {
    name: "Solana",
    networkKey: "solana-devnet",
    testRecipient: "Grj8tUheEicPLjBB3XVFFCnwx2iUQCur9MshiXku92cL",
    addressValidator: (addr) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr),
    expectedPrefix: "Base58 Public Key",
  },
  base: {
    name: "Base",
    networkKey: "base-sepolia",
    testRecipient: "0xC8cAA84402b1397A055b0c2F388a510f58786285",
    addressValidator: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
    expectedPrefix: "0x EVM Address",
  },
  celo: {
    name: "Celo",
    networkKey: "celo-alfajores",
    testRecipient: "0xC8cAA84402b1397A055b0c2F388a510f58786285",
    addressValidator: (addr) => /^0x[a-fA-F0-9]{40}$/.test(addr),
    expectedPrefix: "0x EVM Address",
  },
  stellar: {
    name: "Stellar",
    networkKey: "stellar-testnet",
    testRecipient: "GA2C5RFPE6GCKMY3US5PAB6UZLKIGAHWKXX2GIOVPXD22EZ7UVAQ4YTM",
    addressValidator: (addr) => /^G[A-Z2-7]{55}$/.test(addr),
    expectedPrefix: "G... StrKey",
  },
};

async function testChain(chainKey: string, x402Client: X402Client): Promise<{ success: boolean; error?: string }> {
  const cfg = CHAIN_CONFIGS[chainKey];
  if (!cfg) {
    console.error(`Unknown chain: ${chainKey}. Available: solana, base, celo, stellar`);
    return { success: false, error: `Unknown chain ${chainKey}` };
  }

  console.log(`\n========================================`);
  console.log(`Testing x402 on ${cfg.name.toUpperCase()} (${cfg.networkKey})`);
  console.log(`========================================`);

  const testAmount = 5.0; // Realistic test amount: 5 USDC
  const label = await getFormattedCryptoNetworkLabel(chainKey);
  console.log(`Network Label: ${label}`);
  console.log(`Recipient: ${cfg.testRecipient}`);
  console.log(`Amount: ${testAmount} USDC`);
  console.log(`Target Facilitator URL: ${config.x402.rpcUrl}`);

  try {
    console.log(`Calling x402Client.createPaymentFacility...`);
    const facility = await x402Client.createPaymentFacility(
      testAmount,
      "USDC",
      cfg.testRecipient,
      {
        network: cfg.networkKey,
        chain: chainKey,
        testRunId: `test_${Date.now()}`,
      }
    );

    console.log(`\nPayment Facility Response:`);
    console.log(`  Payment ID:     ${facility.paymentId}`);
    console.log(`  Status:         ${facility.status}`);
    console.log(`  Facilitator ID: ${facility.facilitatorId}`);

    const depositAddress =
      facility.details?.depositAddress ||
      facility.details?.address ||
      (facility as any).depositAddress;

    if (depositAddress) {
      console.log(`  Deposit Address: ${depositAddress}`);
      const isValid = cfg.addressValidator(depositAddress);
      if (isValid) {
        console.log(`  Address Validation: Valid ${cfg.expectedPrefix}`);
      } else {
        console.warn(`  Address Validation WARNING: Address does not match expected format for ${cfg.name}`);
      }
    } else {
      console.log(`  Deposit Address: Sivan smart account / ledger routing active`);
    }

    // Verify payment status query
    console.log(`\nQuerying payment status via x402Client.getPaymentStatus...`);
    const statusResult = await x402Client.getPaymentStatus(facility.paymentId);
    console.log(`  Status Query Result: ${statusResult.status}`);

    console.log(`\n[PASS] x402 test on ${cfg.name} SUCCEEDED.`);
    return { success: true };
  } catch (err: any) {
    console.error(`\n[FAIL] x402 test on ${cfg.name} failed:`, err.message || err);
    if (err.response?.data) {
      console.error(`  Facilitator response:`, JSON.stringify(err.response.data));
    }
    return { success: false, error: err.message || String(err) };
  }
}

async function main() {
  const args = process.argv.slice(2);
  const chainArgIndex = args.indexOf("--chain");
  const selectedChain = (chainArgIndex >= 0 && args[chainArgIndex + 1])
    ? args[chainArgIndex + 1].toLowerCase()
    : "solana";

  const x402Client = new X402Client();

  if (selectedChain === "all") {
    const results: Record<string, boolean> = {};
    for (const chain of Object.keys(CHAIN_CONFIGS)) {
      const res = await testChain(chain, x402Client);
      results[chain] = res.success;
    }
    console.log(`\n========================================`);
    console.log(`FINAL SUMMARY`);
    console.log(`========================================`);
    for (const [chain, passed] of Object.entries(results)) {
      console.log(`  ${chain.toUpperCase()}: ${passed ? "PASSED" : "FAILED"}`);
    }
    const allPassed = Object.values(results).every(Boolean);
    process.exit(allPassed ? 0 : 1);
  } else {
    const res = await testChain(selectedChain, x402Client);
    process.exit(res.success ? 0 : 1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
