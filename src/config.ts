import dotenv from "dotenv";
import path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });

function envValue(key: string, fallback = "") {
  const value = process.env[key]?.trim();
  if (!value) {
    return fallback;
  }

  const lower = value.toLowerCase();
  const looksPlaceholder =
    lower.startsWith("your-") ||
    lower.startsWith("change-me") ||
    lower.includes("example.net") ||
    lower.includes("example.com");

  return looksPlaceholder ? fallback : value;
}

function envNumber(key: string, fallback: number) {
  const value = Number(envValue(key, String(fallback)));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const databaseProvider = envValue("DATABASE_PROVIDER", "sqlite");
const defaultDatabaseUrl = path.resolve(process.cwd(), "data", "sivan-escrow-agent.db");
const databaseUrl =
  databaseProvider === "postgres"
    ? envValue("DATABASE_URL", envValue("POSTGRES_DATABASE_URL", defaultDatabaseUrl))
    : envValue("DATABASE_URL", defaultDatabaseUrl);

export const config = {
  synapse: {
    apiKey: envValue("SYNAPSE_API_KEY"),
    rpcUrl: envValue("SYNAPSE_RPC_URL", envValue("SAP_RPC_URL")),
    wsUrl: envValue("SYNAPSE_WS_URL"),
    grpcUrl: envValue("SYNAPSE_GRPC_URL"),
    x402FacilitatorUrl: envValue("SYNAPSE_X402_FACILITATOR_URL", envValue("X402_RPC_URL")),
    x402Network: envValue("SYNAPSE_X402_NETWORK", "solana-devnet"),
    usdcMint: envValue("SYNAPSE_USDC_MINT"),
  },
  sap: {
    rpcUrl: envValue("SAP_RPC_URL", envValue("SYNAPSE_RPC_URL")),
    agentPrivateKey: envValue("SAP_AGENT_PRIVATE_KEY"),
    agentPublicKey: envValue("SAP_AGENT_PUBLIC_KEY"),
    apiKey: envValue("SYNAPSE_API_KEY"),
  },
  aceData: {
    apiKey: envValue("ACE_DATA_API_KEY"),
    baseUrl: envValue("ACE_DATA_BASE_URL", "https://api.acedata.cloud"),
  },
  x402: {
    rpcUrl: envValue("X402_RPC_URL", envValue("SYNAPSE_X402_FACILITATOR_URL")),
    clientId: envValue("X402_CLIENT_ID", envValue("SAP_AGENT_PUBLIC_KEY", "sivan-escrow-agent")),
    clientSecret: envValue("X402_CLIENT_SECRET", envValue("SYNAPSE_API_KEY")),
    network: envValue("SYNAPSE_X402_NETWORK", "solana-devnet"),
    usdcMint: envValue("SYNAPSE_USDC_MINT"),
  },
  paystack: {
    secretKey: envValue("PAYSTACK_SECRET_KEY"),
    publicKey: envValue("PAYSTACK_PUBLIC_KEY"),
    baseUrl: envValue("PAYSTACK_BASE_URL", "https://api.paystack.co"),
    webhookSecret: envValue("PAYSTACK_WEBHOOK_SECRET"),
    receiverAccount: envValue("PAYSTACK_RECEIVER_ACCOUNT"),
    callbackUrl: envValue("PAYSTACK_CALLBACK_URL"),
    timeoutMs: envNumber("PAYSTACK_TIMEOUT_MS", 8000),
    channels: envValue("PAYSTACK_CHANNELS", "bank_transfer")
      .split(",")
      .map((channel) => channel.trim())
      .filter(Boolean),
  },
  monnify: {
    apiKey: envValue("MONNIFY_API_KEY"),
    secretKey: envValue("MONNIFY_SECRET_KEY"),
    baseUrl: envValue("MONNIFY_BASE_URL", "https://sandbox.monnify.com"),
    timeoutMs: envNumber("MONNIFY_TIMEOUT_MS", 8000),
  },
  app: {
    env: envValue("NODE_ENV", "development"),
    logLevel: envValue("LOG_LEVEL", "info"),
    databaseProvider,
    databaseUrl,
    webhookUrl: envValue("WEBHOOK_URL"),
    notificationUrl: envValue("NOTIFICATION_URL"),
    notificationSecret: envValue("NOTIFICATION_SECRET"),
  },
};

export function validateConfig() {
  if (process.env.PAYOUT_VERIFICATION_TEST_MODE === "true") {
    if (!config.paystack.secretKey.startsWith("sk_test_")) {
      throw new Error("PAYOUT_VERIFICATION_TEST_MODE requires a Paystack sk_test_ secret key");
    }
    if (!envValue("PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS")) {
      throw new Error("PAYOUT_VERIFICATION_TEST_MODE requires PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS");
    }
    console.warn("[WARN] Controlled payout verification test mode is enabled for explicitly allowlisted accounts");
  }

  const required = [
    { key: "SYNAPSE_API_KEY", value: config.synapse.apiKey },
    { key: "SYNAPSE_RPC_URL or SAP_RPC_URL", value: config.synapse.rpcUrl },
    { key: "SAP_AGENT_PRIVATE_KEY", value: config.sap.agentPrivateKey },
    { key: "SAP_AGENT_PUBLIC_KEY", value: config.sap.agentPublicKey },
    { key: "ACE_DATA_API_KEY", value: config.aceData.apiKey },
    { key: "SYNAPSE_X402_FACILITATOR_URL or X402_RPC_URL", value: config.x402.rpcUrl },
    { key: "PAYSTACK_SECRET_KEY", value: config.paystack.secretKey },
  ];
  const missing = required.filter((entry) => !entry.value);
  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.map((entry) => entry.key).join(", ")}`;
    if (config.app.env === "production") {
      throw new Error(message);
    }
    console.warn(`[WARN] ${message}`);
  }
}
