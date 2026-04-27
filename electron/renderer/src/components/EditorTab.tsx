import React, { useState, useEffect, useCallback, useRef, memo } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { dracula } from '@uiw/codemirror-theme-dracula';
import { loadLanguage } from '@uiw/codemirror-extensions-langs';
import { Workspace, FileNode } from '../App';

// ── image detection ───────────────────────────────────────────────────────────

const IMAGE_EXTS: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  ico: 'image/x-icon', tiff: 'image/tiff', avif: 'image/avif',
  svg: 'image/svg+xml',
};

function getImageMime(path: string): string | null {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return IMAGE_EXTS[ext] ?? null;
}

// ── file icon ─────────────────────────────────────────────────────────────────

interface FileIconInfo { label: string; color: string }

function getFileIcon(name: string): FileIconInfo {
  const lower = name.toLowerCase();
  if (lower === 'dockerfile')       return { label: 'DOC', color: '#0db7ed' };
  if (lower === 'makefile')         return { label: 'MK',  color: '#4eaa25' };
  if (lower.includes('.env'))       return { label: 'ENV', color: '#ecd53f' };
  if (lower === 'package.json' || lower === 'package-lock.json') return { label: 'NPM', color: '#cb3837' };

  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, FileIconInfo> = {
    ts:     { label: 'TS',   color: '#3178c6' },
    tsx:    { label: 'TSX',  color: '#61dafb' },
    js:     { label: 'JS',   color: '#f7df1e' },
    jsx:    { label: 'JSX',  color: '#61dafb' },
    mjs:    { label: 'JS',   color: '#f7df1e' },
    py:     { label: 'PY',   color: '#3572a5' },
    rb:     { label: 'RB',   color: '#cc342d' },
    go:     { label: 'GO',   color: '#00add8' },
    rs:     { label: 'RS',   color: '#f74c00' },
    java:   { label: 'JV',   color: '#f89820' },
    kt:     { label: 'KT',   color: '#7f52ff' },
    swift:  { label: 'SW',   color: '#f05138' },
    cs:     { label: 'C#',   color: '#9b4f96' },
    cpp:    { label: 'C++',  color: '#00599c' },
    c:      { label: 'C',    color: '#00599c' },
    json:   { label: '{}',   color: '#cbcb41' },
    md:     { label: 'MD',   color: '#6fb3d2' },
    mdx:    { label: 'MDX',  color: '#6fb3d2' },
    css:    { label: 'CSS',  color: '#264de4' },
    scss:   { label: 'SCSS', color: '#c6538c' },
    sass:   { label: 'SASS', color: '#c6538c' },
    html:   { label: 'HTM',  color: '#e34c26' },
    vue:    { label: 'VUE',  color: '#41b883' },
    svelte: { label: 'SV',   color: '#ff3e00' },
    toml:   { label: 'TOM',  color: '#9c4221' },
    yaml:   { label: 'YML',  color: '#cb171e' },
    yml:    { label: 'YML',  color: '#cb171e' },
    sh:     { label: 'SH',   color: '#4eaa25' },
    sql:    { label: 'SQL',  color: '#e38c00' },
    xml:    { label: 'XML',  color: '#f99132' },
    lock:   { label: 'LK',   color: '#6d8597' },
    png:    { label: 'IMG',  color: '#a259ff' },
    jpg:    { label: 'IMG',  color: '#a259ff' },
    jpeg:   { label: 'IMG',  color: '#a259ff' },
    gif:    { label: 'GIF',  color: '#a259ff' },
    svg:    { label: 'SVG',  color: '#ff7f50' },
    webp:   { label: 'IMG',  color: '#a259ff' },
    txt:    { label: 'TXT',  color: '#6d8597' },
    csv:    { label: 'CSV',  color: '#3fb950' },
    prisma: { label: 'DB',   color: '#5a67d8' },
  };
  return map[ext] ?? { label: '·', color: '#6d8597' };
}

function getLanguageName(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', rs: 'rust', go: 'go', java: 'java',
    css: 'css', scss: 'css', html: 'html', json: 'json', md: 'markdown',
    yaml: 'yaml', yml: 'yaml', sql: 'sql', sh: 'shell',
    toml: 'toml', xml: 'xml', rb: 'ruby', kt: 'kotlin',
    cs: 'csharp', cpp: 'cpp', c: 'c',
  };
  return map[ext] ?? null;
}

