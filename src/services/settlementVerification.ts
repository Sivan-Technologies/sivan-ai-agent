import fs from "fs";
import path from "path";
import { config } from "../config";
import { captureOperationalError, capturePaymentWarning } from "./monitoring";
import { SapAgent } from "./sapAgent";
import { X402Client } from "./x402Client";

export type VerificationStatus = "ok" | "warning" | "failed";

export interface SettlementVerificationProof {
  status: VerificationStatus;
  checkedAt: string;
  environment: string;
  sap: any;
  x402: any;
  warnings: string[];
  proofFile?: string;
}

let latestProof: SettlementVerificationProof | null = null;

function boolEnv(key: string) {
  return ["1", "true", "yes", "on"].includes((process.env[key] || "").trim().toLowerCase());
}

function configured(value: string) {
  return Boolean(value && !/^your-|^change-me/i.test(value));
}

function proofStatus(sap: any, x402: any, warnings: string[]): VerificationStatus {
  if (sap?.status === "failed" || x402?.status === "failed") return "failed";
  if (warnings.length > 0 || sap?.status !== "ok" || x402?.status !== "ok") return "warning";
  return "ok";
}

async function writeProofFile(proof: SettlementVerificationProof) {
  const outputPath = process.env.SETTLEMENT_PROOF_OUTPUT || path.join("data", "settlement-verification-proof.json");

  const resolved = path.resolve(process.cwd(), outputPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  fs.writeFileSync(resolved, JSON.stringify(proof, null, 2));
  proof.proofFile = resolved;
  return proof;
}

export async function runSettlementVerification(): Promise<SettlementVerificationProof> {
  const checkedAt = new Date().toISOString();
  const warnings: string[] = [];

  if (!configured(config.sap.rpcUrl) || !configured(config.sap.apiKey)) {
    warnings.push("SAP RPC URL or Synapse API key is not configured");
  }
  if (!configured(config.x402.rpcUrl) || !configured(config.x402.clientSecret)) {
    warnings.push("x402 facilitator URL or client secret is not configured");
  }

  const sap = await (async () => {
    if (!configured(config.sap.rpcUrl) || !configured(config.sap.apiKey)) {
      return { status: "skipped", reason: "SAP credentials missing" };
    }
    try {
      const agent = new SapAgent(config.sap.rpcUrl, config.sap.apiKey);
      return await agent.verifyConnectivity(
        process.env.SETTLEMENT_VERIFY_TASK_TYPE || "content-creation",
        { registerAgent: boolEnv("SAP_VERIFY_REGISTER_AGENT") }
      );
    } catch (err: any) {
      captureOperationalError("SAP production verification failed", err);
      return { status: "failed", error: err.message || String(err) };
    }
  })();

  const x402 = await (async () => {
    if (!configured(config.x402.rpcUrl) || !configured(config.x402.clientSecret)) {
      return { status: "skipped", reason: "x402 credentials missing" };
    }
    try {
      const client = new X402Client();
      return await client.verifyConnectivity({
        paymentId: process.env.X402_VERIFY_PAYMENT_ID,
        createProbe: boolEnv("X402_VERIFY_CREATE_PAYMENT"),
        amount: Number(process.env.X402_VERIFY_AMOUNT || "0.01"),
        recipient: process.env.X402_VERIFY_RECIPIENT || config.sap.agentPublicKey,
      });
    } catch (err: any) {
      captureOperationalError("x402 production verification failed", err);
      return { status: "failed", error: err.message || String(err) };
    }
  })();

  if (x402.status === "skipped") {
    warnings.push("x402 live proof not run; provide X402_VERIFY_PAYMENT_ID or set X402_VERIFY_CREATE_PAYMENT=true");
  }
  if (sap.status === "skipped") {
    warnings.push("SAP live proof not run; configure SAP/Synapse credentials");
  }

  const proof: SettlementVerificationProof = {
    status: proofStatus(sap, x402, warnings),
    checkedAt,
    environment: config.app.env,
    sap,
    x402,
    warnings,
  };

  if (proof.status !== "ok") {
    capturePaymentWarning("Settlement production verification is incomplete", {
      status: proof.status,
      warnings,
      sapStatus: sap.status,
      x402Status: x402.status,
    });
  }

  latestProof = await writeProofFile(proof);
  return latestProof;
}

export function getLatestSettlementVerification() {
  return latestProof;
}
