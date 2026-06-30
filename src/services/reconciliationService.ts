import { config } from "../config";
import { escrowStore, flutterwaveClient, opsStore, palmpayClient, reconciliationStore } from "../context";
import { captureOperationalError, capturePaymentWarning } from "./monitoring";
import { createNairaPaymentProvider } from "./nairaPaymentProvider";
import type { EscrowTransactionRecord } from "./escrowStore";
import type { ReconciliationFindingRecord, ReconciliationFindingSeverity, ReconciliationFindingType } from "./reconciliationStore";

export interface ProviderTransactionForReconciliation {
  provider: string;
  paymentReference: string;
  transactionReference?: string;
  status: string;
  amount: number;
  currency: string;
  processorFee?: number;
  paidAt?: string;
  raw?: unknown;
  source: "provider_pull" | "local_reverify";
}

export interface ReconciliationRunInput {
  windowStart?: string;
  windowEnd?: string;
  providers?: string[];
  reason?: string;
  alertOnFindings?: boolean;
}

function nowIso() {
  return new Date().toISOString();
}

function defaultWindow() {
  const end = new Date();
  const start = new Date(end.getTime() - config.reconciliation.lookbackHours * 60 * 60 * 1000);
  return { windowStart: start.toISOString(), windowEnd: end.toISOString() };
}

function normalizeStatus(status: string) {
  const value = String(status || "").toLowerCase();
  if (["success", "successful", "paid", "sandbox_success"].includes(value)) return "success";
  if (["failed", "fail", "cancelled", "canceled", "closed", "abandoned"].includes(value)) return "failed";
  if (["pending", "paying", "processing", "in_progress"].includes(value)) return "pending";
  if (["review_required", "invalid_currency", "invalid_payment_method"].includes(value)) return "review";
  return value || "unknown";
}

function amountsMatch(left: number, right: number) {
  return Math.round(Number(left || 0) * 100) === Math.round(Number(right || 0) * 100);
}

function isSuccess(status: string) {
  return normalizeStatus(status) === "success";
}

function severityFor(type: ReconciliationFindingType, providerStatus?: string, localStatus?: string): ReconciliationFindingSeverity {
  if (type === "amount_drift" || type === "currency_drift") return isSuccess(providerStatus || localStatus || "") ? "critical" : "high";
  if (type === "missing_in_sivan") return isSuccess(providerStatus || "") ? "critical" : "medium";
  if (type === "missing_at_provider") return isSuccess(localStatus || "") ? "high" : "medium";
  if (type === "status_drift") return isSuccess(providerStatus || "") !== isSuccess(localStatus || "") ? "critical" : "high";
  if (type === "provider_pull_failed") return "high";
  if (type === "provider_verification_failed") return isSuccess(localStatus || "") ? "high" : "medium";
  return "medium";
}

function isAlertable(severity: ReconciliationFindingSeverity) {
  return ["high", "critical"].includes(severity);
}

function uniqueProviders(providers: string[]) {
  return Array.from(new Set(providers.map((provider) => provider.trim().toLowerCase()).filter(Boolean)));
}

function rawJson(value: unknown) {
  try {
    return JSON.stringify(value || {});
  } catch {
    return "{}";
  }
}

async function pullProviderTransactions(
  provider: string,
  windowStart: string,
  windowEnd: string,
  localTransactions: EscrowTransactionRecord[] = []
): Promise<ProviderTransactionForReconciliation[] | null> {
  if (provider === "flutterwave") {
    const transactions = await flutterwaveClient.listTransactions({ from: windowStart, to: windowEnd });
    return transactions.map((transaction) => ({
      provider,
      paymentReference: transaction.paymentReference,
      transactionReference: transaction.transactionReference,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      processorFee: transaction.processorFee,
      paidAt: transaction.paidAt,
      raw: transaction.raw || transaction,
      source: "provider_pull",
    }));
  }

  if (provider === "palmpay") {
    const references = localTransactions.map((transaction) => transaction.reference).filter((reference): reference is string => Boolean(reference));
    const transactions = await palmpayClient.listTransactions({ references });
    return transactions.map((transaction) => ({
      provider,
      paymentReference: transaction.paymentReference,
      transactionReference: transaction.transactionReference,
      status: transaction.status,
      amount: transaction.amount,
      currency: transaction.currency,
      processorFee: transaction.processorFee,
      paidAt: transaction.paidAt,
      raw: transaction.raw || transaction,
      source: "provider_pull",
    }));
  }

  return null;
}