// ── file tree ─────────────────────────────────────────────────────────────────

const GIT_COLORS: Record<string, string> = {
  M: '#e5c07b',
  A: '#4ec9b0',
  D: '#f44747',
  R: '#c678dd',
  '?': '#858585',
};

function gitColor(xy: string): string | null {
  const s = xy.trim();
  if (s === '??') return GIT_COLORS['?'];
  const ch = s[0] !== ' ' ? s[0] : s[1];
  return GIT_COLORS[ch] ?? null;
}

interface TreeNodeProps {
  node: FileNode;
  depth: number;
  selectedPath: string | null;
  modifiedPaths: Set<string>;
  gitStatusMap: Map<string, string>;
  onSelect: (path: string) => void;
  onRename: (oldPath: string, newName: string) => void;
}

const TreeNode = memo(function TreeNode({ node, depth, selectedPath, modifiedPaths, gitStatusMap, onSelect, onRename }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  const isSelected = selectedPath === node.path;
  const isModified = node.type === 'file' && modifiedPaths.has(node.path);
  const gitXy = gitStatusMap.get(node.path);
  const nameColor = gitXy ? gitColor(gitXy) : null;

  const handleClick = useCallback(() => {
    if (renaming) return;
    if (node.type === 'dir') setExpanded(e => !e);
    else onSelect(node.path);
  }, [renaming, node.type, node.path, onSelect]);

  const startRename = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setRenameVal(node.name);
    setRenaming(true);
    setTimeout(() => renameInputRef.current?.select(), 0);
  }, [node.name]);

  const commitRename = useCallback(() => {
    const trimmed = renameVal.trim();
    if (trimmed && trimmed !== node.name) onRename(node.path, trimmed);
    setRenaming(false);
  }, [renameVal, node.name, node.path, onRename]);

  const handleRenameKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') commitRename();
    else if (e.key === 'Escape') setRenaming(false);
  }, [commitRename]);

  return (
    <div>
      <div
        className={`tree-node ${isSelected ? 'selected' : ''}`}
        style={{ '--depth': depth } as React.CSSProperties}
        onClick={handleClick}
      >
        {node.type === 'dir' ? (
          <span className="tree-dir-icon">{expanded ? '▾' : '▸'}</span>
        ) : (
          (() => {
            const icon = getFileIcon(node.name);
            return (
              <span
                className="tree-file-badge"
                style={{ color: icon.color, background: `${icon.color}1a`, border: `1px solid ${icon.color}33` }}
              >
                {icon.label}
              </span>
            );
          })()
        )}
        {renaming ? (
          <input
            ref={renameInputRef}
            className="tree-rename-input"
            value={renameVal}
            onChange={e => setRenameVal(e.target.value)}
            onKeyDown={handleRenameKey}
            onBlur={() => setRenaming(false)}
            onClick={e => e.stopPropagation()}
            autoFocus
          />
        ) : (
          <>
            <span
              className={`tree-name ${node.type}`}
              style={nameColor ? { color: nameColor } : undefined}
              onDoubleClick={startRename}
            >{node.name}</span>
            {isModified && <span className="tree-modified-dot" title="Unsaved changes" />}
          </>
        )}
      </div>
      {node.type === 'dir' && expanded && node.children?.map(child => (
        <TreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          selectedPath={selectedPath}
          modifiedPaths={modifiedPaths}
          gitStatusMap={gitStatusMap}
          onSelect={onSelect}
          onRename={onRename}
        />
      ))}
    </div>
  );
});

// ── tab content cache ─────────────────────────────────────────────────────────

interface TabData {
  original: string;
  edited: string;
  saving: boolean;
}

// ── editor tab ────────────────────────────────────────────────────────────────

interface Props {
  workspace: Workspace | null;
  onFileAction: (action: 'explain' | 'review' | 'edit', filePath: string) => void;
  onOpenProject: () => void;
  onSelectFile: (filePath: string) => void;
  onCloseTab: (filePath: string) => void;
  onReloadTree: (root?: string | null) => void;
}

