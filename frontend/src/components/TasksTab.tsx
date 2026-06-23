import { TaskRecord } from "../types";
import { money, formatTime, statusTone, compactId } from "../utils";

interface TasksTabProps {
  tasks: TaskRecord[];
  selectedTask: TaskRecord | null;
  setSelectedTask: (task: TaskRecord | null) => void;
}

export function TasksTab({ tasks, selectedTask, setSelectedTask }: TasksTabProps) {
  return (
    <section className="content-grid">
      <div className="surface">
        <div className="section-head">
          <h2>Workflow Queue</h2>
          <span>{tasks.length} records</span>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Task</th>
                <th>User</th>
                <th>Amount</th>
                <th>Status</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((task) => (
                <tr
                  key={task.taskId}
                  className={selectedTask?.taskId === task.taskId ? "selected" : ""}
                  onClick={() => setSelectedTask(selectedTask?.taskId === task.taskId ? null : task)}
                >
                  <td>
                    <strong>{task.taskType}</strong>
                    <small>{compactId(task.taskId, 14)}</small>
                  </td>
                  <td>{task.userEmail}</td>
                  <td>{money.format(task.amount)} {task.userPaymentPreference}</td>
                  <td><span className={`status ${statusTone(task.paymentStatus)}`}>{task.paymentStatus}</span></td>
                  <td>{compactId(task.paymentReference, 16)}</td>
                </tr>
              ))}
              {tasks.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-cell">No workflow records</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <aside className="surface detail-surface">
        <div className="section-head">
          <h2>Task Detail</h2>
          <span>{selectedTask ? compactId(selectedTask.taskId, 12) : "none"}</span>
        </div>
        {selectedTask ? (
          <div className="detail-stack">
            <div className="detail-row"><span>Status</span><strong>{selectedTask.paymentStatus}</strong></div>
            <div className="detail-row"><span>Payment</span><strong>{selectedTask.paymentMethod}</strong></div>
            <div className="detail-row"><span>Reference</span><strong>{selectedTask.paymentReference || "unassigned"}</strong></div>
            <div className="detail-row"><span>Updated</span><strong>{formatTime(selectedTask.updatedAt)}</strong></div>
            <div className="detail-note">{selectedTask.note || selectedTask.instructions || "No note recorded."}</div>
          </div>
        ) : (
          <p className="muted">Select a workflow row.</p>
        )}
      </aside>
    </section>
  );
}
