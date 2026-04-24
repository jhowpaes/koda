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