export default memo(function EditorTab({ workspace, onFileAction, onOpenProject, onSelectFile, onCloseTab, onReloadTree }: Props) {
  // Content cache: path → TabData
  const [tabMap, setTabMap] = useState<Map<string, TabData>>(() => new Map());
  // Image cache: path → data URI
  const [imageMap, setImageMap] = useState<Map<string, string>>(() => new Map());
  // Git status: absolute path → xy status code
  const [gitStatusMap, setGitStatusMap] = useState<Map<string, string>>(() => new Map());
  const loadingRef = useRef<Set<string>>(new Set());
  const wsIdRef = useRef<string | null>(null);

  const selectedPath = workspace?.selectedFilePath ?? null;
  const openTabs = workspace?.openTabs ?? [];

  // Clear caches on workspace switch
  useEffect(() => {
    if (workspace?.id === wsIdRef.current) return;
    wsIdRef.current = workspace?.id ?? null;
    setTabMap(new Map());
    setImageMap(new Map());
    loadingRef.current.clear();
  }, [workspace?.id]);

  // Fetch git status for file tree colors
  useEffect(() => {
    const root = workspace?.projectRoot;
    if (!root) return;
    window.api.gitStatus(root).then(files => {
      const map = new Map<string, string>();
      files.forEach(f => map.set(`${root}/${f.path}`, f.xy));
      setGitStatusMap(map);
    }).catch(() => {});
  }, [workspace?.projectRoot, workspace?.files]);

  // Load file content whenever a new path is activated
  useEffect(() => {
    if (!selectedPath || loadingRef.current.has(selectedPath)) return;

    const mime = getImageMime(selectedPath);

    if (mime) {
      if (imageMap.has(selectedPath)) return;
      loadingRef.current.add(selectedPath);
      window.api.readFileBinary(selectedPath).then(b64 => {
        loadingRef.current.delete(selectedPath);
        if (b64) setImageMap(prev => new Map(prev).set(selectedPath, `data:${mime};base64,${b64}`));
      });
      return;
    }

    if (tabMap.has(selectedPath)) return;
    loadingRef.current.add(selectedPath);
    window.api.readFile(selectedPath).then(content => {
      loadingRef.current.delete(selectedPath);
      const c = content ?? '';
      setTabMap(prev => new Map(prev).set(selectedPath, { original: c, edited: c, saving: false }));
    });
  }, [selectedPath, tabMap, imageMap]);

  const activeData = selectedPath ? tabMap.get(selectedPath) : undefined;
  const isModified = activeData ? activeData.edited !== activeData.original : false;

  const modifiedPaths = React.useMemo(() => {
    const s = new Set<string>();
    tabMap.forEach((data, path) => { if (data.edited !== data.original) s.add(path); });
    return s;
  }, [tabMap]);

  const handleChange = useCallback((value: string) => {
    setTabMap(prev => {
      const cur = prev.get(selectedPath ?? '');
      if (!cur) return prev;
      return new Map(prev).set(selectedPath!, { ...cur, edited: value });
    });
  }, [selectedPath]);

  const handleSave = useCallback(async () => {
    if (!selectedPath || !isModified) return;
    const data = tabMap.get(selectedPath);
    if (!data || data.saving) return;
    setTabMap(prev => new Map(prev).set(selectedPath, { ...data, saving: true }));
    const res = await window.api.writeFile(selectedPath, data.edited);
    setTabMap(prev => {
      const cur = prev.get(selectedPath);
      if (!cur) return prev;
      return new Map(prev).set(selectedPath, {
        ...cur,
        original: res.error ? cur.original : cur.edited,
        saving: false,
      });
    });
  }, [selectedPath, isModified, tabMap]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); handleSave(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  const handleRename = useCallback(async (oldPath: string, newName: string) => {
    const dir = oldPath.split('/').slice(0, -1).join('/');
    const newPath = `${dir}/${newName}`;
    await window.api.renameFile(oldPath, newPath);
    onReloadTree();
  }, [onReloadTree]);

  const handleCloseTab = useCallback((e: React.MouseEvent, path: string) => {
    e.stopPropagation();
    setTabMap(prev => { const next = new Map(prev); next.delete(path); return next; });
    setImageMap(prev => { const next = new Map(prev); next.delete(path); return next; });
    loadingRef.current.delete(path);
    onCloseTab(path);
  }, [onCloseTab]);

  const langName = selectedPath ? getLanguageName(selectedPath.split('/').pop() ?? '') : null;
  const langExt = langName ? loadLanguage(langName as Parameters<typeof loadLanguage>[0]) : null;
  const isImage = selectedPath ? getImageMime(selectedPath) !== null : false;
  const imageSrc = selectedPath ? imageMap.get(selectedPath) : undefined;

  return (
    <div className="editor-view">
      {/* file tree */}
      <div className="file-tree-pane">
        {!workspace?.projectRoot ? (
          <div className="pane-empty">
            <button className="open-btn" onClick={onOpenProject}>Open folder…</button>
          </div>
        ) : (
          <>
            <div className="file-tree-header">
              <span className="file-tree-title">{workspace.projectRoot.split('/').pop()}</span>
              <button className="file-tree-refresh-btn" onClick={() => onReloadTree()} title="Refresh">↺</button>
            </div>
            <div className="file-tree">
              {workspace.files.map(node => (
                <TreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  selectedPath={selectedPath}
                  modifiedPaths={modifiedPaths}
                  gitStatusMap={gitStatusMap}
                  onSelect={onSelectFile}
                  onRename={handleRename}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {/* editor area */}
      <div className="file-content-pane">
        {/* tab bar */}
        {openTabs.length > 0 && (
          <div className="editor-tab-bar">
            {openTabs.map(path => {
              const name = path.split('/').pop() ?? path;
              const data = tabMap.get(path);
              const tabModified = data ? data.edited !== data.original : false;
              const isActive = path === selectedPath;
              return (
                <div
                  key={path}
                  className={`editor-tab ${isActive ? 'active' : ''}`}
                  onClick={() => onSelectFile(path)}
                  title={path}
                >
                  {(() => {
                    const icon = getFileIcon(name);
                    return (
                      <span
                        className="editor-tab-icon"
                        style={{ color: icon.color }}
                      >
                        {icon.label}
                      </span>
                    );
                  })()}
                  <span className="editor-tab-name">{name}</span>
                  {tabModified && <span className="editor-tab-modified" />}
                  <span
                    className="editor-tab-close"
                    onClick={e => handleCloseTab(e, path)}
                    title="Close"
                  >
                    ✕
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* content */}
        {isImage ? (
          <div className="image-preview-pane">
            {imageSrc
              ? <img src={imageSrc} alt={selectedPath?.split('/').pop()} className="file-image-preview" />
              : <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>Loading…</span>
            }
          </div>
        ) : selectedPath && activeData ? (
          <>
            <div className="file-content-header">
              <span className="file-content-name">
                {selectedPath.split('/').pop()}
                {isModified && <span className="modified-dot" title="Unsaved changes" />}
              </span>
              <div className="file-content-actions">
                {isModified && (
                  <button className="file-action-btn save" onClick={handleSave} disabled={activeData.saving}>
                    {activeData.saving ? 'Saving…' : 'Save'}
                  </button>
                )}
                <button className="file-action-btn explain" onClick={() => onFileAction('explain', selectedPath)}>Explain</button>
                <button className="file-action-btn review" onClick={() => onFileAction('review', selectedPath)}>Review</button>
                <button className="file-action-btn edit-ai" onClick={() => onFileAction('edit', selectedPath)}>Edit (AI)</button>
              </div>
            </div>
            <div className="codemirror-wrap">
              <CodeMirror
                value={activeData.edited}
                theme={dracula}
                extensions={langExt ? [langExt] : []}
                onChange={handleChange}
                height="100%"
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  highlightActiveLine: true,
                  highlightSelectionMatches: true,
                  autocompletion: true,
                }}
              />
            </div>
          </>
        ) : (
          <div className="pane-empty">
            <span>{workspace?.projectRoot ? 'Select a file to view or edit' : 'Open a project folder first'}</span>
          </div>
        )}
      </div>
    </div>
  );
});
