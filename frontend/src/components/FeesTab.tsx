import { useState } from "react";
import { FeeSettings, PaymentProviderStatus, AuditRecord } from "../types";
import { money, formatTime } from "../utils";

interface FeesTabProps {
  feeSettings: FeeSettings | null;
  feeError: string | null;
  feeSuccess: string | null;
  feeFormData: {
    nairaFeePercent: number;
    nairaFeeFixed: number;
    usdcFeePercent: number;
    usdcFeeFixed: number;
    nairaNewUserLimit: number;
    nairaTrustedUserLimit: number;
    nairaEstablishedUserLimit: number;
    nairaSpecialApprovalLimit: number;
    nairaBuyerActiveExposureLimit: number;
    nairaPlatformActiveExposureLimit: number;
    trustedUserSuccessfulEscrows: number;
    establishedUserSuccessfulEscrows: number;
    platformMode: "test" | "live" | "maintenance";
    maintenanceMessage: string;
    nairaPaymentMethod: "bank_transfer";
    nairaFeeModel: "simple" | "tiered";
    nairaFeeTiers: string;
  };
  setFeeFormData: (formData: any) => void;
  savingFees: boolean;
  setShowConfirmModal: (show: boolean) => void;
  paymentProviderStatus: PaymentProviderStatus | null;
  paymentProviderForm: {
    activePaymentProvider: string;
    backupPaymentProvider: string;
    emergencyPaymentProvider: string;
    paymentProviderFallbackEnabled: boolean;
  };
  setPaymentProviderForm: (form: any) => void;
  handleSavePaymentProviders: () => Promise<void>;
  auditHistory: AuditRecord[];
}

