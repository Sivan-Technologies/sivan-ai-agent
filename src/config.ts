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
    channels: envValue("PAYSTACK_CHANNELS", envValue("NAIRA_PAYMENT_METHODS", "bank_transfer"))
      .split(",")
      .map((channel) => channel.trim())
      .filter(Boolean),
  },
  monnify: {
    apiKey: envValue("MONNIFY_API_KEY"),
    secretKey: envValue("MONNIFY_SECRET_KEY"),
    contractCode: envValue("MONNIFY_CONTRACT_CODE"),
    baseUrl: envValue("MONNIFY_BASE_URL", "https://sandbox.monnify.com"),
    webhookUrl: envValue("MONNIFY_WEBHOOK_URL"),
    sourceAccountNumber: envValue("MONNIFY_SOURCE_ACCOUNT_NUMBER"),
    timeoutMs: envNumber("MONNIFY_TIMEOUT_MS", 8000),
    paymentMethods: envValue("MONNIFY_PAYMENT_METHODS", envValue("NAIRA_PAYMENT_METHODS", "bank_transfer"))
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean),
  },
  palmpay: {
    appId: envValue("PALMPAY_APP_ID"),
    merchantId: envValue("PALMPAY_MERCHANT_ID"),
    merchantPrivateKey: envValue("PALMPAY_MERCHANT_PRIVATE_KEY"),
    merchantPublicKey: envValue("PALMPAY_MERCHANT_PUBLIC_KEY"),
    platformPublicKey: envValue("PALMPAY_PLATFORM_PUBLIC_KEY"),
    baseUrl: envValue("PALMPAY_BASE_URL", "https://open-gw-sandbox.palmpay-inc.com"),
    webhookUrl: envValue("PALMPAY_WEBHOOK_URL"),
    callbackUrl: envValue("PALMPAY_CALLBACK_URL", envValue("PAYSTACK_CALLBACK_URL")),
    countryCode: envValue("PALMPAY_COUNTRY_CODE", "NG"),
    timeoutMs: envNumber("PALMPAY_TIMEOUT_MS", 8000),
    orderExpireSeconds: envNumber("PALMPAY_ORDER_EXPIRE_SECONDS", 1800),
    paymentMethods: envValue("PALMPAY_PAYMENT_METHODS", envValue("NAIRA_PAYMENT_METHODS", "bank_transfer"))
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean),
    payoutEnabled: envValue("PALMPAY_PAYOUT_ENABLED", "false").toLowerCase() === "true",
    payoutNotifyUrl: envValue("PALMPAY_PAYOUT_NOTIFY_URL"),
  },
  flutterwave: {
    secretKey: envValue("FLUTTERWAVE_SECRET_KEY"),
    publicKey: envValue("FLUTTERWAVE_PUBLIC_KEY"),
    baseUrl: envValue("FLUTTERWAVE_BASE_URL", "https://api.flutterwave.com"),
    webhookSecret: envValue("FLUTTERWAVE_WEBHOOK_SECRET"),
    webhookUrl: envValue("FLUTTERWAVE_WEBHOOK_URL"),
    timeoutMs: envNumber("FLUTTERWAVE_TIMEOUT_MS", 8000),
    paymentMethods: envValue("FLUTTERWAVE_PAYMENT_METHODS", envValue("NAIRA_PAYMENT_METHODS", "bank_transfer"))
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean),
    dynamicAccountExpirySeconds: envNumber("FLUTTERWAVE_DYNAMIC_ACCOUNT_EXPIRY_SECONDS", 3600),
  },
  nairaPayments: {
    methods: envValue("NAIRA_PAYMENT_METHODS", "bank_transfer")
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean),
    fundingWindowHours: envNumber("NAIRA_FUNDING_WINDOW_HOURS", 24),
    highValueFundingWindowHours: envNumber("NAIRA_HIGH_VALUE_FUNDING_WINDOW_HOURS", 48),
    highValueFundingWindowAmount: envNumber("NAIRA_HIGH_VALUE_FUNDING_WINDOW_AMOUNT", 100000),
    fundingReminderBeforeExpiryHours: envNumber("NAIRA_FUNDING_REMINDER_BEFORE_EXPIRY_HOURS", 6),
  },
  reconciliation: {
    enabled: envValue("RECONCILIATION_WORKER_ENABLED", "false").toLowerCase() === "true",
    intervalMs: envNumber("RECONCILIATION_WORKER_INTERVAL_MS", 24 * 60 * 60 * 1000),
    lookbackHours: envNumber("RECONCILIATION_LOOKBACK_HOURS", 24),
    providers: envValue("RECONCILIATION_PROVIDERS", "paystack,monnify,palmpay,flutterwave")
      .split(",")
      .map((provider) => provider.trim())
      .filter(Boolean),
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
  if (config.app.env === "production") {
    if (config.app.databaseProvider === "sqlite") {
      throw new Error("SQLite database provider is not allowed in production. Sivan requires PostgreSQL.");
    }
    if (config.app.databaseUrl.includes("/tmp/") || config.app.databaseUrl.includes("/temp/")) {
      throw new Error("Database URL cannot point to temporary/ephemeral storage (/tmp) in production to prevent data loss.");
    }
  }

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
