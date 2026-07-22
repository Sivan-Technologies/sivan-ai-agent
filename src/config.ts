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
const databaseMode = (envValue("DATABASE_MODE", "test").toLowerCase() === "live" ? "live" : "test") as "test" | "live";
const defaultDatabaseUrl = path.resolve(process.cwd(), "data", "sivan-escrow-agent.db");
const databaseUrl =
  databaseMode === "live"
    ? envValue("LIVE_DATABASE_URL", envValue("DATABASE_URL", defaultDatabaseUrl))
    : envValue("DATABASE_URL", defaultDatabaseUrl);

export const config = {
  databaseMode,
  synapse: {
    apiKey: envValue("SYNAPSE_API_KEY"),
    rpcUrl: envValue("SYNAPSE_RPC_URL", envValue("SAP_RPC_URL")),
    wsUrl: envValue("SYNAPSE_WS_URL"),
    grpcUrl: envValue("SYNAPSE_GRPC_URL"),
    x402FacilitatorUrl: envValue("SYNAPSE_X402_FACILITATOR_URL", envValue("X402_RPC_URL")),
    x402Network: envValue("SYNAPSE_X402_NETWORK", "solana-devnet"),
    usdcMint: envValue("SYNAPSE_USDC_MINT"),
    testFacilitatorUrl: envValue("SYNAPSE_X402_TEST_FACILITATOR_URL", "https://facilitator.payai.network"),
    liveFacilitatorUrl: envValue("SYNAPSE_X402_LIVE_FACILITATOR_URL"),
    liveNetwork: envValue("SYNAPSE_X402_LIVE_NETWORK", "solana-mainnet"),
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
  monnify: {
    apiKey: envValue("MONNIFY_API_KEY"),
    secretKey: envValue("MONNIFY_SECRET_KEY"),
    contractCode: envValue("MONNIFY_CONTRACT_CODE"),
    testApiKey: envValue("MONNIFY_TEST_API_KEY"),
    testSecretKey: envValue("MONNIFY_TEST_SECRET_KEY"),
    testContractCode: envValue("MONNIFY_TEST_CONTRACT_CODE"),
    liveApiKey: envValue("MONNIFY_LIVE_API_KEY"),
    liveSecretKey: envValue("MONNIFY_LIVE_SECRET_KEY"),
    liveContractCode: envValue("MONNIFY_LIVE_CONTRACT_CODE"),
    baseUrl: envValue("MONNIFY_BASE_URL", "https://sandbox.monnify.com"),
    liveBaseUrl: envValue("MONNIFY_LIVE_BASE_URL", "https://api.monnify.com"),
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
    testAppId: envValue("PALMPAY_TEST_APP_ID"),
    testMerchantId: envValue("PALMPAY_TEST_MERCHANT_ID"),
    testMerchantPrivateKey: envValue("PALMPAY_TEST_MERCHANT_PRIVATE_KEY"),
    testMerchantPublicKey: envValue("PALMPAY_TEST_MERCHANT_PUBLIC_KEY"),
    testPlatformPublicKey: envValue("PALMPAY_TEST_PLATFORM_PUBLIC_KEY"),
    liveAppId: envValue("PALMPAY_LIVE_APP_ID"),
    liveMerchantId: envValue("PALMPAY_LIVE_MERCHANT_ID"),
    liveMerchantPrivateKey: envValue("PALMPAY_LIVE_MERCHANT_PRIVATE_KEY"),
    liveMerchantPublicKey: envValue("PALMPAY_LIVE_MERCHANT_PUBLIC_KEY"),
    livePlatformPublicKey: envValue("PALMPAY_LIVE_PLATFORM_PUBLIC_KEY"),
    baseUrl: envValue("PALMPAY_BASE_URL", "https://open-gw-sandbox.palmpay-inc.com"),
    liveBaseUrl: envValue("PALMPAY_LIVE_BASE_URL", "https://open-gw.palmpay-inc.com"),
    webhookUrl: envValue("PALMPAY_WEBHOOK_URL"),
    callbackUrl: envValue("PALMPAY_CALLBACK_URL"),
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
    secretKey: databaseMode === "live"
      ? envValue("FLUTTERWAVE_LIVE_SECRET_KEY", envValue("FLUTTERWAVE_SECRET_KEY"))
      : envValue("FLUTTERWAVE_TEST_SECRET_KEY", envValue("FLUTTERWAVE_SECRET_KEY")),
    publicKey: databaseMode === "live"
      ? envValue("FLUTTERWAVE_LIVE_PUBLIC_KEY", envValue("FLUTTERWAVE_PUBLIC_KEY"))
      : envValue("FLUTTERWAVE_TEST_PUBLIC_KEY", envValue("FLUTTERWAVE_PUBLIC_KEY")),
    liveSecretKey: envValue("FLUTTERWAVE_LIVE_SECRET_KEY", envValue("FLUTTERWAVE_SECRET_KEY")),
    livePublicKey: envValue("FLUTTERWAVE_LIVE_PUBLIC_KEY", envValue("FLUTTERWAVE_PUBLIC_KEY")),
    testSecretKey: envValue("FLUTTERWAVE_TEST_SECRET_KEY"),
    testPublicKey: envValue("FLUTTERWAVE_TEST_PUBLIC_KEY"),
    baseUrl: envValue("FLUTTERWAVE_BASE_URL", "https://api.flutterwave.com"),
    webhookSecret: envValue("FLUTTERWAVE_WEBHOOK_SECRET"),
    webhookUrl: envValue("FLUTTERWAVE_WEBHOOK_URL"),
    callbackUrl: envValue("FLUTTERWAVE_CALLBACK_URL"),
    timeoutMs: envNumber("FLUTTERWAVE_TIMEOUT_MS", 8000),
    paymentMethods: envValue("FLUTTERWAVE_PAYMENT_METHODS", envValue("NAIRA_PAYMENT_METHODS", "bank_transfer"))
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean),
    dynamicAccountExpirySeconds: envNumber("FLUTTERWAVE_DYNAMIC_ACCOUNT_EXPIRY_SECONDS", 3600),
  },
  nomba: {
    clientId: envValue("NOMBA_CLIENT_ID"),
    clientSecret: envValue("NOMBA_CLIENT_SECRET"),
    accountId: envValue("NOMBA_ACCOUNT_ID"),
    testClientId: envValue("NOMBA_TEST_CLIENT_ID"),
    testClientSecret: envValue("NOMBA_TEST_CLIENT_SECRET"),
    testAccountId: envValue("NOMBA_TEST_ACCOUNT_ID"),
    liveClientId: envValue("NOMBA_LIVE_CLIENT_ID"),
    liveClientSecret: envValue("NOMBA_LIVE_CLIENT_SECRET"),
    liveAccountId: envValue("NOMBA_LIVE_ACCOUNT_ID"),
    baseUrl: envValue("NOMBA_BASE_URL", "https://sandbox.nomba.com"),
    liveBaseUrl: envValue("NOMBA_LIVE_BASE_URL", "https://api.nomba.com"),
    webhookUrl: envValue("NOMBA_WEBHOOK_URL"),
    webhookSecret: envValue("NOMBA_WEBHOOK_SECRET"),
    timeoutMs: envNumber("NOMBA_TIMEOUT_MS", 8000),
    payoutEnabled: envValue("NOMBA_PAYOUT_ENABLED", "false").toLowerCase() === "true",
    senderName: envValue("NOMBA_SENDER_NAME", "Sivan"),
    subAccountId: envValue("NOMBA_SUB_ACCOUNT_ID"),
    paymentMethods: envValue("NOMBA_PAYMENT_METHODS", envValue("NAIRA_PAYMENT_METHODS", "bank_transfer"))
      .split(",")
      .map((method) => method.trim())
      .filter(Boolean),
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
    providers: envValue("RECONCILIATION_PROVIDERS", "monnify,palmpay,flutterwave")
      .split(",")
      .map((provider) => provider.trim())
      .filter(Boolean),
  },
  app: {
    env: envValue("NODE_ENV", "development"),
    logLevel: envValue("LOG_LEVEL", "info"),
    databaseProvider,
    databaseUrl,
    frontendUrl: envValue("FRONTEND_URL"),
    webhookUrl: envValue("WEBHOOK_URL"),
    notificationUrl: envValue("NOTIFICATION_URL"),
    notificationSecret: envValue("NOTIFICATION_SECRET", envValue("NOTIFY_SECRET", "sivan_notify_test_secret")),

  },
  storage: {
    r2AccessKeyId: envValue("R2_ACCESS_KEY_ID"),
    r2SecretAccessKey: envValue("R2_SECRET_ACCESS_KEY"),
    r2Endpoint: envValue("R2_ENDPOINT"),
    r2BucketName: envValue("R2_BUCKET_NAME", "sivan-delivery-proofs-test"),
  },
  twilio: {
    accountSid: envValue("TWILIO_ACCOUNT_SID"),
    authToken: envValue("TWILIO_AUTH_TOKEN"),
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
    if (!config.storage.r2AccessKeyId) {
      throw new Error("Cloudflare R2 Access Key ID (R2_ACCESS_KEY_ID) is required in production.");
    }
    if (!config.storage.r2SecretAccessKey) {
      throw new Error("Cloudflare R2 Secret Access Key (R2_SECRET_ACCESS_KEY) is required in production.");
    }
    if (!config.storage.r2Endpoint) {
      throw new Error("Cloudflare R2 Endpoint URL (R2_ENDPOINT) is required in production.");
    }
  }

  if (process.env.PAYOUT_VERIFICATION_TEST_MODE === "true") {
    if (!envValue("PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS")) {
      throw new Error("PAYOUT_VERIFICATION_TEST_MODE requires PAYOUT_VERIFICATION_TEST_ACCOUNT_NUMBERS");
    }
    console.warn("[WARN] Controlled payout verification test mode is enabled for explicitly allowlisted accounts");
  }

  // Hard required — service cannot start without these
  const required = [
    { key: "SYNAPSE_API_KEY", value: config.synapse.apiKey },
    { key: "SYNAPSE_RPC_URL or SAP_RPC_URL", value: config.synapse.rpcUrl },
    { key: "ACE_DATA_API_KEY", value: config.aceData.apiKey },
    { key: "SYNAPSE_X402_FACILITATOR_URL or X402_RPC_URL", value: config.x402.rpcUrl },
  ];

  // Validate the ACTIVE payment provider has its key configured
  const activeProvider = envValue("ACTIVE_PAYMENT_PROVIDER", "flutterwave").toLowerCase();
  if (activeProvider === "flutterwave") {
    const flwKey = config.flutterwave.secretKey;
    if (!flwKey) {
      required.push({ key: "FLUTTERWAVE_SECRET_KEY (active provider is flutterwave)", value: flwKey });
    }
  } else if (activeProvider === "palmpay") {
    const palmKey = config.palmpay.appId;
    if (!palmKey) {
      required.push({ key: "PALMPAY_APP_ID (active provider is palmpay)", value: palmKey });
    }
  } else if (activeProvider === "nomba") {
    const nombaKey = config.nomba.clientId;
    if (!nombaKey) {
      required.push({ key: "NOMBA_CLIENT_ID (active provider is nomba)", value: nombaKey });
    }
  }

  const missing = required.filter((entry) => !entry.value);
  if (missing.length > 0) {
    const message = `Missing required environment variables: ${missing.map((entry) => entry.key).join(", ")}`;
    if (config.app.env === "production") {
      throw new Error(message);
    }
    console.warn(`[WARN] ${message}`);
  }

  // Soft warnings — present in config but not currently required to start
  const softChecks: Array<{ key: string; value: string; reason: string }> = [
    { key: "SAP_AGENT_PRIVATE_KEY", value: config.sap.agentPrivateKey, reason: "x402 USDC settlement unavailable" },
    { key: "SAP_AGENT_PUBLIC_KEY", value: config.sap.agentPublicKey, reason: "x402 USDC settlement unavailable" },
  ];
  softChecks
    .filter((c) => !c.value)
    .forEach((c) => console.warn(`[WARN] ${c.key} not set — ${c.reason}`));
}