async function reverifyLocalTransactions(provider: string, localTransactions: EscrowTransactionRecord[]): Promise<ProviderTransactionForReconciliation[]> {
  const paymentProvider = createNairaPaymentProvider(provider as any);
  const snapshots: ProviderTransactionForReconciliation[] = [];
  for (const transaction of localTransactions) {
    if (!transaction.reference) continue;
    const verified = await paymentProvider.verifyPayment(transaction.reference);
    snapshots.push({
      provider,
      paymentReference: verified.paymentReference,
      transactionReference: verified.transactionReference,
      status: verified.status,
      amount: verified.amount,
      currency: verified.currency,
      processorFee: verified.processorFee,
      paidAt: verified.paidAt,
      raw: verified.raw || verified,
      source: "local_reverify",
    });
  }
  return snapshots;
}

async function addFinding(input: {
  runId: string;
  provider: string;
  findingType: ReconciliationFindingType;
  paymentReference?: string;
  escrowId?: string;
  message: string;
  expected?: any;
  actual?: any;
  providerStatus?: string;
  localStatus?: string;
}) {
  const severity = severityFor(input.findingType, input.providerStatus, input.localStatus);
  await reconciliationStore.addFinding({
    runId: input.runId,
    provider: input.provider,
    severity,
    findingType: input.findingType,
    paymentReference: input.paymentReference,
    escrowId: input.escrowId,
    message: input.message,
    expected: input.expected,
    actual: input.actual,
  });
  return severity;
}

async function createDriftAlert(runId: string, findings: ReconciliationFindingRecord[], summary: any) {
  const alertable = findings.filter((finding) => isAlertable(finding.severity));
  if (!alertable.length) return;
  const criticalCount = alertable.filter((finding) => finding.severity === "critical").length;
  const subject = `Daily reconciliation drift detected (${alertable.length} high/critical)`;
  const note = [
    `Run: ${runId}`,
    `Window: ${summary.windowStart} → ${summary.windowEnd}`,
    `Providers: ${(summary.providers || []).join(", ")}`,
    `Critical findings: ${criticalCount}`,
    `High findings: ${alertable.length - criticalCount}`,
    `Open admin: /admin/reconciliation/runs/${runId}`,
  ].join("\n");

  await opsStore.createSupportCase({
    subject,
    priority: criticalCount > 0 ? "urgent" : "high",
    source: "daily_reconciliation",
    createdBy: "system",
    note,
  });
  capturePaymentWarning(subject, { runId, summary });
}

