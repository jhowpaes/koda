import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('api', {
  // ── project ────────────────────────────────────────────────────────────────
  openProject: () => ipcRenderer.invoke('dialog:openProject'),
  getFileTree: (dir: string) => ipcRenderer.invoke('fs:tree', dir),
  readFile: (filePath: string) => ipcRenderer.invoke('fs:readFile', filePath),
  readFileBinary: (filePath: string) => ipcRenderer.invoke('fs:readBinary', filePath),
  writeFile: (filePath: string, content: string) => ipcRenderer.invoke('fs:writeFile', { filePath, content }),
  loadChats: (projectRoot: string) => ipcRenderer.invoke('fs:loadChats', projectRoot),
  saveChats: (projectRoot: string, chats: unknown[]) => ipcRenderer.invoke('fs:saveChats', { projectRoot, chats }),

  // ── shell runner ───────────────────────────────────────────────────────────
  runShell: (root: string, command: string) => ipcRenderer.send('shell:run', { root, command }),
  killShell: () => ipcRenderer.invoke('shell:kill'),
  onShellOutput: (cb: (data: string, type: string) => void) => {
    ipcRenderer.on('shell:output', (_, data, type) => cb(data, type));
  },
  onShellDone: (cb: (code: number | null) => void) => {
    ipcRenderer.on('shell:done', (_, code) => cb(code));
  },
  offShell: () => {
    ipcRenderer.removeAllListeners('shell:output');
    ipcRenderer.removeAllListeners('shell:done');
  },

  // ── streaming agent ────────────────────────────────────────────────────────
  chat: (root: string, chatId: string, message: string) => ipcRenderer.send('agent:chat', { root, chatId, message }),
  ask: (root: string, chatId: string, message: string) => ipcRenderer.send('agent:ask', { root, chatId, message }),
  explain: (root: string, chatId: string, filePath: string) => ipcRenderer.send('agent:explain', { root, chatId, filePath }),
  review: (root: string, chatId: string, filePath: string) => ipcRenderer.send('agent:review', { root, chatId, filePath }),
  chatAgentic: (root: string, chatId: string, message: string, config: { apiKey: string; baseUrl: string; model: string; isAnthropic: boolean; systemPrompt?: string }) =>
    ipcRenderer.send('agent:chat:agentic', { root, chatId, message, ...config }),
  onChunk: (cb: (chatId: string, chunk: string) => void) => {
    ipcRenderer.on('agent:chunk', (_, chatId, chunk) => cb(chatId, chunk));
  },
  onDone: (cb: (chatId: string) => void) => {
    ipcRenderer.on('agent:done', (_, chatId) => cb(chatId));
  },
  onAgentEvent: (cb: (ev: any) => void) => {
    ipcRenderer.on('agent:event', (_, ev) => cb(ev));
  },
  stopStreaming: (chatId?: string) => ipcRenderer.invoke('agent:stop', chatId),
  offStreaming: () => {
    ipcRenderer.removeAllListeners('agent:chunk');
    ipcRenderer.removeAllListeners('agent:done');
    ipcRenderer.removeAllListeners('agent:event');
  },

  // ── edit ───────────────────────────────────────────────────────────────────
  editRequest: (root: string, filePath: string, instruction: string) =>
    ipcRenderer.invoke('agent:editRequest', { root, filePath, instruction }),
  applyEdit: (filePath: string, content: string) =>
    ipcRenderer.invoke('agent:applyEdit', { filePath, content }),

  // ── koda CEO ──────────────────────────────────────────────────────────────
  koda: {
    plan: (projectRoot: string, task: string, kodaWorkspace?: unknown) =>
      ipcRenderer.invoke('koda:plan', { projectRoot, task, kodaWorkspace }),
    run: (workspaceId: string, projectRoot: string, task: string, plan?: unknown, kodaWorkspace?: unknown, settings?: unknown) =>
      ipcRenderer.send('koda:run', { workspaceId, projectRoot, task, plan, kodaWorkspace, settings }),
    stop: (workspaceId: string) => ipcRenderer.invoke('koda:stop', workspaceId),
    onProgress: (cb: (data: { workspaceId: string; event: unknown }) => void) => {
      ipcRenderer.on('koda:progress', (_, data) => cb(data));
    },
    onDone: (cb: (data: { workspaceId: string; error?: string }) => void) => {
      ipcRenderer.on('koda:done', (_, data) => cb(data));
    },
    onChats: (cb: (data: { workspaceId: string; chats: Array<{ chatId: string; title: string; model: string }> }) => void) => {
      ipcRenderer.on('koda:chats', (_, data) => cb(data));
    },
    off: () => {
      ipcRenderer.removeAllListeners('koda:progress');
      ipcRenderer.removeAllListeners('koda:done');
      ipcRenderer.removeAllListeners('koda:chats');
    },
    tts: (text: string, cfg: unknown) => ipcRenderer.invoke('koda:tts', { text, config: cfg }),
    stt: (audioData: string) => ipcRenderer.invoke('koda:stt', { audioData }),
    spokenSummary: (data: { task: string; steps: unknown[]; kodaWorkspace?: unknown }) =>
      ipcRenderer.invoke('koda:spokenSummary', data),
    getConfig: () => ipcRenderer.invoke('koda:getConfig'),
    saveConfig: (cfg: unknown) => ipcRenderer.invoke('koda:saveConfig', cfg),
    listWorkspaces: () => ipcRenderer.invoke('koda:listWorkspaces'),
    loadHistory: (projectRoot: string) => ipcRenderer.invoke('koda:loadHistory', projectRoot),
    saveHistory: (projectRoot: string, entry: unknown) => ipcRenderer.invoke('koda:saveHistory', { projectRoot, entry }),
  },

  // ── permissions ───────────────────────────────────────────────────────────
  requestMicPermission: () => ipcRenderer.invoke('permissions:microphone'),

  // ── git ────────────────────────────────────────────────────────────────────
  gitDiff: (root: string) => ipcRenderer.invoke('git:diff', root),
  gitCommit: (root: string, message: string) => ipcRenderer.invoke('git:commit', { root, message }),
  generateCommit: (root: string, diff: string) => ipcRenderer.invoke('agent:commit', { root, diff }),
  gitStatus: (root: string) => ipcRenderer.invoke('git:status', root),
  gitFileDiff: (root: string, filePath: string, staged: boolean) =>
    ipcRenderer.invoke('git:fileDiff', { root, filePath, staged }),
  gitStage: (root: string, filePath: string) => ipcRenderer.invoke('git:stage', { root, filePath }),
  gitUnstage: (root: string, filePath: string) => ipcRenderer.invoke('git:unstage', { root, filePath }),
  gitLog: (root: string, limit?: number) => ipcRenderer.invoke('git:log', { root, limit }),
  gitBranch: (root: string) => ipcRenderer.invoke('git:branch', root),
  gitBranches: (root: string) => ipcRenderer.invoke('git:branches', root),
  gitCheckout: (root: string, branch: string) => ipcRenderer.invoke('git:checkout', { root, branch }),
  gitPush: (root: string) => ipcRenderer.invoke('git:push', root),
  gitPull: (root: string) => ipcRenderer.invoke('git:pull', root),
});
