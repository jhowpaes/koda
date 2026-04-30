import { useState, useEffect, useRef, useCallback, memo, useMemo } from 'react';
import WorkspaceRail from './components/WorkspaceRail';
import ChatsPanel from './components/ChatsPanel';
import RightPanel from './components/RightPanel';
import DiffModal from './components/DiffModal';
import SettingsModal, { loadSettings } from './components/SettingsModal';
import KodaPanel, { type KodaState, type KodaProgressEvent, EMPTY_KODA_STATE } from './components/KodaPanel';
import ProjectSetup from './components/ProjectSetup';

export interface ContentBlock {
  type: 'thinking' | 'tool_use' | 'text';
  content: string;
  name?: string;     // tool name
  label?: string;    // human-readable tool label
  elapsed?: number;  // seconds (thinking)
  done?: boolean;    // tool completed
  streaming?: boolean;
}

export interface MessageSummary {
  text: string;
  stats: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  blocks?: ContentBlock[];
  streaming?: boolean;
  interrupted?: boolean;
  summary?: MessageSummary;
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

export interface KodaHistoryStep {
  agent: string;
  description: string;
  result?: string;
  error?: string;
}

export interface KodaHistoryEntry {
  id: string;
  timestamp: string;
  task: string;
  complexity?: string;
  steps: KodaHistoryStep[];
  summary: string;
}

export interface DiffData {
  filePath: string;
  original: string;
  modified: string;
}

export interface ChatSession {
  id: string;
  title: string;
  model: string;
  messages: Message[];
  isExpanded: boolean;
  pendingDiff: DiffData | null;
  editLoading: boolean;
  pendingEditFile: { filePath: string } | null;
}

export interface Workspace {
  id: string;
  name: string;
  projectRoot: string | null;
  files: FileNode[];
  chats: ChatSession[];
  selectedFilePath: string | null;
  openTabs: string[];
  mode: 'chat' | 'koda';
}

declare global {
  interface Window {
    api: {
      koda: {
        plan: (projectRoot: string, task: string, ws?: unknown) => Promise<{ plan?: unknown; error?: string }>;
        run: (workspaceId: string, projectRoot: string, task: string, plan?: unknown, ws?: unknown, settings?: unknown) => void;
        stop: (workspaceId: string) => Promise<void>;
        onProgress: (cb: (data: { workspaceId: string; event: unknown }) => void) => void;
        onDone: (cb: (data: { workspaceId: string; error?: string }) => void) => void;
        onChats: (cb: (data: { workspaceId: string; chats: Array<{ chatId: string; title: string; model: string }> }) => void) => void;
        off: () => void;
        tts: (text: string, cfg: unknown) => Promise<{ data?: string; error?: string }>;
        stt: (audioData: string) => Promise<{ text?: string; error?: string }>;
        getConfig: () => Promise<unknown>;
        saveConfig: (cfg: unknown) => Promise<{ ok?: boolean }>;
        listWorkspaces: () => Promise<unknown[]>;
        loadHistory: (projectRoot: string) => Promise<KodaHistoryEntry[]>;
        saveHistory: (projectRoot: string, entry: KodaHistoryEntry) => Promise<{ ok?: boolean }>;
      };
      openProject: () => Promise<string | null>;
      onOpenPath: (cb: (path: string) => void) => void;
      getFileTree: (dir: string) => Promise<FileNode[]>;
      renameFile: (oldPath: string, newPath: string) => Promise<{ ok?: boolean; error?: string }>;
      watchProject: (root: string) => Promise<void>;
      unwatchProject: (root: string) => Promise<void>;
      onFilesChanged: (cb: (root: string) => void) => void;
      readFile: (path: string) => Promise<string | null>;
      readFileBinary: (path: string) => Promise<string | null>;
      writeFile: (path: string, content: string) => Promise<{ ok?: boolean; error?: string }>;
      loadChats: (projectRoot: string) => Promise<ChatSession[] | null>;
      saveChats: (projectRoot: string, chats: ChatSession[]) => Promise<{ ok?: boolean; error?: string }>;
      runShell: (root: string, command: string) => void;
      killShell: () => Promise<{ ok?: boolean }>;
      onShellOutput: (cb: (data: string, type: string) => void) => void;
      onShellDone: (cb: (code: number | null) => void) => void;
      offShell: () => void;
      chat: (root: string, chatId: string, msg: string) => void;
      ask: (root: string, chatId: string, msg: string) => void;
      explain: (root: string, chatId: string, path: string) => void;
      review: (root: string, chatId: string, path: string) => void;
      chatAgentic: (root: string, chatId: string, msg: string, config: { apiKey: string; baseUrl: string; model: string; isAnthropic: boolean; systemPrompt?: string }) => void;
      onChunk: (cb: (chatId: string, chunk: string) => void) => void;
      onDone: (cb: (chatId: string) => void) => void;
      onAgentEvent: (cb: (ev: any) => void) => void;
      stopStreaming: (chatId?: string) => Promise<void>;
      offStreaming: () => void;
      editRequest: (root: string, path: string, instruction: string) => Promise<{
        original?: string; modified?: string; filePath?: string; error?: string;
      }>;
      applyEdit: (path: string, content: string) => Promise<{ ok?: boolean; error?: string }>;
      gitDiff: (root: string) => Promise<string>;
      generateCommit: (root: string, diff: string, cfg: { apiKey: string; baseUrl: string; model: string }) => Promise<{ message?: string; error?: string }>;
      gitCommit: (root: string, msg: string) => Promise<{ ok?: boolean; error?: string }>;
      gitStatus: (root: string) => Promise<Array<{ xy: string; path: string }>>;
      gitFileDiff: (root: string, filePath: string, staged: boolean) => Promise<string>;
      gitStage: (root: string, filePath: string) => Promise<{ ok?: boolean; error?: string }>;
      gitUnstage: (root: string, filePath: string) => Promise<{ ok?: boolean; error?: string }>;
      gitLog: (root: string, limit?: number) => Promise<Array<{ hash: string; message: string }>>;
      gitCommitDiff: (root: string, hash: string) => Promise<string>;
      gitDiscard: (root: string, filePath: string) => Promise<{ ok?: boolean; error?: string }>;
      gitBranch: (root: string) => Promise<string>;
      gitBranches: (root: string) => Promise<Array<{ name: string; current: boolean }>>;
      gitCheckout: (root: string, branch: string) => Promise<{ ok?: boolean; error?: string }>;
      gitPush: (root: string) => Promise<{ ok?: boolean; error?: string }>;
      gitPull: (root: string) => Promise<{ ok?: boolean; error?: string }>;
      loadKanban: (projectRoot: string) => Promise<import('./components/KanbanTab').KanbanCard[]>;
      saveKanban: (projectRoot: string, cards: import('./components/KanbanTab').KanbanCard[]) => Promise<{ ok?: boolean; error?: string }>;
      proposeKanban: (projectRoot: string, cfg: { apiKey: string; baseUrl: string; model: string }) => Promise<{ cards?: import('./components/KanbanTab').KanbanCard[]; error?: string }>;
      onKanbanCeoDone:     (cb: (data: { workspaceId: string; error?: string }) => void) => void;
      offKanbanCeoDone:    (cb: (data: { workspaceId: string; error?: string }) => void) => void;
      onKanbanCeoProgress: (cb: (data: { workspaceId: string; event: unknown }) => void) => void;
      offKanbanCeoProgress:(cb: (data: { workspaceId: string; event: unknown }) => void) => void;
    };
  }
}

let idCounter = 0;
function uid() { return `${Date.now()}-${++idCounter}`; }

function newChat(): ChatSession {
  return {
    id: uid(),
    title: 'New Chat',
    model: 'glm-5.1',
    messages: [],
    isExpanded: true,
    pendingDiff: null,
    editLoading: false,
    pendingEditFile: null,
  };
}

function newWorkspace(name: string): Workspace {
  const chat = newChat();
  return { id: uid(), name, projectRoot: null, files: [], chats: [chat], selectedFilePath: null, openTabs: [], mode: 'chat' };
}

// ── persistence ────────────────────────────────────────────────────────────────

const WS_KEY = 'code-ai:workspaces';
const ACTIVE_KEY = 'code-ai:activeWorkspace';

function sanitizeChats(chats: ChatSession[]): ChatSession[] {
  return (chats ?? []).map(c => ({ ...c, editLoading: false, pendingDiff: null, pendingEditFile: null, streaming: undefined }));
}

function saveWorkspaces(wss: Workspace[], activeId: string) {
  try {
    // Strip file trees (reloaded from disk) and chats for project workspaces (saved to .codeai/chats.json)
    const serializable = wss.map(ws => ({
      ...ws,
      files: [],
      chats: ws.projectRoot ? [] : ws.chats,
    }));
    localStorage.setItem(WS_KEY, JSON.stringify(serializable));
    localStorage.setItem(ACTIVE_KEY, activeId);
  } catch {}
}

function loadWorkspaces(): { workspaces: Workspace[]; activeId: string } | null {
  try {
    const raw = localStorage.getItem(WS_KEY);
    if (!raw) return null;
    const wss: Workspace[] = JSON.parse(raw);
    if (!wss.length) return null;
    const clean = wss.map(ws => ({
      ...ws,
      files: [],
      openTabs: ws.openTabs ?? [],
      selectedFilePath: ws.selectedFilePath ?? null,
      mode: ws.mode ?? 'chat' as const,
      // Project workspaces start with empty chats — loaded async from .codeai/chats.json
      chats: ws.projectRoot ? [] : sanitizeChats(ws.chats ?? []),
    }));
    const activeId = localStorage.getItem(ACTIVE_KEY) ?? clean[0].id;
    return { workspaces: clean, activeId };
  } catch {
    return null;
  }
}

const persisted = loadWorkspaces();
const initialWorkspace = newWorkspace('Workspace 1');

// Memoize RightPanel to avoid re-renders during chat streaming
const MemoRightPanel = memo(RightPanel);

export default function App() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(persisted?.workspaces ?? [initialWorkspace]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(persisted?.activeId ?? initialWorkspace.id);
  const [streamingChatIds, setStreamingChatIds] = useState<string[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [chatsPanelWidth, setChatsPanelWidth] = useState(() =>
    parseInt(localStorage.getItem('chatsPanelWidth') ?? '320')
  );
  const [kodaStates,   setKodaStates]   = useState<Record<string, KodaState>>({});
  const [kodaHistories, setKodaHistories] = useState<Record<string, KodaHistoryEntry[]>>({});

  const streamingChatIdsRef = useRef<Set<string>>(new Set());
  const activeWorkspaceIdRef = useRef<string>(activeWorkspaceId);
  const workspacesRef = useRef<Workspace[]>(workspaces);
  const treeDirtyRef = useRef(false);
  const wasInterruptedChatIds = useRef<Set<string>>(new Set());

  useEffect(() => { activeWorkspaceIdRef.current = activeWorkspaceId; }, [activeWorkspaceId]);
  useEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);

  // Persist workspaces on every change
  useEffect(() => {
    saveWorkspaces(workspaces, activeWorkspaceId);
  }, [workspaces, activeWorkspaceId]);

  // On mount: reload file trees + load chats from .codeai/chats.json for project workspaces
  useEffect(() => {
    workspaces.forEach(ws => {
      if (!ws.projectRoot) return;

      if (ws.files.length === 0) {
        window.api.getFileTree(ws.projectRoot).then(tree => {
          setWorkspaces(prev => prev.map(w => w.id === ws.id ? { ...w, files: tree } : w));
        }).catch(() => {});
      }

      window.api.loadChats(ws.projectRoot).then(chats => {
        if (chats && chats.length > 0) {
          setWorkspaces(prev => prev.map(w =>
            w.id === ws.id ? { ...w, chats: sanitizeChats(chats) } : w
          ));
        } else if (ws.chats.length === 0) {
          // New project — seed with one empty chat
          setWorkspaces(prev => prev.map(w =>
            w.id === ws.id && w.chats.length === 0 ? { ...w, chats: [newChat()] } : w
          ));
        }
      }).catch(() => {});

      window.api.koda.loadHistory(ws.projectRoot).then(entries => {
        if (entries?.length) {
          setKodaHistories(prev => ({ ...prev, [ws.id]: entries }));
        }
      }).catch(() => {});
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // only on mount

  // Auto-save chats to .codeai/chats.json (debounced 1.5s, skip during streaming)
  useEffect(() => {
    if (streamingChatIds.length > 0) return;
    const timer = setTimeout(() => {
      workspaces.forEach(ws => {
        if (!ws.projectRoot || ws.chats.length === 0) return;
        window.api.saveChats(ws.projectRoot, sanitizeChats(ws.chats));
      });
    }, 1500);
    return () => clearTimeout(timer);
  }, [workspaces, streamingChatIds]);

  // Handle `koda .` CLI — open a new workspace for the given path
  useEffect(() => {
    window.api.onOpenPath(async (folder: string) => {
      const existing = workspacesRef.current.find(ws => ws.projectRoot === folder);
      if (existing) {
        setActiveWorkspaceId(existing.id);
        return;
      }
      const [tree, savedChats] = await Promise.all([
        window.api.getFileTree(folder),
        window.api.loadChats(folder),
      ]);
      const name = folder.split('/').pop() ?? 'Project';
      const ws = newWorkspace(name);
      const chats = savedChats && savedChats.length > 0 ? sanitizeChats(savedChats) : ws.chats;
      const wsReady = { ...ws, name, projectRoot: folder, files: tree, chats };
      setWorkspaces(prev => [...prev, wsReady]);
      setActiveWorkspaceId(wsReady.id);
      window.api.watchProject(folder).catch(() => {});
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = chatsPanelWidth;
    function onMove(ev: MouseEvent) {
      const next = Math.max(220, Math.min(640, startW + ev.clientX - startX));
      setChatsPanelWidth(next);
      localStorage.setItem('chatsPanelWidth', String(next));
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [chatsPanelWidth]);

  function startStreaming(chatId: string) {
    streamingChatIdsRef.current.add(chatId);
    setStreamingChatIds(Array.from(streamingChatIdsRef.current));
  }

  function stopStreamingChat(chatId: string) {
    streamingChatIdsRef.current.delete(chatId);
    setStreamingChatIds(Array.from(streamingChatIdsRef.current));
  }

  function computeSummary(blocks: ContentBlock[]): MessageSummary | null {
    const written: string[] = [];
    const ran: string[] = [];
    let readCount = 0;
    let searchCount = 0;
    for (const b of blocks) {
      if (b.type !== 'tool_use') continue;
      if (b.name === 'write_file') written.push(b.label?.replace(/^Write\s+/, '') ?? '?');
      else if (b.name === 'read_file' || b.name === 'read_file_lines') readCount++;
      else if (b.name === 'bash') ran.push(b.label?.replace(/^Run:\s+/, '') ?? 'comando');
      else if (b.name === 'search_files') searchCount++;
    }
    if (!written.length && !ran.length && readCount < 3 && !searchCount) return null;

    // Natural language text
    const textParts: string[] = [];
    if (written.length === 1) textParts.push(`modificou ${written[0]}`);
    else if (written.length > 1) textParts.push(`modificou ${written.length} arquivos`);
    if (ran.length) textParts.push(`executou ${ran.length} comando${ran.length > 1 ? 's' : ''}`);
    if (readCount) textParts.push(`analisou ${readCount} arquivo${readCount > 1 ? 's' : ''}`);
    if (searchCount && !textParts.length) textParts.push(`buscou em ${searchCount} padrão${searchCount > 1 ? 'ões' : ''}`);
    const rawText = textParts.join(', ');
    const text = rawText ? rawText.charAt(0).toUpperCase() + rawText.slice(1) + '.' : '';

    // Compact stats
    const statsParts: string[] = [];
    if (written.length) statsParts.push(`✎ ${written.join(', ')}`);
    if (ran.length) statsParts.push(`⚡ ${ran.length} cmd`);
    if (readCount) statsParts.push(`📄 ${readCount}`);
    if (searchCount) statsParts.push(`🔍 ${searchCount}`);

    return { text, stats: statsParts.join('  ') };
  }

  useEffect(() => {
    // Simple streaming (non-Claude providers)
    window.api.onChunk((chatId, chunk) => {
      if (!streamingChatIdsRef.current.has(chatId)) return;
      setWorkspaces(prev => prev.map(ws => ({
        ...ws,
        chats: ws.chats.map(chat => {
          if (chat.id !== chatId) return chat;
          const msgs = chat.messages;
          const last = msgs[msgs.length - 1];
          if (!last?.streaming) return chat;
          return { ...chat, messages: [...msgs.slice(0, -1), { ...last, content: last.content + chunk }] };
        }),
      })));
    });

    // Agentic streaming (Anthropic — thinking + tool use blocks)
    window.api.onAgentEvent((ev: any) => {
      const { chatId, ...rest } = ev;
      if (!chatId || !streamingChatIdsRef.current.has(chatId)) return;
      setWorkspaces(prev => prev.map(ws => ({
        ...ws,
        chats: ws.chats.map(chat => {
          if (chat.id !== chatId) return chat;
          const msgs = chat.messages;
          const last = msgs[msgs.length - 1];
          if (!last?.streaming) return chat;

          const blocks: ContentBlock[] = [...(last.blocks ?? [])];

          if (rest.type === 'thinking_start') {
            blocks.push({ type: 'thinking', content: '', streaming: true });
          } else if (rest.type === 'thinking_delta') {
            const i = blocks.findLastIndex(b => b.type === 'thinking' && b.streaming);
            if (i >= 0) blocks[i] = { ...blocks[i], content: blocks[i].content + rest.text };
          } else if (rest.type === 'thinking_end') {
            const i = blocks.findLastIndex(b => b.type === 'thinking' && b.streaming);
            if (i >= 0) blocks[i] = { ...blocks[i], streaming: false, elapsed: rest.elapsed };
          } else if (rest.type === 'tool_start') {
            if (rest.name === 'write_file' || rest.name === 'bash') treeDirtyRef.current = true;
            const existing = blocks.findLastIndex(b => b.type === 'tool_use' && b.name === rest.name && !b.done);
            if (existing >= 0) {
              blocks[existing] = { ...blocks[existing], label: rest.label };
            } else {
              blocks.push({ type: 'tool_use', content: '', name: rest.name, label: rest.label, done: false });
            }
          } else if (rest.type === 'tool_end') {
            const i = blocks.findLastIndex(b => b.type === 'tool_use' && b.name === rest.name && !b.done);
            if (i >= 0) blocks[i] = { ...blocks[i], done: true };
          } else if (rest.type === 'text_delta') {
            const lastBlock = blocks[blocks.length - 1];
            if (lastBlock?.type === 'text') {
              blocks[blocks.length - 1] = { ...lastBlock, content: lastBlock.content + rest.text };
            } else {
              blocks.push({ type: 'text', content: rest.text });
            }
          } else if (rest.type === 'error') {
            blocks.push({ type: 'text', content: `\n\n**Error:** ${rest.message}` });
          }

          return { ...chat, messages: [...msgs.slice(0, -1), { ...last, blocks }] };
        }),
      })));
    });

    // Done — shared by simple and agentic streaming
    window.api.onDone(async (chatId: string) => {
      const interrupted = wasInterruptedChatIds.current.has(chatId);
      wasInterruptedChatIds.current.delete(chatId);
      stopStreamingChat(chatId);
      setWorkspaces(prev => prev.map(ws => ({
        ...ws,
        chats: ws.chats.map(chat => {
          if (chat.id !== chatId) return chat;
          const msgs = chat.messages;
          const last = msgs[msgs.length - 1];
          if (!last?.streaming) return chat;
          const summary = computeSummary(last.blocks ?? []);
          return { ...chat, messages: [...msgs.slice(0, -1), { ...last, streaming: false, interrupted: interrupted || undefined, summary: summary || undefined }] };
        }),
      })));

      if (treeDirtyRef.current) {
        treeDirtyRef.current = false;
        const wsId = activeWorkspaceIdRef.current;
        const ws = workspacesRef.current.find(w => w.id === wsId);
        if (ws?.projectRoot) {
          window.api.getFileTree(ws.projectRoot).then(tree => {
            setWorkspaces(p => p.map(w => w.id === wsId ? { ...w, files: tree } : w));
          }).catch(() => {});
        }
      }
    });

    return () => window.api.offStreaming();
  }, []);

  // ── KODA CEO events ────────────────────────────────────────────────────────

  useEffect(() => {
    window.api.koda.onChats(({ workspaceId, chats }) => {
      setWorkspaces(prev => prev.map(ws => {
        if (ws.id !== workspaceId) return ws;
        const kodaChats: ChatSession[] = chats.map(c => ({
          id: c.chatId,
          title: c.title,
          model: c.model,
          messages: [],
          isExpanded: false,
          pendingDiff: null,
          editLoading: false,
          pendingEditFile: null,
        }));
        // Remove chats from previous KODA runs, add new ones, switch to chat mode
        const nonKodaChats = ws.chats.filter(c => !c.id.startsWith('koda-'));
        return { ...ws, mode: 'chat' as const, chats: [...nonKodaChats, ...kodaChats] };
      }));
    });

    window.api.koda.onProgress(({ workspaceId, event }) => {
      const ev = event as KodaProgressEvent;

      // step_start needs to update both koda state AND workspace chats — keep them separate
      if (ev.type === 'step_start') {
        const chatId        = (ev as any).chatId        as string | undefined;
        const resolvedModel = (ev as any).resolvedModel as string | undefined;

        setKodaStates(prev => {
          const cur = prev[workspaceId] ?? { ...EMPTY_KODA_STATE };
          const steps = [...cur.steps];
          steps[ev.index] = { ...steps[ev.index], status: 'running', chatId, resolvedModel };
          return { ...prev, [workspaceId]: { ...cur, steps } };
        });

        if (chatId) {
          streamingChatIdsRef.current.add(chatId);
          setStreamingChatIds(Array.from(streamingChatIdsRef.current));
          setWorkspaces(wsPrev => wsPrev.map(ws => {
            if (ws.id !== workspaceId) return ws;
            // Only add messages if the chat doesn't already have a streaming message
            const chat = ws.chats.find(c => c.id === chatId);
            if (chat?.messages.some(m => m.streaming)) return ws;
            return {
              ...ws,
              chats: ws.chats.map(c => {
                if (c.id === chatId) {
                  return {
                    ...c,
                    isExpanded: true,
                    messages: [
                      ...c.messages,
                      { id: uid(), role: 'user' as const, content: ev.step.description },
                      { id: uid(), role: 'assistant' as const, content: '', blocks: [], streaming: true },
                    ],
                  };
                }
                if (c.id.startsWith('koda-')) return { ...c, isExpanded: false };
                return c;
              }),
            };
          }));
        }
        return;
      }

      setKodaStates(prev => {
        const cur = prev[workspaceId] ?? { ...EMPTY_KODA_STATE };
        if (ev.type === 'plan') {
          return {
            ...prev,
            [workspaceId]: {
              ...cur,
              planning: false,
              plan: ev.plan,
              steps: ev.plan.steps.map(step => ({ step, status: 'pending' as const })),
            },
          };
        }
        if (ev.type === 'step_done') {
          const steps = [...cur.steps];
          steps[ev.index] = { ...steps[ev.index], status: 'done', result: ev.result };
          return { ...prev, [workspaceId]: { ...cur, steps } };
        }
        if (ev.type === 'step_error') {
          const steps = [...cur.steps];
          steps[ev.index] = { ...steps[ev.index], status: 'error', error: ev.error };
          return { ...prev, [workspaceId]: { ...cur, steps } };
        }
        if (ev.type === 'done') {
          return { ...prev, [workspaceId]: { ...cur, summary: ev.summary } };
        }
        return prev;
      });
    });

    window.api.koda.onDone(({ workspaceId, error }) => {
      setKodaStates(prev => {
        const cur = prev[workspaceId] ?? EMPTY_KODA_STATE;
        const next = { ...cur, running: false, planning: false, error: error ?? null };

        // Persist history entry if we have a completed task
        if (!error && cur.pendingTask && cur.summary) {
          const ws = workspacesRef.current.find(w => w.id === workspaceId);
          if (ws?.projectRoot) {
            const entry: KodaHistoryEntry = {
              id: String(Date.now()),
              timestamp: new Date().toISOString(),
              task: cur.pendingTask,
              complexity: cur.plan?.complexity,
              steps: cur.steps.map(s => ({
                agent: s.step.agent,
                description: s.step.description,
                result: s.result,
                error: s.error,
              })),
              summary: cur.summary,
            };
            window.api.koda.saveHistory(ws.projectRoot, entry).catch(() => {});
            setKodaHistories(h => ({
              ...h,
              [workspaceId]: [entry, ...(h[workspaceId] ?? [])].slice(0, 100),
            }));
          }
        }

        return { ...prev, [workspaceId]: next };
      });
      // Return to KodaPanel view after execution finishes
      setWorkspaces(prev => prev.map(ws =>
        ws.id === workspaceId ? { ...ws, mode: 'koda' as const } : ws
      ));
    });

    return () => window.api.koda.off();
  }, []);

  function updateWorkspace(id: string, updater: (ws: Workspace) => Workspace) {
    setWorkspaces(prev => prev.map(ws => ws.id === id ? updater(ws) : ws));
  }

  // ── KODA mode + actions ────────────────────────────────────────────────────

  const runningWorkspaceIds = useMemo(
    () => new Set(Object.entries(kodaStates).filter(([, s]) => s.running).map(([id]) => id)),
    [kodaStates],
  );

  function toggleKodaMode() {
    setWorkspaces(prev => prev.map(ws =>
      ws.id === activeWorkspaceId
        ? { ...ws, mode: (ws.mode === 'koda' ? 'chat' : 'koda') as 'chat' | 'koda' }
        : ws
    ));
  }

  async function handleKodaRun(task: string) {
    const ws = getActiveWorkspace();
    if (!ws?.projectRoot) return;
    setKodaStates(prev => ({
      ...prev,
      [ws.id]: { ...EMPTY_KODA_STATE, planning: true, pendingTask: task },
    }));
    const result = await window.api.koda.plan(ws.projectRoot, task, undefined, loadSettings());
    if (result.error || !result.plan) {
      setKodaStates(prev => ({
        ...prev,
        [ws.id]: { ...EMPTY_KODA_STATE, error: result.error ?? 'Could not generate a plan.' },
      }));
      return;
    }
    const plan = result.plan as import('./components/KodaPanel').CeoPlan;
    setKodaStates(prev => ({
      ...prev,
      [ws.id]: {
        ...EMPTY_KODA_STATE,
        confirming: true,
        pendingTask: task,
        plan,
        steps: plan.steps.map((step: import('./components/KodaPanel').CeoStep) => ({ step, status: 'pending' as const })),
      },
    }));
  }

  function handleKodaConfirm() {
    const ws = getActiveWorkspace();
    if (!ws?.projectRoot) return;
    const state = kodaStates[ws.id];
    if (!state?.plan || !state.pendingTask) return;
    setKodaStates(prev => ({
      ...prev,
      [ws.id]: { ...state, confirming: false, running: true },
    }));
    window.api.koda.run(ws.id, ws.projectRoot, state.pendingTask, state.plan, undefined, loadSettings());
  }

  function handleKodaCancel() {
    const ws = getActiveWorkspace();
    if (!ws) return;
    setKodaStates(prev => ({ ...prev, [ws.id]: EMPTY_KODA_STATE }));
  }

  function handleKodaStop() {
    const ws = getActiveWorkspace();
    if (!ws) return;
    window.api.koda.stop(ws.id);
    setKodaStates(prev => ({
      ...prev,
      [ws.id]: { ...(prev[ws.id] ?? EMPTY_KODA_STATE), running: false, planning: false, confirming: false },
    }));
  }

  function getActiveWorkspace() {
    return workspaces.find(ws => ws.id === activeWorkspaceId) ?? null;
  }

  const selectFile = useCallback((filePath: string) => {
    setWorkspaces(prev => prev.map(ws => {
      if (ws.id !== activeWorkspaceId) return ws;
      const tabs = ws.openTabs ?? [];
      const openTabs = tabs.includes(filePath) ? tabs : [...tabs, filePath];
      return { ...ws, selectedFilePath: filePath, openTabs };
    }));
  }, [activeWorkspaceId]);

  const closeTab = useCallback((filePath: string) => {
    setWorkspaces(prev => prev.map(ws => {
      if (ws.id !== activeWorkspaceId) return ws;
      const openTabs = (ws.openTabs ?? []).filter(p => p !== filePath);
      const selectedFilePath =
        ws.selectedFilePath === filePath
          ? (openTabs[openTabs.length - 1] ?? null)
          : ws.selectedFilePath;
      return { ...ws, openTabs, selectedFilePath };
    }));
  }, [activeWorkspaceId]);

  // ── workspace ops ──────────────────────────────────────────────────────────

  const addWorkspace = useCallback(() => {
    const ws = newWorkspace(`Workspace ${workspaces.length + 1}`);
    setWorkspaces(prev => [...prev, ws]);
    setActiveWorkspaceId(ws.id);
  }, [workspaces.length]);

  const closeWorkspace = useCallback((id: string) => {
    setWorkspaces(prev => {
      if (prev.length <= 1) return prev;
      const idx = prev.findIndex(w => w.id === id);
      const ws = prev[idx];
      if (ws?.projectRoot) window.api.unwatchProject(ws.projectRoot).catch(() => {});
      const next = prev.filter(w => w.id !== id);
      setActiveWorkspaceId(cur => {
        if (cur !== id) return cur;
        return (next[idx] ?? next[idx - 1] ?? next[0]).id;
      });
      return next;
    });
    setKodaStates(prev => { const n = { ...prev }; delete n[id]; return n; });
    setKodaHistories(prev => { const n = { ...prev }; delete n[id]; return n; });
  }, []);

  const openProject = useCallback(async () => {
    const folder = await window.api.openProject();
    if (!folder) return;
    const [tree, savedChats] = await Promise.all([
      window.api.getFileTree(folder),
      window.api.loadChats(folder),
    ]);
    const name = folder.split('/').pop() ?? 'Project';
    setWorkspaces(prev => prev.map(ws => {
      if (ws.id !== activeWorkspaceId) return ws;
      const chats = savedChats && savedChats.length > 0
        ? sanitizeChats(savedChats)
        : (ws.chats.length > 0 ? ws.chats : [newChat()]);
      return { ...ws, name, projectRoot: folder, files: tree, chats };
    }));
    window.api.watchProject(folder).catch(() => {});
  }, [activeWorkspaceId]);

  const reloadFileTree = useCallback(async (root?: string | null) => {
    const folder = root ?? workspacesRef.current.find(w => w.id === activeWorkspaceId)?.projectRoot;
    if (!folder) return;
    const tree = await window.api.getFileTree(folder);
    setWorkspaces(prev => prev.map(ws => ws.projectRoot === folder ? { ...ws, files: tree } : ws));
  }, [activeWorkspaceId]);

  // Auto-refresh file tree when main process detects fs changes
  useEffect(() => {
    window.api.onFilesChanged((root) => { reloadFileTree(root); });
  }, [reloadFileTree]);

  // ── chat ops ───────────────────────────────────────────────────────────────

  const addChat = useCallback(() => {
    setWorkspaces(prev => prev.map(ws =>
      ws.id === activeWorkspaceId ? { ...ws, chats: [...ws.chats, newChat()] } : ws
    ));
  }, [activeWorkspaceId]);

  const deleteChat = useCallback((chatId: string) => {
    setWorkspaces(prev => prev.map(ws => {
      if (ws.id !== activeWorkspaceId) return ws;
      const filtered = ws.chats.filter(c => c.id !== chatId);
      return { ...ws, chats: filtered.length ? filtered : [newChat()] };
    }));
  }, [activeWorkspaceId]);

  const toggleChatExpanded = useCallback((chatId: string) => {
    setWorkspaces(prev => prev.map(ws =>
      ws.id !== activeWorkspaceId ? ws : {
        ...ws,
        chats: ws.chats.map(c => c.id === chatId ? { ...c, isExpanded: !c.isExpanded } : c),
      }
    ));
  }, [activeWorkspaceId]);

  const setChatModel = useCallback((chatId: string, model: string) => {
    setWorkspaces(prev => prev.map(ws =>
      ws.id !== activeWorkspaceId ? ws : {
        ...ws,
        chats: ws.chats.map(c => c.id === chatId ? { ...c, model } : c),
      }
    ));
  }, [activeWorkspaceId]);

  async function sendMessage(chatId: string, text: string, mode: 'chat' | 'ask') {
    const ws = getActiveWorkspace();
    if (!ws?.projectRoot || streamingChatIdsRef.current.has(chatId)) return;

    const chat = ws.chats.find(c => c.id === chatId);
    const model = chat?.model ?? '';
    const settings = loadSettings();

    // Resolve agent: prefix → find AgentConfig + its provider
    const isAgentModel = model.startsWith('agent:');
    const agentConfig = isAgentModel
      ? settings.agents.find(a => `agent:${a.name}` === model)
      : null;
    const resolvedModel = agentConfig?.model ?? model;

    // Find provider for the resolved model
    const matchingProvider = settings.providers.find(
      p => p.enabled && p.apiKey && p.models.split(',').map(m => m.trim()).includes(resolvedModel)
    );
    const useAgentic = !!matchingProvider;

    setWorkspaces(prev => prev.map(w =>
      w.id !== activeWorkspaceId ? w : {
        ...w,
        chats: w.chats.map(c => {
          if (c.id !== chatId) return c;
          const title = c.messages.length === 0 ? text.slice(0, 40) : c.title;
          return {
            ...c,
            title,
            messages: [
              ...c.messages,
              { id: uid(), role: 'user', content: text },
              { id: uid(), role: 'assistant', content: '', blocks: useAgentic ? [] : undefined, streaming: true },
            ],
          };
        }),
      }
    ));

    startStreaming(chatId);
    if (useAgentic) {
      let resolvedApiKey = matchingProvider!.apiKey;
      let useOAuth = false;

      if (matchingProvider!.id === 'github-copilot') {
        const token = await (window.api as any).copilot.getToken().catch(() => null);
        resolvedApiKey = token ?? resolvedApiKey;
      } else if (matchingProvider!.id === 'claude-code') {
        const token = await (window.api as any).claudeCode.getToken().catch(() => null);
        resolvedApiKey = token ?? resolvedApiKey;
        useOAuth = true;
      }

      window.api.chatAgentic(ws.projectRoot, chatId, text, {
        apiKey: resolvedApiKey,
        baseUrl: matchingProvider!.baseUrl,
        model: resolvedModel,
        isAnthropic: matchingProvider!.id === 'anthropic',
        useOAuth,
        systemPrompt: agentConfig?.systemPrompt || undefined,
      });
    } else if (mode === 'chat') {
      window.api.chat(ws.projectRoot, chatId, text);
    } else {
      window.api.ask(ws.projectRoot, chatId, text);
    }
  }

  // ── file actions ───────────────────────────────────────────────────────────

  function handleFileAction(action: 'explain' | 'review' | 'edit', filePath: string) {
    const ws = getActiveWorkspace();
    if (!ws?.projectRoot) return;

    const targetChat = ws.chats.find(c => c.isExpanded) ?? ws.chats[ws.chats.length - 1];
    const chatId = targetChat.id;
    const shortName = filePath.split('/').pop() ?? filePath;

    if (action === 'edit') {
      updateWorkspace(activeWorkspaceId, w => ({
        ...w,
        chats: w.chats.map(c => c.id === chatId ? { ...c, isExpanded: true, pendingEditFile: { filePath } } : c),
      }));
      return;
    }

    const userText = action === 'explain' ? `Explain: ${shortName}` : `Review: ${shortName}`;
    updateWorkspace(activeWorkspaceId, w => ({
      ...w,
      chats: w.chats.map(c => {
        if (c.id !== chatId) return c;
        return {
          ...c,
          isExpanded: true,
          messages: [
            ...c.messages,
            { id: uid(), role: 'user', content: userText },
            { id: uid(), role: 'assistant', content: '', streaming: true },
          ],
        };
      }),
    }));

    startStreaming(chatId);
    if (action === 'explain') window.api.explain(ws.projectRoot, chatId, filePath);
    else window.api.review(ws.projectRoot, chatId, filePath);
  }

  async function handleEditInstruction(chatId: string, instruction: string) {
    const ws = getActiveWorkspace();
    const chat = ws?.chats.find(c => c.id === chatId);
    if (!chat?.pendingEditFile || !ws?.projectRoot) return;

    const { filePath } = chat.pendingEditFile;

    updateWorkspace(activeWorkspaceId, w => ({
      ...w,
      chats: w.chats.map(c => c.id !== chatId ? c : {
        ...c,
        pendingEditFile: null,
        editLoading: true,
        messages: [...c.messages, { id: uid(), role: 'user', content: `Edit ${filePath.split('/').pop()}: ${instruction}` }],
      }),
    }));

    const result = await window.api.editRequest(ws.projectRoot, filePath, instruction);

    updateWorkspace(activeWorkspaceId, w => ({
      ...w,
      chats: w.chats.map(c => {
        if (c.id !== chatId) return c;
        if (result.error || !result.original || !result.modified) {
          return {
            ...c,
            editLoading: false,
            messages: [...c.messages, { id: uid(), role: 'assistant', content: `Could not generate edit: ${result.error ?? 'no code block'}` }],
          };
        }
        return { ...c, editLoading: false, pendingDiff: { filePath, original: result.original, modified: result.modified } };
      }),
    }));
  }

  async function handleAcceptDiff(chatId: string) {
    const ws = getActiveWorkspace();
    const chat = ws?.chats.find(c => c.id === chatId);
    if (!chat?.pendingDiff) return;

    const diff = chat.pendingDiff;
    const res = await window.api.applyEdit(diff.filePath, diff.modified);

    updateWorkspace(activeWorkspaceId, w => ({
      ...w,
      chats: w.chats.map(c => c.id !== chatId ? c : {
        ...c,
        pendingDiff: null,
        messages: [...c.messages, {
          id: uid(),
          role: 'assistant',
          content: res.error ? `Error: ${res.error}` : `✓ Applied changes to ${diff.filePath.split('/').pop()}`,
        }],
      }),
    }));
  }

  function rejectDiff(chatId: string) {
    updateWorkspace(activeWorkspaceId, w => ({
      ...w,
      chats: w.chats.map(c => c.id !== chatId ? c : { ...c, pendingDiff: null }),
    }));
  }

  const activeWorkspace = getActiveWorkspace();
  const activeDiffChat = activeWorkspace?.chats.find(c => c.pendingDiff);

  const isKodaMode = activeWorkspace?.mode === 'koda';
  const activeKodaState   = kodaStates[activeWorkspaceId] ?? EMPTY_KODA_STATE;
  const activeKodaHistory = kodaHistories[activeWorkspaceId] ?? [];

  return (
    <div className="app">
      <WorkspaceRail
        workspaces={workspaces}
        activeId={activeWorkspaceId}
        activeMode={activeWorkspace?.mode ?? 'chat'}
        runningWorkspaceIds={runningWorkspaceIds}
        onSelect={setActiveWorkspaceId}
        onClose={closeWorkspace}
        onAdd={addWorkspace}
        onToggleKoda={toggleKodaMode}
        onOpenSettings={() => setShowSettings(true)}
      />

      {!activeWorkspace?.projectRoot ? (
        <ProjectSetup
          workspaceName={activeWorkspace?.name ?? 'Workspace'}
          onOpenProject={openProject}
        />
      ) : (
        <>
          <div className="chats-panel-wrap" style={{ width: chatsPanelWidth }}>
            {isKodaMode ? (
              <KodaPanel
                workspaceId={activeWorkspaceId}
                projectRoot={activeWorkspace.projectRoot}
                kodaState={activeKodaState}
                history={activeKodaHistory}
                onRun={handleKodaRun}
                onConfirm={handleKodaConfirm}
                onCancel={handleKodaCancel}
                onStop={handleKodaStop}
              />
            ) : (
              <ChatsPanel
                workspace={activeWorkspace}
                streamingChatIds={streamingChatIds}
                onOpenProject={openProject}
                onAddChat={addChat}
                onDeleteChat={deleteChat}
                onToggleExpand={toggleChatExpanded}
                onSetModel={setChatModel}
                onSendMessage={sendMessage}
                onEditInstruction={handleEditInstruction}
                onStop={(chatId: string) => { wasInterruptedChatIds.current.add(chatId); window.api.stopStreaming(chatId); }}
              />
            )}
          </div>

          <div className="resize-handle" onMouseDown={handleResizeStart} />

          <MemoRightPanel
            workspace={activeWorkspace}
            onFileAction={handleFileAction}
            onOpenProject={openProject}
            onSelectFile={selectFile}
            onCloseTab={closeTab}
            onReloadTree={reloadFileTree}
          />
        </>
      )}

      {activeDiffChat?.pendingDiff && (
        <DiffModal
          filePath={activeDiffChat.pendingDiff.filePath}
          original={activeDiffChat.pendingDiff.original}
          modified={activeDiffChat.pendingDiff.modified}
          onAccept={() => handleAcceptDiff(activeDiffChat.id)}
          onReject={() => rejectDiff(activeDiffChat.id)}
        />
      )}

      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
