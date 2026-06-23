import { ToastNotice } from "../types";

export function Toast({ notice, onDismiss }: { notice: ToastNotice; onDismiss: () => void }) {
  return (
    <div
      className={`toast-notice ${notice.tone}`}
      role={notice.tone === "error" ? "alert" : "status"}
      aria-live={notice.tone === "error" ? "assertive" : "polite"}
    >
      <div className="toast-icon" aria-hidden="true">{notice.tone === "success" ? "✓" : "!"}</div>
      <div className="toast-copy">
        <strong>{notice.title}</strong>
        <span>{notice.message}</span>
      </div>
      <button className="toast-dismiss" type="button" onClick={onDismiss} aria-label="Dismiss notification">
        ×
      </button>
    </div>
  );
}
