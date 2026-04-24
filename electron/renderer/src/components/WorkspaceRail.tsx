import React, { memo } from 'react';
import { Workspace } from '../App';

interface Props {
  workspaces: Workspace[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onOpenSettings: () => void;
}

const WS_COLORS = [
  '#238be6', // blue
  '#3fb950', // green
  '#a371f7', // purple
  '#f0883e', // orange
  '#f85149', // red
  '#39d5ff', // cyan
  '#f778ba', // pink
  '#e3b341', // yellow
];

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

export default memo(function WorkspaceRail({ workspaces, activeId, onSelect, onAdd, onOpenSettings }: Props) {
  return (
    <div className="workspace-rail">
      <div className="rail-drag-area" />

      {workspaces.map((ws, i) => {
        const color = WS_COLORS[i % WS_COLORS.length];
        const isActive = ws.id === activeId;
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
          </button>
        );
      })}

      <button className="workspace-add-btn" onClick={onAdd} title="New workspace">+</button>

      <div className="rail-spacer" />

      <button className="rail-settings-btn" onClick={onOpenSettings} title="Settings">
        ⚙
      </button>
    </div>
  );
});
