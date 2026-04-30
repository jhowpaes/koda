import React, { useState, useEffect } from 'react';
import { Search, BookOpen, Pencil } from 'lucide-react';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

interface Props {
  projectRoot: string | null;
  files: FileNode[];
  onOpenProject: () => void;
  onFileAction: (action: 'explain' | 'review' | 'edit', filePath: string) => void;
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  expanded: boolean;
  selectedPath: string | null;
  expandedPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  onFileAction: (action: 'explain' | 'review' | 'edit', filePath: string) => void;
}

function TreeNode({ node, depth, expanded, selectedPath, expandedPaths, onToggle, onSelect, onFileAction }: TreeNodeProps) {
  const isSelected = selectedPath === node.path;

  const icon = node.type === 'dir'
    ? (expanded ? '▾' : '▸')
    : getFileIcon(node.name);

  return (
    <div>
      <div
        className={`tree-node ${isSelected ? 'selected' : ''}`}
        style={{ '--depth': depth } as React.CSSProperties}
        onClick={() => {
          if (node.type === 'dir') onToggle(node.path);
          else onSelect(node.path);
        }}
      >
        <span className="tree-icon">{icon}</span>
        <span className={`tree-name ${node.type}`}>{node.name}</span>
      </div>

      {isSelected && node.type === 'file' && (
        <div className="file-actions" style={{ marginLeft: `${(depth + 1) * 12 + 8}px` }}>
          <button className="file-action-btn" onClick={() => onFileAction('explain', node.path)}>
            <BookOpen size={11} strokeWidth={2} /> Explain
          </button>
          <button className="file-action-btn" onClick={() => onFileAction('review', node.path)}>
            <Search size={11} strokeWidth={2} /> Review
          </button>
          <button className="file-action-btn" onClick={() => onFileAction('edit', node.path)}>
            <Pencil size={11} strokeWidth={2} /> Edit
          </button>
        </div>
      )}

      {node.type === 'dir' && expanded && node.children?.map(child => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          expanded={expandedPaths.has(child.path)}
          selectedPath={selectedPath}
          expandedPaths={expandedPaths}
          onToggle={onToggle}
          onSelect={onSelect}
          onFileAction={onFileAction}
        />
      ))}
    </div>
  );
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const icons: Record<string, string> = {
    ts: '🔷', tsx: '⚛', js: '🟨', jsx: '⚛', py: '🐍',
    json: '{}', md: '📝', css: '🎨', html: '🌐',
    go: '🐹', rs: '🦀', java: '☕', rb: '💎',
  };
  return icons[ext] ?? '📄';
}

function storageKey(root: string) {
  return `tree-expanded:${root}`;
}

function loadExpanded(root: string | null, files: FileNode[]): Set<string> {
  if (!root) return new Set();
  try {
    const raw = localStorage.getItem(storageKey(root));
    if (raw !== null) return new Set(JSON.parse(raw) as string[]);
  } catch {}
  // First visit — expand root-level dirs by default
  return new Set(files.filter(f => f.type === 'dir').map(f => f.path));
}

export default function Sidebar({ projectRoot, files, onOpenProject, onFileAction }: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() =>
    loadExpanded(projectRoot, files)
  );

  // Reload expansion state when projectRoot changes (workspace switch)
  useEffect(() => {
    setExpandedPaths(loadExpanded(projectRoot, files));
    setSelectedPath(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectRoot]);

  // When tree is refreshed (files change) for the same project, keep existing expanded paths
  // but seed any new root-level dirs as expanded if not yet persisted
  useEffect(() => {
    if (!projectRoot) return;
    const key = storageKey(projectRoot);
    if (localStorage.getItem(key) !== null) return; // already persisted, don't override
    setExpandedPaths(new Set(files.filter(f => f.type === 'dir').map(f => f.path)));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);

  function toggleExpanded(path: string) {
    setExpandedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      if (projectRoot) {
        localStorage.setItem(storageKey(projectRoot), JSON.stringify(Array.from(next)));
      }
      return next;
    });
  }

  const projectName = projectRoot
    ? projectRoot.split('/').pop() ?? projectRoot
    : 'No project';

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="project-name">{projectName}</div>
        <button className="open-btn" onClick={onOpenProject}>
          Open folder…
        </button>
      </div>

      {files.length > 0 && (
        <>
          <div className="sidebar-section-label">Explorer</div>
          <div className="file-tree">
            {files.map(node => (
              <TreeNode
                key={node.path}
                node={node}
                depth={0}
                expanded={expandedPaths.has(node.path)}
                selectedPath={selectedPath}
                expandedPaths={expandedPaths}
                onToggle={toggleExpanded}
                onSelect={setSelectedPath}
                onFileAction={(action, path) => {
                  setSelectedPath(null);
                  onFileAction(action, path);
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
