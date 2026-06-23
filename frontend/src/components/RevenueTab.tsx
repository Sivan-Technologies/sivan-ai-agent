import { useMemo } from "react";
import { RevenueAnalytics } from "../types";
import { money, formatTime } from "../utils";

interface RevenueTabProps {
  revenueAnalytics: RevenueAnalytics | null;
  revenuePeriod: "day" | "week" | "month" | "all";
  setRevenuePeriod: (period: "day" | "week" | "month" | "all") => void;
}

export function RevenueTab({
  revenueAnalytics,
  revenuePeriod,
  setRevenuePeriod,
}: RevenueTabProps) {
  const selectedRevenuePeriod = useMemo(() => {
    return revenueAnalytics?.periods.find((period) => period.key === revenuePeriod);
  }, [revenueAnalytics, revenuePeriod]);

  return (
    <section className="revenue-layout">
      <div className="surface revenue-summary">
        <div className="section-head">
          <div>
            <h2>Revenue & Processing</h2>
            <span>Verified accounting data only</span>
          </div>
          <span>{formatTime(revenueAnalytics?.generatedAt)}</span>
        </div>
        <div className="filter-bar">
          {revenueAnalytics?.periods.map((period) => (
            <button key={period.key} className={revenuePeriod === period.key ? "active" : ""} onClick={() => setRevenuePeriod(period.key)}>
              {period.label}
            </button>
          ))}
        </div>
        <div className="revenue-currency-grid">
          {selectedRevenuePeriod?.currencies.map((snapshot) => (
            <section className="revenue-currency" key={snapshot.currency}>
              <div className="section-head">
                <h2>{snapshot.currency}</h2>
                <span>{snapshot.processedCount} funded escrows</span>
              </div>
              <div className="revenue-metrics">
                <div className="metric-card good">
                  <span>Processed volume</span>
                  <strong>{money.format(snapshot.processedVolume)}</strong>
                  <small>{snapshot.currency}</small>
                </div>
                <div className="metric-card good">
                  <span>Platform fees captured</span>
                  <strong>{money.format(snapshot.platformFees)}</strong>
                  <small>{snapshot.platformFeeCount} fee entries</small>
                </div>
                <div className="metric-card watch">
                  <span>Processor fees reported</span>
                  <strong>{money.format(snapshot.processorFees)}</strong>
                  <small>{snapshot.processorFeeCoveragePercent}% coverage</small>
                </div>
                <div className="metric-card">
                  <span>Net after processor fees</span>
                  <strong>{money.format(snapshot.netRevenueAfterProcessorFees)}</strong>
                  <small>{snapshot.currency}</small>
                </div>
              </div>
            </section>
          ))}
          {!selectedRevenuePeriod && <div className="empty-cell">Revenue analytics unavailable</div>}
        </div>
      </div>

      <div className="surface">
        <div className="section-head">
          <h2>Processor Breakdown</h2>
          <span>all time</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Currency</th>
                <th>Volume</th>
                <th>Transactions</th>
                <th>Reported fees</th>
                <th>Fee coverage</th>
              </tr>
            </thead>
            <tbody>
              {revenueAnalytics?.processorBreakdown.map((row) => (
                <tr key={`${row.provider}-${row.currency}`}>
                  <td><strong>{row.provider}</strong></td>
                  <td>{row.currency}</td>
                  <td>{money.format(row.processedVolume)}</td>
                  <td>{row.transactionCount}</td>
                  <td>{money.format(row.processorFees)}</td>
                  <td>{row.processorFeeKnownCount}/{row.transactionCount}</td>
                </tr>
              ))}
              {!revenueAnalytics?.processorBreakdown.length && (
                <tr><td colSpan={6} className="empty-cell">No verified funding transactions yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="surface">
        <div className="section-head">
          <h2>Settlement Reconciliation</h2>
          <span>provider reported</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Settlements</th>
                <th>Settlement amount</th>
                <th>Provider fees</th>
                <th>Latest</th>
              </tr>
            </thead>
            <tbody>
              {revenueAnalytics?.settlementSummary?.map((row) => (
                <tr key={row.provider}>
                  <td><strong>{row.provider}</strong></td>
                  <td>{row.settlementCount}</td>
                  <td>{money.format(row.settlementAmount)}</td>
                  <td>{money.format(row.providerFees)}</td>
                  <td>{formatTime(row.latestSettlementAt)}</td>
                </tr>
              ))}
              {!revenueAnalytics?.settlementSummary?.length && (
                <tr><td colSpan={5} className="empty-cell">No provider settlement events recorded yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="surface">
        <div className="section-head">
          <h2>Accounting Basis</h2>
          <span>definitions</span>
        </div>
        <div className="detail-stack">
          <div className="detail-row"><span>Processed volume</span><strong>{revenueAnalytics?.accountingBasis.processedVolume || "-"}</strong></div>
          <div className="detail-row"><span>Platform fees</span><strong>{revenueAnalytics?.accountingBasis.platformFees || "-"}</strong></div>
          <div className="detail-row"><span>Processor fees</span><strong>{revenueAnalytics?.accountingBasis.processorFees || "-"}</strong></div>
          <div className="detail-row"><span>Test activity</span><strong>{revenueAnalytics?.accountingBasis.testActivity || "-"}</strong></div>
          <div className="detail-row"><span>Excluded test transactions</span><strong>{revenueAnalytics?.excludedTestActivity.transactionCount ?? 0}</strong></div>
          {revenueAnalytics?.excludedTestActivity.processedVolumeByCurrency.map((row) => (
            <div className="detail-row" key={row.currency}><span>Excluded {row.currency}</span><strong>{money.format(row.amount)}</strong></div>
          ))}
        </div>
      </aside>
    </section>
  );
}