export async function runDailyReconciliation(input: ReconciliationRunInput = {}) {
  const window = {
    ...defaultWindow(),
    ...(input.windowStart ? { windowStart: input.windowStart } : {}),
    ...(input.windowEnd ? { windowEnd: input.windowEnd } : {}),
  };
  const providers = uniqueProviders(input.providers?.length ? input.providers : config.reconciliation.providers);
  const run = await reconciliationStore.startRun({
    windowStart: window.windowStart,
    windowEnd: window.windowEnd,
    providers,
  });

  const providerSummaries: Record<string, any> = {};
  let snapshotCount = 0;
  let findingCount = 0;

  try {
    for (const provider of providers) {
      providerSummaries[provider] = {
        provider,
        providerPullSupported: ["flutterwave", "palmpay"].includes(provider),
        providerPullMode: provider === "palmpay" ? "known_reference_query" : provider === "flutterwave" ? "bulk_date_range" : "unsupported",
        missingInSivanDetectionSupported: ["flutterwave"].includes(provider),
        providerPullCount: 0,
        localReverifyCount: 0,
        findingCount: 0,
      };

      const localTransactions = await escrowStore.listFundingTransactionsForReconciliation({
        windowStart: window.windowStart,
        windowEnd: window.windowEnd,
        providers: [provider],
      });
      const localByReference = new Map(localTransactions.filter((transaction) => transaction.reference).map((transaction) => [transaction.reference!, transaction]));
      let providerSnapshots: ProviderTransactionForReconciliation[] = [];
      let providerPullSucceeded = false;

      try {
        const pulled = await pullProviderTransactions(provider, window.windowStart, window.windowEnd, localTransactions);
        if (pulled === null) {
          await addFinding({
            runId: run.runId,
            provider,
            findingType: "provider_pull_unsupported",
            message: `${provider} does not have a configured bulk transaction pull endpoint; Sivan re-verified local references only. Missing-in-Sivan detection is incomplete for this provider.`,
            expected: { providerBulkPull: true },
            actual: { providerBulkPull: false },
          });
          findingCount += 1;
          providerSummaries[provider].findingCount += 1;
        } else {
          providerSnapshots = pulled;
          providerPullSucceeded = true;
          providerSummaries[provider].providerPullCount = pulled.length;
        }
      } catch (err: any) {
        await addFinding({
          runId: run.runId,
          provider,
          findingType: "provider_pull_failed",
          message: `${provider} transaction pull failed: ${err.message || err}`,
          expected: { providerBulkPull: "successful" },
          actual: { error: err.message || String(err) },
        });
        findingCount += 1;
        providerSummaries[provider].findingCount += 1;
        captureOperationalError("Provider transaction pull failed during reconciliation", err, { provider, runId: run.runId });
      }

      try {
        if (provider === "palmpay" && providerPullSucceeded) {
          providerSummaries[provider].localReverifyCount = providerSnapshots.length;
        } else {
          const reverifications = await reverifyLocalTransactions(provider, localTransactions);
          providerSummaries[provider].localReverifyCount = reverifications.length;
          const seen = new Set(providerSnapshots.map((snapshot) => snapshot.paymentReference));
          providerSnapshots.push(...reverifications.filter((snapshot) => !seen.has(snapshot.paymentReference)));
        }
      } catch (err: any) {
        await addFinding({
          runId: run.runId,
          provider,
          findingType: "provider_verification_failed",
          message: `${provider} local reference re-verification failed: ${err.message || err}`,
          expected: { localReferenceReverify: "successful" },
          actual: { error: err.message || String(err) },
        });
        findingCount += 1;
        providerSummaries[provider].findingCount += 1;
      }

      const providerByReference = new Map<string, ProviderTransactionForReconciliation>();
      for (const snapshot of providerSnapshots) {
        if (!snapshot.paymentReference) continue;
        providerByReference.set(snapshot.paymentReference, snapshot);
        await reconciliationStore.addSnapshot({
          runId: run.runId,
          provider,
          paymentReference: snapshot.paymentReference,
          transactionReference: snapshot.transactionReference,
          status: normalizeStatus(snapshot.status),
          amount: snapshot.amount,
          currency: String(snapshot.currency || "").toUpperCase(),
          paidAt: snapshot.paidAt,
          rawPayload: rawJson(snapshot.raw || snapshot),
        });
        snapshotCount += 1;
      }

      if (providerPullSucceeded) {
        for (const snapshot of providerSnapshots.filter((item) => item.source === "provider_pull")) {
          const local = localByReference.get(snapshot.paymentReference) || await escrowStore.getTransactionByProviderReference(provider, snapshot.paymentReference);
          if (!local) {
            const severity = await addFinding({
              runId: run.runId,
              provider,
              findingType: "missing_in_sivan",
              paymentReference: snapshot.paymentReference,
              message: `${provider} has a transaction that Sivan does not have in its local funding ledger`,
              expected: { localFundingTransaction: "present" },
              actual: snapshot,
              providerStatus: snapshot.status,
            });
            findingCount += 1;
            providerSummaries[provider].findingCount += 1;
            if (severity === "critical") capturePaymentWarning("Provider transaction missing in Sivan ledger", { provider, paymentReference: snapshot.paymentReference, runId: run.runId });
            continue;
          }
        }
      }

      for (const local of localTransactions) {
        if (!local.reference) continue;
        const providerSnapshot = providerByReference.get(local.reference);
        if (!providerSnapshot) {
          await addFinding({
            runId: run.runId,
            provider,
            findingType: "missing_at_provider",
            paymentReference: local.reference,
            escrowId: local.escrowId,
            message: `Sivan has a local funding transaction that ${provider} did not return or verify`,
            expected: { providerTransaction: "present" },
            actual: local,
            localStatus: local.status,
          });
          findingCount += 1;
          providerSummaries[provider].findingCount += 1;
          continue;
        }

        const providerStatus = normalizeStatus(providerSnapshot.status);
        const localStatus = normalizeStatus(local.status);
        const expected = { provider: providerSnapshot };
        const actual = { local };
        if (providerStatus !== localStatus && !(providerStatus === "success" && localStatus === "review")) {
          await addFinding({
            runId: run.runId,
            provider,
            findingType: "status_drift",
            paymentReference: local.reference,
            escrowId: local.escrowId,
            message: `Status drift for ${provider} reference ${local.reference}: provider=${providerStatus}, Sivan=${localStatus}`,
            expected,
            actual,
            providerStatus,
            localStatus,
          });
          findingCount += 1;
          providerSummaries[provider].findingCount += 1;
        }
        if (!amountsMatch(providerSnapshot.amount, local.amount)) {
          await addFinding({
            runId: run.runId,
            provider,
            findingType: "amount_drift",
            paymentReference: local.reference,
            escrowId: local.escrowId,
            message: `Amount drift for ${provider} reference ${local.reference}: provider=${providerSnapshot.amount}, Sivan=${local.amount}`,
            expected,
            actual,
            providerStatus,
            localStatus,
          });
          findingCount += 1;
          providerSummaries[provider].findingCount += 1;
        }
        const providerCurrency = String(providerSnapshot.currency || "").toUpperCase();
        const localCurrency = local.currency === "NAIRA" ? "NGN" : local.currency;
        if (providerCurrency && providerCurrency !== localCurrency) {
          await addFinding({
            runId: run.runId,
            provider,
            findingType: "currency_drift",
            paymentReference: local.reference,
            escrowId: local.escrowId,
            message: `Currency drift for ${provider} reference ${local.reference}: provider=${providerCurrency}, Sivan=${localCurrency}`,
            expected,
            actual,
            providerStatus,
            localStatus,
          });
          findingCount += 1;
          providerSummaries[provider].findingCount += 1;
        }
      }
    }

    const findings = await reconciliationStore.listFindings(run.runId);
    const summary = {
      runId: run.runId,
      reason: input.reason || "scheduled",
      generatedAt: nowIso(),
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      providers,
      snapshotCount,
      findingCount: findings.length || findingCount,
      highOrCriticalFindings: findings.filter((finding) => isAlertable(finding.severity)).length,
      providerSummaries,
    };
    const completed = await reconciliationStore.completeRun(run.runId, summary);
    if (input.alertOnFindings !== false) {
      await createDriftAlert(run.runId, findings, summary);
    }
    return { run: completed, findings, snapshots: await reconciliationStore.listSnapshots(run.runId) };
  } catch (err: any) {
    const summary = {
      runId: run.runId,
      reason: input.reason || "scheduled",
      generatedAt: nowIso(),
      windowStart: window.windowStart,
      windowEnd: window.windowEnd,
      providers,
      snapshotCount,
      findingCount,
      providerSummaries,
    };
    const failed = await reconciliationStore.failRun(run.runId, err.message || String(err), summary);
    captureOperationalError("Daily reconciliation run failed", err, { runId: run.runId });
    return { run: failed, findings: await reconciliationStore.listFindings(run.runId), snapshots: await reconciliationStore.listSnapshots(run.runId) };
  }
}