export function FeesTab({
  feeSettings,
  feeError,
  feeSuccess,
  feeFormData,
  setFeeFormData,
  savingFees,
  setShowConfirmModal,
  paymentProviderStatus,
  paymentProviderForm,
  setPaymentProviderForm,
  handleSavePaymentProviders,
  auditHistory,
}: FeesTabProps) {
  const [previewAmount, setPreviewAmount] = useState<number>(50000);

  const calculateNairaFeeLocal = (amount: number) => {
    if (feeFormData.nairaFeeModel === "tiered") {
      try {
        const tiers = JSON.parse(feeFormData.nairaFeeTiers);
        if (Array.isArray(tiers)) {
          const tier = tiers.find((t: any) => t.max === null || amount <= t.max);
          if (tier) {
            if (tier.fee !== undefined) return tier.fee;
            if (tier.rate !== undefined) return Math.round((amount * tier.rate) / 100);
          }
        }
      } catch (err) {
        // fallback
      }
    }
    return Math.round(((amount * feeFormData.nairaFeePercent) / 100) * 100) / 100 + feeFormData.nairaFeeFixed;
  };

  const calculateUSDCFeeLocal = (amount: number) => {
    const percentFee = parseFloat((amount * (feeFormData.usdcFeePercent / 100)).toFixed(6));
    return parseFloat((percentFee + feeFormData.usdcFeeFixed).toFixed(6));
  };

  return (
    <section className="fees-layout">
      <div className="surface">
        <div className="section-head">
          <h2>Platform Controls</h2>
          <span>v{feeSettings?.version || "-"}</span>
        </div>
        {feeError && <div className="error-banner">{feeError}</div>}
        {feeSuccess && <div className="success-banner">{feeSuccess}</div>}

        <div className="fee-grid">
          <div className="fee-column">
            <h3>Naira</h3>
            <label className="field">
              <span>Fee Model</span>
              <select
                value={feeFormData.nairaFeeModel}
                onChange={(event) => setFeeFormData({ ...feeFormData, nairaFeeModel: event.target.value as "simple" | "tiered" })}
              >
                <option value="simple">Simple Mode (Percent + Fixed)</option>
                <option value="tiered">Structured Mode (Tiers)</option>
              </select>
            </label>

            {feeFormData.nairaFeeModel === "simple" ? (
              <>
                <label className="field">
                  <span>Percentage</span>
                  <input type="number" step="0.1" min="0" max="50" value={feeFormData.nairaFeePercent}
                    onChange={(event) => setFeeFormData({ ...feeFormData, nairaFeePercent: Number(event.target.value) })} />
                </label>
                <label className="field">
                  <span>Fixed fee</span>
                  <input type="number" step="1" min="0" value={feeFormData.nairaFeeFixed}
                    onChange={(event) => setFeeFormData({ ...feeFormData, nairaFeeFixed: Number(event.target.value) })} />
                </label>
              </>
            ) : (
              <div className="tiered-settings-container" style={{ marginTop: 12 }}>
                <span className="field-label" style={{ display: "block", marginBottom: 8, fontSize: 13, fontWeight: 500, color: "var(--foreground-muted)" }}>Structured Tiers (NGN)</span>
                <table className="tiered-table" style={{ width: "100%", borderCollapse: "collapse", marginBottom: 12 }}>
                  <thead>
                    <tr style={{ textAlign: "left", fontSize: 11, color: "var(--foreground-muted)", borderBottom: "1px solid var(--border)" }}>
                      <th style={{ paddingBottom: 6 }}>Max Amount</th>
                      <th style={{ paddingBottom: 6 }}>Flat Fee / % Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      try {
                        const tiers = JSON.parse(feeFormData.nairaFeeTiers);
                        if (!Array.isArray(tiers)) return null;
                        return tiers.map((tier: any, index: number) => {
                          const isFlat = tier.fee !== undefined;
                          const label = tier.max === null ? "Above 100k (or fallback)" : `Up to ${tier.max.toLocaleString()} NGN`;
                          return (
                            <tr key={index} style={{ borderBottom: "1px solid var(--border-subtle)" }}>
                              <td style={{ fontSize: 12, padding: "8px 0" }}>{label}</td>
                              <td style={{ padding: "8px 0" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                  <input
                                    type="number"
                                    step={isFlat ? "50" : "0.05"}
                                    min="0"
                                    value={isFlat ? (tier.fee ?? 0) : (tier.rate ?? 0)}
                                    style={{ width: 80, padding: "2px 6px", fontSize: 12, border: "1px solid var(--border)", borderRadius: 4, background: "var(--background-card)", color: "var(--foreground)" }}
                                    onChange={(event) => {
                                      const val = Number(event.target.value);
                                      const updated = [...tiers];
                                      if (isFlat) {
                                        updated[index] = { ...tier, fee: val };
                                      } else {
                                        updated[index] = { ...tier, rate: val };
                                      }
                                      setFeeFormData({ ...feeFormData, nairaFeeTiers: JSON.stringify(updated) });
                                    }}
                                  />
                                  <span style={{ fontSize: 12 }}>{isFlat ? "NGN" : "%"}</span>
                                </div>
                              </td>
                            </tr>
                          );
                        });
                      } catch {
                        return <tr><td colSpan={2} style={{ color: "red", fontSize: 12 }}>Invalid tiers JSON format</td></tr>;
                      }
                    })()}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="fee-column">
            <h3>USDC</h3>
            <label className="field">
              <span>Percentage</span>
              <input type="number" step="0.1" min="0" max="50" value={feeFormData.usdcFeePercent}
                onChange={(event) => setFeeFormData({ ...feeFormData, usdcFeePercent: Number(event.target.value) })} />
            </label>
            <label className="field">
              <span>Fixed fee</span>
              <input type="number" step="0.01" min="0" value={feeFormData.usdcFeeFixed}
                onChange={(event) => setFeeFormData({ ...feeFormData, usdcFeeFixed: Number(event.target.value) })} />
            </label>
          </div>
        </div>
        <div className="section-head" style={{ marginTop: 24 }}>
          <h2>Naira Risk Limits</h2>
          <span>creation controls</span>
        </div>
        <div className="fee-grid">
          <div className="fee-column">
            <h3>User tiers</h3>
            {([
              ["New user limit", "nairaNewUserLimit"],
              ["Trusted user limit", "nairaTrustedUserLimit"],
              ["Established user limit", "nairaEstablishedUserLimit"],
              ["Special approval maximum", "nairaSpecialApprovalLimit"],
            ] as const).map(([label, key]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input type="number" step="1000" min="1" value={feeFormData[key]}
                  onChange={(event) => setFeeFormData({ ...feeFormData, [key]: Number(event.target.value) })} />
              </label>
            ))}
          </div>
          <div className="fee-column">
            <h3>Exposure and promotion</h3>
            {([
              ["Buyer active exposure limit", "nairaBuyerActiveExposureLimit"],
              ["Platform active exposure limit", "nairaPlatformActiveExposureLimit"],
              ["Successful escrows for trusted", "trustedUserSuccessfulEscrows"],
              ["Successful escrows for established", "establishedUserSuccessfulEscrows"],
            ] as const).map(([label, key]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input type="number" step="1" min="1" value={feeFormData[key]}
                  onChange={(event) => setFeeFormData({ ...feeFormData, [key]: Number(event.target.value) })} />
              </label>
            ))}
          </div>
        </div>
        <div className="section-head" style={{ marginTop: 24 }}>
          <h2>Operating Mode</h2>
          <span>{feeFormData.platformMode}</span>
        </div>
        <div className="fee-grid">
          <div className="fee-column">
            <h3>Runtime</h3>
            <label className="field">
              <span>Platform mode</span>
              <select
                value={feeFormData.platformMode}
                onChange={(event) => setFeeFormData({ ...feeFormData, platformMode: event.target.value as "test" | "live" | "maintenance" })}
              >
                <option value="test">Test mode</option>
                <option value="live">Live mode</option>
                <option value="maintenance">Maintenance mode</option>
              </select>
            </label>
            <label className="field">
              <span>Naira payment method</span>
              <input value="bank_transfer" disabled readOnly />
            </label>
            <div className="detail-note">All Naira providers must stay bank-transfer only. Cards are not supported for Sivan escrow collection.</div>
          </div>
          <div className="fee-column">
            <h3>Maintenance message</h3>
            <label className="field">
              <span>User-facing message</span>
              <textarea
                rows={5}
                value={feeFormData.maintenanceMessage}
                onChange={(event) => setFeeFormData({ ...feeFormData, maintenanceMessage: event.target.value })}
              />
            </label>
            <div className="detail-note">When maintenance mode is active, customer API requests receive this message while admin, health, and payment webhooks stay available.</div>
          </div>
        </div>
        <button className="button primary full" onClick={() => setShowConfirmModal(true)} disabled={savingFees}>
          Review changes
        </button>
      </div>

      <div className="surface">
        <div className="section-head">
          <h2>Payment Providers</h2>
          <span>v{paymentProviderStatus?.version || "-"}</span>
        </div>
        <div className="detail-stack">
          <div className="detail-row"><span>Active provider</span><strong>{paymentProviderStatus?.activePaymentProvider || "unknown"}</strong></div>
          <div className="detail-row"><span>Backup provider</span><strong>{paymentProviderStatus?.backupPaymentProvider || "unknown"}</strong></div>
          <div className="detail-row"><span>Emergency provider</span><strong>{paymentProviderStatus?.emergencyPaymentProvider || "unknown"}</strong></div>
          <div className="detail-row"><span>Fallback</span><strong>{paymentProviderStatus?.paymentProviderFallbackEnabled ? "Enabled" : "Disabled"}</strong></div>
          <div className="detail-row"><span>Platform mode</span><strong>{paymentProviderStatus?.platformMode || feeSettings?.platformMode || "unknown"}</strong></div>
          <div className="detail-row"><span>Naira method</span><strong>{paymentProviderStatus?.nairaPaymentMethod || "bank_transfer"}</strong></div>
        </div>
        <div className="fee-grid" style={{ marginTop: 16 }}>
          <div className="fee-column">
            <h3>Provider routing</h3>
            {([
              ["Active", "activePaymentProvider"],
              ["Backup", "backupPaymentProvider"],
              ["Emergency", "emergencyPaymentProvider"],
            ] as const).map(([label, key]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <select
                  value={paymentProviderForm[key]}
                  onChange={(event) => setPaymentProviderForm({ ...paymentProviderForm, [key]: event.target.value })}
                >
                  {(paymentProviderStatus?.providers || []).map((provider) => (
                    <option
                      key={`${key}-${provider.provider}`}
                      value={provider.provider}
                      disabled={key === "activePaymentProvider" && (!provider.configured || !provider.implemented)}
                    >
                      {provider.label} {provider.configured ? "configured" : "not configured"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="field checkbox-field">
              <input
                type="checkbox"
                checked={paymentProviderForm.paymentProviderFallbackEnabled}
                onChange={(event) => setPaymentProviderForm({ ...paymentProviderForm, paymentProviderFallbackEnabled: event.target.checked })}
              />
              <span>Enable fallback for new payment creation only</span>
            </label>
            <button className="button secondary full" onClick={handleSavePaymentProviders} disabled={savingFees || !paymentProviderStatus}>
              Save payment providers
            </button>
          </div>
          <div className="fee-column">
            <h3>Provider status</h3>
            <div className="detail-stack">
              {(paymentProviderStatus?.providers || []).map((provider) => (
                <div className="detail-row" key={provider.provider}>
                  <span>{provider.label}</span>
                  <strong>{provider.implemented ? (provider.configured ? "Configured" : "Needs env") : "Not implemented"}</strong>
                </div>
              ))}
            </div>
            <div className="detail-note">Existing escrows stay on the provider that created their payment reference. Fallback is disabled until both active and backup providers pass live bank-transfer tests.</div>
          </div>
        </div>
      </div>

      <div className="surface">
        <div className="section-head">
          <h2>Fee Calculator</h2>
          <span>preview</span>
        </div>
        <div className="preview-list">
          <label className="field" style={{ marginBottom: 12, display: "flex", flexDirection: "column", gap: 4 }}>
            <span>Test amount to preview</span>
            <input
              type="number"
              value={previewAmount}
              onChange={(e) => setPreviewAmount(Number(e.target.value))}
              placeholder="Enter amount..."
            />
          </label>
          <div className="preview-row">
            <span>Calculated Naira Fee</span>
            <strong>{money.format(calculateNairaFeeLocal(previewAmount))} NGN</strong>
          </div>
          <div className="preview-row">
            <span>Calculated USDC Fee</span>
            <strong>{money.format(calculateUSDCFeeLocal(previewAmount))} USDC</strong>
          </div>
          <div className="preview-row">
            <span>Last update</span>
            <strong>{formatTime(feeSettings?.updatedAt)}</strong>
          </div>
          <div className="preview-row"><span>New user cap</span><strong>NGN {money.format(feeFormData.nairaNewUserLimit)}</strong></div>
          <div className="preview-row"><span>Special approval max</span><strong>NGN {money.format(feeFormData.nairaSpecialApprovalLimit)}</strong></div>
          <div className="preview-row"><span>Platform exposure cap</span><strong>NGN {money.format(feeFormData.nairaPlatformActiveExposureLimit)}</strong></div>
        </div>
      </div>

      <div className="surface audit-surface">
        <div className="section-head">
          <h2>Audit Trail</h2>
          <span>{auditHistory.length} entries</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Setting</th>
                <th>Changed by</th>
              </tr>
            </thead>
            <tbody>
              {auditHistory.map((record) => (
                <tr key={record.id}>
                  <td>{formatTime(record.changedAt)}</td>
                  <td>{record.settingName}</td>
                  <td>{record.changedBy}</td>
                </tr>
              ))}
              {auditHistory.length === 0 && (
                <tr><td colSpan={3} className="empty-cell">No audit records</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
