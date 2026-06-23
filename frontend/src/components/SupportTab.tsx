import { SupportCase, SupportNote } from "../types";
import { compactId, formatTime } from "../utils";

interface SupportTabProps {
  filteredSupportCases: SupportCase[];
  supportCases: SupportCase[];
  supportSearch: string;
  setSupportSearch: (search: string) => void;
  selectedSupportCase: SupportCase | null;
  selectSupportCase: (supportCase: SupportCase) => Promise<void>;
  supportNotes: SupportNote[];
  supportNoteDraft: string;
  setSupportNoteDraft: (draft: string) => void;
  updateSupportCase: (caseId: string, updates: Record<string, string>) => Promise<void>;
  addSupportNote: () => Promise<void>;
  loadEscrowTimeline: (escrowId: string) => Promise<void>;
  setError: (error: string | null) => void;
}

export function SupportTab({
  filteredSupportCases,
  supportCases,
  supportSearch,
  setSupportSearch,
  selectedSupportCase,
  selectSupportCase,
  supportNotes,
  supportNoteDraft,
  setSupportNoteDraft,
  updateSupportCase,
  addSupportNote,
  loadEscrowTimeline,
  setError,
}: SupportTabProps) {
  return (
    <section className="content-grid">
      <div className="surface">
        <div className="section-head">
          <h2>Support Inbox</h2>
          <span>{filteredSupportCases.length} of {supportCases.length} cases</span>
        </div>
        <label className="field compact-field">
          <span>Search cases</span>
          <input
            type="search"
            value={supportSearch}
            onChange={(event) => setSupportSearch(event.target.value)}
            placeholder="Escrow ID, user, assignee, status"
            autoComplete="off"
          />
        </label>
        <div className="event-grid">
          {filteredSupportCases.map((supportCase) => (
            <button
              key={supportCase.caseId}
              className={`event-row selectable-row ops-event ${supportCase.priority === "urgent" || supportCase.priority === "high" ? "error" : "warning"} ${selectedSupportCase?.caseId === supportCase.caseId ? "selected" : ""}`}
              onClick={async () => {
                try {
                  await selectSupportCase(supportCase);
                } catch (err: any) {
                  setError(err.message || "Support case load failed");
                }
              }}
            >
              <div>
                <strong>{supportCase.subject}</strong>
                <span>{supportCase.status} · {supportCase.priority} · assigned {supportCase.assignedTo || "unassigned"}</span>
                <span>{supportCase.relatedEscrowId || supportCase.relatedUser || supportCase.source}</span>
              </div>
              <time>{formatTime(supportCase.updatedAt)}</time>
            </button>
          ))}
          {filteredSupportCases.length === 0 && <p className="muted">No support cases match this search</p>}
        </div>
      </div>

      <aside className="surface detail-surface">
        <div className="section-head">
          <h2>Case Workflow</h2>
          <span>{selectedSupportCase ? compactId(selectedSupportCase.caseId, 14) : "none"}</span>
        </div>
        {selectedSupportCase ? (
          <div className="detail-stack">
            <div className="detail-row"><span>Status</span><strong>{selectedSupportCase.status}</strong></div>
            <div className="detail-row"><span>Priority</span><strong>{selectedSupportCase.priority}</strong></div>
            <div className="detail-row"><span>Assigned</span><strong>{selectedSupportCase.assignedTo || "unassigned"}</strong></div>
            <div className="detail-row"><span>Linked escrow</span><strong>{selectedSupportCase.relatedEscrowId || "none"}</strong></div>
            <div className="control-grid">
              <label className="field">
                <span>Status</span>
                <select
                  value={selectedSupportCase.status}
                  onChange={async (event) => {
                    try {
                      await updateSupportCase(selectedSupportCase.caseId, { status: event.target.value });
                    } catch (err: any) {
                      setError(err.message || "Status update failed");
                    }
                  }}
                >
                  <option value="open">Open</option>
                  <option value="pending">Pending</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </label>
              <label className="field">
                <span>Priority</span>
                <select
                  value={selectedSupportCase.priority}
                  onChange={async (event) => {
                    try {
                      await updateSupportCase(selectedSupportCase.caseId, { priority: event.target.value });
                    } catch (err: any) {
                      setError(err.message || "Priority update failed");
                    }
                  }}
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </label>
            </div>
            <label className="field">
              <span>Assign operator</span>
              <input
                type="text"
                defaultValue={selectedSupportCase.assignedTo || ""}
                placeholder="operator name"
                autoComplete="name"
                onBlur={async (event) => {
                  const assignedTo = event.target.value.trim();
                  if (assignedTo !== (selectedSupportCase.assignedTo || "")) {
                    try {
                      await updateSupportCase(selectedSupportCase.caseId, { assignedTo });
                    } catch (err: any) {
                      setError(err.message || "Assignment failed");
                    }
                  }
                }}
              />
            </label>
            {selectedSupportCase.relatedEscrowId && (
              <button className="button secondary full" onClick={() => loadEscrowTimeline(selectedSupportCase.relatedEscrowId!)}>
                Open linked escrow timeline
              </button>
            )}
            <label className="field">
              <span>Internal note</span>
              <textarea value={supportNoteDraft} onChange={(event) => setSupportNoteDraft(event.target.value)} rows={4} />
            </label>
            <button
              className="button primary full"
              disabled={!supportNoteDraft.trim()}
              onClick={async () => {
                try {
                  await addSupportNote();
                } catch (err: any) {
                  setError(err.message || "Note failed");
                }
              }}
            >
              Add internal note
            </button>
            <div className="section-head ops-subhead">
              <h2>Notes</h2>
              <span>{supportNotes.length}</span>
            </div>
            <div className="event-grid">
              {supportNotes.map((note) => (
                <div key={note.noteId} className="event-row">
                  <div>
                    <strong>{note.actionType || "note"} · {note.author}</strong>
                    <span>{note.body}</span>
                  </div>
                  <time>{formatTime(note.createdAt)}</time>
                </div>
              ))}
              {supportNotes.length === 0 && <p className="muted">No notes recorded</p>}
            </div>
          </div>
        ) : (
          <p className="muted">Select a support case.</p>
        )}
      </aside>
    </section>
  );
}
