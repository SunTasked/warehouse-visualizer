import { useEditor } from "../state/EditorContext";

export function HistoryPanel() {
  const { mode, showHistory, entries, cursor, jumpTo } = useEditor();
  if (mode !== "edit" || !showHistory) return null;

  return (
    <div className="history-panel">
      <div className="history-panel__header">
        <h2>History</h2>
      </div>
      <ol className="history-panel__list">
        {entries.map((entry, index) => (
          <li key={index}>
            <button
              className={
                index === cursor ? "history-panel__item history-panel__item--current" : "history-panel__item"
              }
              onClick={() => jumpTo(index)}
            >
              {entry.label}
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
