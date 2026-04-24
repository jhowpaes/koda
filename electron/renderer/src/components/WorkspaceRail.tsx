import React, { memo } from 'react';
import { Workspace } from '../App';

interface Props {
  workspaces: Workspace[];
  activeId: string;
  activeMode: 'chat' | 'koda';
  runningWorkspaceIds: Set<string>;
  onSelect: (id: string) => void;
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
  onSelect, onAdd, onToggleKoda, onOpenSettings,
}: Props) {
  return (
    <div className="workspace-rail">
      <div className="rail-drag-area" />

      {workspaces.map((ws, i) => {
        const color = WS_COLORS[i % WS_COLORS.length];
        const isActive = ws.id === activeId;
        const isRunning = runningWorkspaceIds.has(ws.id);
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
    </div>
  );
});
