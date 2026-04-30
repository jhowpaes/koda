import React, { memo, useState } from 'react';
import { Workspace } from '../App';

interface Props {
  workspaces: Workspace[];
  activeId: string;
  activeMode: 'chat' | 'koda';
  runningWorkspaceIds: Set<string>;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  onToggleKoda: () => void;
  onOpenSettings: () => void;
}

const WS_COLORS = [
  '#238be6',
  '#3fb950',
  '#a371f7',
  '#f0883e',
  '#f85149',
  '#39d5ff',
  '#f778ba',
  '#e3b341',
];

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

export default memo(function WorkspaceRail({
  workspaces, activeId, activeMode, runningWorkspaceIds,
  onSelect, onClose, onAdd, onToggleKoda, onOpenSettings,
}: Props) {
  const [confirmCloseId, setConfirmCloseId] = useState<string | null>(null);
  const wsToClose = confirmCloseId ? workspaces.find(w => w.id === confirmCloseId) : null;

  return (
    <div className="workspace-rail">
      <div className="rail-drag-area" />

      {workspaces.map((ws, i) => {
        const color = WS_COLORS[i % WS_COLORS.length];
        const isActive = ws.id === activeId;
        const isRunning = runningWorkspaceIds.has(ws.id);
        const canClose = workspaces.length > 1 && !isRunning;
        return (
          <button
            key={ws.id}
            className={`workspace-btn ${isActive ? 'active' : ''}`}
            style={isActive
              ? { background: color, borderColor: color }
              : { color, borderColor: `${color}44` }
            }
            onClick={() => onSelect(ws.id)}
            title={ws.name}
          >
            <span className="workspace-initials">{getInitials(ws.name)}</span>
            <span className="workspace-badge">{ws.chats.length}</span>
            {isRunning && <span className="workspace-running-dot" />}
            {canClose && (
              <span
                className="workspace-close-btn"
                role="button"
                title={`Close ${ws.name}`}
                onClick={e => { e.stopPropagation(); setConfirmCloseId(ws.id); }}
              >
                ×
              </span>
            )}
          </button>
        );
      })}

      <button className="workspace-add-btn" onClick={onAdd} title="New workspace">+</button>

      <div className="rail-spacer" />

      <button
        className={`rail-koda-btn ${activeMode === 'koda' ? 'active' : ''}`}
        onClick={onToggleKoda}
        title={activeMode === 'koda' ? 'Switch to Chat' : 'Switch to KODA CEO'}
      >
        ⚡
      </button>

      <button className="rail-settings-btn" onClick={onOpenSettings} title="Settings">
        ⚙
      </button>

      {confirmCloseId && wsToClose && (
        <div className="ws-close-overlay" onClick={() => setConfirmCloseId(null)}>
          <div className="ws-close-modal" onClick={e => e.stopPropagation()}>
            <p className="ws-close-title">Close workspace?</p>
            <p className="ws-close-desc">
              <strong>{wsToClose.name}</strong> will be removed from the sidebar. Project files will not be affected.
            </p>
            <div className="ws-close-actions">
              <button className="ws-close-cancel" onClick={() => setConfirmCloseId(null)}>Cancel</button>
              <button
                className="ws-close-confirm"
                onClick={() => { onClose(confirmCloseId); setConfirmCloseId(null); }}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});
