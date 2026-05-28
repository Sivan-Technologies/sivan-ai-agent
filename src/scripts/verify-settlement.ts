import { runSettlementVerification } from "../services/settlementVerification";

async function main() {
  const proof = await runSettlementVerification();
  console.log(JSON.stringify(proof, null, 2));
  if (proof.status === "failed") {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Settlement verification failed", err.message || err);
  process.exit(1);
});
