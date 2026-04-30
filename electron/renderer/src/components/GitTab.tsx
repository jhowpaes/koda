import React, { useState, useEffect, useRef } from 'react';
import { ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import { loadSettings } from './SettingsModal';

interface GitFile { xy: string; path: string }
interface LogEntry { hash: string; message: string }
interface Branch { name: string; current: boolean }

interface Props {
  projectRoot: string | null;
}

function statusColor(xy: string) {
  const s = xy.trim();
  if (s === '??') return '#858585';
  if (s[0] === 'A' || s[1] === 'A') return '#4ec9b0';
  if (s[0] === 'D' || s[1] === 'D') return '#f44747';
  return '#e5c07b';
}

function statusLabel(xy: string) {
  const s = xy.trim();
  if (s === '??') return 'U';
  if (xy[0] === 'A' || xy[1] === 'A') return 'A';
  if (xy[0] === 'D' || xy[1] === 'D') return 'D';
  if (xy[0] === 'R' || xy[1] === 'R') return 'R';
  return 'M';
}

export default function GitTab({ projectRoot }: Props) {
  const [branch, setBranch] = useState('');
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showBranches, setShowBranches] = useState(false);
  const [files, setFiles] = useState<GitFile[]>([]);
  const [stagedPaths, setStagedPaths] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [diff, setDiff] = useState('');
  const [diffHeader, setDiffHeader] = useState('');
  const [commitMsg, setCommitMsg] = useState('');
  const [log, setLog] = useState<LogEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [toast, setToast] = useState('');

  useEffect(() => {
    if (projectRoot) refresh();
  }, [projectRoot]);

  // Auto-refresh git status every 5s
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!projectRoot) return;
    refreshTimerRef.current = setInterval(() => {
      window.api.gitStatus(projectRoot).then(s => {
        setFiles(s);
        const staged = new Set<string>();
        s.forEach(f => { if (f.xy[0] !== ' ' && f.xy[0] !== '?') staged.add(f.path); });
        setStagedPaths(staged);
      }).catch(() => {});
    }, 5000);
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [projectRoot]);

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  async function refresh() {
    if (!projectRoot) return;
    const [s, b, bl, l] = await Promise.all([
      window.api.gitStatus(projectRoot),
      window.api.gitBranch(projectRoot),
      window.api.gitBranches(projectRoot),
      window.api.gitLog(projectRoot),
    ]);
    setFiles(s);
    setBranch(b);
    setBranches(bl);
    setLog(l);
    // mirror staged state from git status
    const staged = new Set<string>();
    s.forEach(f => { if (f.xy[0] !== ' ' && f.xy[0] !== '?') staged.add(f.path); });
    setStagedPaths(staged);
  }

  async function showFileDiff(filePath: string) {
    if (!projectRoot) return;
    setSelectedFile(filePath);
    setSelectedCommit(null);
    const d = await window.api.gitFileDiff(projectRoot, filePath, stagedPaths.has(filePath));
    setDiffHeader(filePath);
    setDiff(d || '(no diff)');
  }

  async function showCommitDiff(entry: LogEntry) {
    if (!projectRoot) return;
    setSelectedCommit(entry.hash);
    setSelectedFile(null);
    const d = await window.api.gitCommitDiff(projectRoot, entry.hash);
    setDiffHeader(`${entry.hash}  ${entry.message}`);
    setDiff(d || '(no diff)');
  }

  async function discard(filePath: string) {
    if (!projectRoot) return;
    const res = await window.api.gitDiscard(projectRoot, filePath);
    if (res.ok) {
      if (selectedFile === filePath) { setSelectedFile(null); setDiff(''); setDiffHeader(''); }
      await refresh();
    } else {
      showToast(`Error: ${res.error}`);
    }
  }

  async function toggleStage(filePath: string) {
    if (!projectRoot) return;
    if (stagedPaths.has(filePath)) {
      await window.api.gitUnstage(projectRoot, filePath);
      setStagedPaths(prev => { const n = new Set(prev); n.delete(filePath); return n; });
    } else {
      await window.api.gitStage(projectRoot, filePath);
      setStagedPaths(prev => new Set([...prev, filePath]));
    }
  }

  async function generateMsg() {
    if (!projectRoot) return;
    setGenLoading(true);
    try {
      const settings = loadSettings();
      const provider = settings.providers.find(p => p.enabled && p.apiKey);
      if (!provider) { showToast('No provider configured. Go to Settings → Providers.'); return; }
      const model = provider.models.split(',')[0].trim();
      const d = await window.api.gitDiff(projectRoot);
      const res = await window.api.generateCommit(projectRoot, d, {
        apiKey: provider.apiKey,
        baseUrl: provider.baseUrl ?? '',
        model,
      });
      if (res.error) showToast(`Error: ${res.error}`);
      else setCommitMsg(res.message ?? '');
    } catch (e) {
      showToast(`Error: ${(e as Error).message}`);
    } finally {
      setGenLoading(false);
    }
  }

  async function commit() {
    if (!projectRoot || !commitMsg.trim()) return;
    const res = await window.api.gitCommit(projectRoot, commitMsg.trim());
    if (res.ok) {
      setCommitMsg('');
      showToast('✓ Committed');
      await refresh();
    } else {
      showToast(`Error: ${res.error}`);
    }
  }

  async function push() {
    if (!projectRoot) return;
    setSyncing(true);
    const res = await window.api.gitPush(projectRoot);
    showToast(res.ok ? '✓ Pushed' : `Push failed: ${res.error}`);
    setSyncing(false);
  }

  async function pull() {
    if (!projectRoot) return;
    setSyncing(true);
    const res = await window.api.gitPull(projectRoot);
    showToast(res.ok ? '✓ Pulled' : `Pull failed: ${res.error}`);
    setSyncing(false);
    if (res.ok) await refresh();
  }

  async function checkout(name: string) {
    if (!projectRoot) return;
    await window.api.gitCheckout(projectRoot, name);
    setShowBranches(false);
    await refresh();
  }

  if (!projectRoot) {
    return <div className="pane-empty"><span>Open a project folder first</span></div>;
  }

  return (
    <div className="git-view">
      {/* branch bar */}
      <div className="git-topbar">
        <div className="git-branch-wrap">
          <button className="git-branch-btn" onClick={() => setShowBranches(v => !v)}>
            ⎇ {branch || '…'} ▾
          </button>
          {showBranches && (
            <div className="git-branch-dropdown">
              {branches.map(b => (
                <button key={b.name} className={`git-branch-option ${b.current ? 'current' : ''}`} onClick={() => checkout(b.name)}>
                  {b.current ? '✓ ' : '  '}{b.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="git-topbar-actions">
          <button className="git-sync-btn" onClick={pull} disabled={syncing} title="Pull"><ArrowDown size={11} strokeWidth={2} /> Pull</button>
          <button className="git-sync-btn" onClick={push} disabled={syncing} title="Push"><ArrowUp size={11} strokeWidth={2} /> Push</button>
          <button className="git-sync-btn git-sync-icon-only" onClick={refresh} title="Refresh"><RefreshCw size={11} strokeWidth={2} /></button>
        </div>
      </div>

      {toast && <div className="git-toast">{toast}</div>}

      <div className="git-body">
        {/* left column */}
        <div className="git-left">
          <div className="git-section-label">
            Changes ({files.length})
            <button className="git-refresh-btn" onClick={refresh} title="Refresh"><RefreshCw size={11} strokeWidth={2} /></button>
          </div>
          <div className="git-files">
            {files.length === 0 && <div className="git-empty">No changes</div>}
            {files.map(f => (
              <div
                key={f.path}
                className={`git-file ${selectedFile === f.path ? 'selected' : ''}`}
                onClick={() => showFileDiff(f.path)}
              >
                <input
                  type="checkbox"
                  className="git-checkbox"
                  checked={stagedPaths.has(f.path)}
                  onChange={() => toggleStage(f.path)}
                  onClick={e => e.stopPropagation()}
                />
                <span className={`git-file-status ${statusLabel(f.xy)}`}>
                  {statusLabel(f.xy)}
                </span>
                <span className="git-file-path" title={f.path}>{f.path}</span>
                <button
                  className="git-discard-btn"
                  title="Discard changes"
                  onClick={e => { e.stopPropagation(); discard(f.path); }}
                >↩</button>
              </div>
            ))}
          </div>

          <div className="git-section-label">Commit</div>
          <div className="git-commit-area">
            <button className="git-ai-btn" onClick={generateMsg} disabled={genLoading}>
              {genLoading ? '…' : '✨ Generate with AI'}
            </button>
            <textarea
              className="git-commit-input"
              value={commitMsg}
              onChange={e => setCommitMsg(e.target.value)}
              placeholder="Commit message…"
              rows={3}
            />
            <button className="git-commit-btn" onClick={commit} disabled={!commitMsg.trim()}>
              Commit
            </button>
          </div>

          <div className="git-section-label">Recent commits</div>
          <div className="git-log">
            {log.map(e => (
              <div
                key={e.hash}
                className={`git-log-entry ${selectedCommit === e.hash ? 'selected' : ''}`}
                onClick={() => showCommitDiff(e)}
                title="Click to see changes"
              >
                <span className="git-log-hash">{e.hash}</span>
                <span className="git-log-msg">{e.message}</span>
              </div>
            ))}
          </div>
        </div>

        {/* right column — diff viewer */}
        <div className="git-right">
          {(selectedFile || selectedCommit) && diff ? (
            <>
              <div className="git-diff-header">{diffHeader}</div>
              <div className="git-diff-content">
                {diff.split('\n').map((line, i) => {
                  const cls = line.startsWith('+') && !line.startsWith('+++')
                    ? 'added'
                    : line.startsWith('-') && !line.startsWith('---')
                    ? 'removed'
                    : line.startsWith('@@')
                    ? 'meta'
                    : 'normal';
                  return <div key={i} className={`diff-line ${cls}`}>{line}</div>;
                })}
              </div>
            </>
          ) : (
            <div className="pane-empty">
              <span>Click a file to see its diff</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
