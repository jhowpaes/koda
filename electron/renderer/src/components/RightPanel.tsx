import React, { useState } from 'react';
import { Workspace } from '../App';
import EditorTab from './EditorTab';
import BrowserTab from './BrowserTab';
import GitTab from './GitTab';
import KanbanTab from './KanbanTab';

type Tab = 'editor' | 'browser' | 'git' | 'kanban';

interface Props {
  workspace: Workspace | null;
  onFileAction: (action: 'explain' | 'review' | 'edit', filePath: string) => void;
  onOpenProject: () => void;
  onSelectFile: (filePath: string) => void;
  onCloseTab: (filePath: string) => void;
  onReloadTree: (root?: string | null) => void;
}

export default function RightPanel({ workspace, onFileAction, onOpenProject, onSelectFile, onCloseTab, onReloadTree }: Props) {
  const [tab, setTab] = useState<Tab>('editor');
  // Track which tabs have been opened at least once — keeps them mounted after first visit
  const [mounted, setMounted] = useState<Set<Tab>>(new Set(['editor']));

  function openTab(t: Tab) {
    setTab(t);
    setMounted(prev => prev.has(t) ? prev : new Set([...prev, t]));
  }

  const paneStyle = (t: Tab): React.CSSProperties =>
    tab === t
      ? { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }
      : { display: 'none' };

  return (
    <div className="right-panel">
      <div className="right-panel-tabs">
        <button className={`right-tab ${tab === 'editor' ? 'active' : ''}`} onClick={() => openTab('editor')}>Editor</button>
        <button className={`right-tab ${tab === 'browser' ? 'active' : ''}`} onClick={() => openTab('browser')}>Browser</button>
        <button className={`right-tab ${tab === 'git' ? 'active' : ''}`} onClick={() => openTab('git')}>Git</button>
        <button className={`right-tab ${tab === 'kanban' ? 'active' : ''}`} onClick={() => openTab('kanban')}>Kanban</button>
      </div>

      <div className="right-panel-body">
        {mounted.has('editor') && (
          <div style={paneStyle('editor')}>
            <EditorTab
              workspace={workspace}
              onFileAction={onFileAction}
              onOpenProject={onOpenProject}
              onSelectFile={onSelectFile}
              onCloseTab={onCloseTab}
              onReloadTree={onReloadTree}
            />
          </div>
        )}
        {mounted.has('browser') && (
          <div style={paneStyle('browser')}>
            <BrowserTab projectRoot={workspace?.projectRoot ?? null} />
          </div>
        )}
        {mounted.has('git') && (
          <div style={paneStyle('git')}>
            <GitTab projectRoot={workspace?.projectRoot ?? null} />
          </div>
        )}
        {mounted.has('kanban') && (
          <div style={paneStyle('kanban')}>
            <KanbanTab projectRoot={workspace?.projectRoot ?? null} />
          </div>
        )}
      </div>
    </div>
  );
}
