import React, { useState, useRef, useEffect } from 'react';
import { X, Plus } from 'lucide-react';
import { Workspace, ChatSession, Message, ContentBlock } from '../App';
import { loadSettings } from './SettingsModal';

interface PanelProps {
  workspace: Workspace | null;
  streamingChatIds: string[];
  onOpenProject: () => void;
  onAddChat: () => void;
  onDeleteChat: (chatId: string) => void;
  onToggleExpand: (chatId: string) => void;
  onSetModel: (chatId: string, model: string) => void;
  onSendMessage: (chatId: string, text: string, mode: 'chat' | 'ask') => void;
  onEditInstruction: (chatId: string, instruction: string) => void;
  onStop: (chatId: string) => void;
}

interface CardProps {
  chat: ChatSession;
  isStreaming: boolean;
  projectRoot: string | null;
  models: string[];
  onDelete: () => void;
  onToggle: () => void;
  onSetModel: (model: string) => void;
  onSend: (text: string, mode: 'chat' | 'ask') => void;
  onEditInstruction: (instruction: string) => void;
  onStop: () => void;
}

// ── syntax highlighter ────────────────────────────────────────────────────────

type HToken = { start: number; end: number; cls: string };

const HL_PATTERNS: Array<[RegExp, string]> = [
  // comments first (protect from other patterns)
  [/(\/\/[^\n]*)/g,           'hl-comment'],
  [/(\/\*[\s\S]*?\*\/)/g,     'hl-comment'],
  [/(#[^\n]*)/g,              'hl-comment'],
  // strings
  [/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g, 'hl-string'],
  // numbers
  [/\b(\d+\.?\d*(?:[eE][+-]?\d+)?)\b/g, 'hl-number'],
  // keywords
  [/\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|class|new|this|super|extends|implements|import|export|default|from|async|await|try|catch|finally|throw|typeof|instanceof|void|delete|in|of|yield|get|set|static|public|private|protected|readonly|override|abstract|interface|type|enum|namespace|module|declare|as|satisfies)\b/g, 'hl-keyword'],
  [/\b(def|class|import|from|return|if|elif|else|for|while|in|not|and|or|pass|break|continue|raise|try|except|finally|with|as|lambda|yield|global|nonlocal|async|await)\b/g, 'hl-keyword'],
  [/\b(func|package|import|var|const|type|struct|interface|map|chan|go|select|case|default|defer|fallthrough|range|return|break|continue|goto|if|else|for|switch)\b/g, 'hl-keyword'],
  // booleans / null
  [/\b(true|false|null|undefined|nil|None|True|False|NaN|Infinity)\b/g, 'hl-builtin'],
  // function names (word before open paren)
  [/\b([a-zA-Z_]\w*)\s*(?=\()/g, 'hl-fn'],
  // types / capitalized identifiers
  [/\b([A-Z][a-zA-Z0-9_]*)\b/g, 'hl-type'],
];

function highlightCode(raw: string): string {
  // 1. HTML-escape the raw code
  const esc = raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // 2. Collect non-overlapping tokens
  const tokens: HToken[] = [];
  for (const [re, cls] of HL_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(esc)) !== null) {
      tokens.push({ start: m.index, end: m.index + m[0].length, cls });
    }
  }
  tokens.sort((a, b) => a.start - b.start || b.end - a.end);

  const kept: HToken[] = [];
  let cursor = 0;
  for (const t of tokens) {
    if (t.start >= cursor) { kept.push(t); cursor = t.end; }
  }

  // 3. Build highlighted HTML
  let out = '';
  let pos = 0;
  for (const t of kept) {
    out += esc.slice(pos, t.start);
    out += `<span class="${t.cls}">${esc.slice(t.start, t.end)}</span>`;
    pos = t.end;
  }
  return out + esc.slice(pos);
}

// ── image detection ───────────────────────────────────────────────────────────

// Returns a data-URI src if the string is (or looks like) a base64 image,
// otherwise returns null.
function detectBase64Image(s: string, lang?: string): string | null {
  const t = s.trim();
  if (!t) return null;

  // Already a full data URI (with or without wrapping whitespace)
  if (t.startsWith('data:image/')) return t;

  // Detect well-known base64 magic bytes
  if (t.startsWith('iVBORw0KGgo')) return `data:image/png;base64,${t}`;
  if (t.startsWith('/9j/'))        return `data:image/jpeg;base64,${t}`;
  if (t.startsWith('R0lGOD'))      return `data:image/gif;base64,${t}`;
  if (t.startsWith('UklGR'))       return `data:image/webp;base64,${t}`;
  if (t.startsWith('AAAAFGZ0'))    return `data:image/mp4;base64,${t}`;

  // Lang hint in fenced code block (```png, ```jpeg, ```image …)
  const imgLangs = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'image', 'img'];
  if (lang && imgLangs.includes(lang.toLowerCase())) {
    const mime = lang === 'jpg' ? 'jpeg' : lang === 'img' || lang === 'image' ? 'png' : lang;
    return `data:image/${mime};base64,${t}`;
  }

  return null;
}

// ── content renderer ──────────────────────────────────────────────────────────

// Split on fenced code blocks AND standalone markdown images
const BLOCK_RE = /(```[\w]*\n[\s\S]*?```|!\[[^\]]*\]\([^)]{4,}\))/g;

function renderContent(text: string) {
  const parts = text.split(BLOCK_RE);
  return parts.map((part, i) => {
    // ── fenced code block ────────────────────────────────────────────────────
    if (part.startsWith('```')) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/);
      const lang = match?.[1] ?? '';
      const code = (match ? match[2] : part.slice(3)).trimEnd();

      const imgSrc = detectBase64Image(code, lang || undefined);
      if (imgSrc) {
        return <img key={i} src={imgSrc} alt="image" className="msg-image" />;
      }

      return (
        <pre key={i} data-lang={lang || undefined}>
          {lang && <span className="code-lang-badge">{lang}</span>}
          <code dangerouslySetInnerHTML={{ __html: highlightCode(code) }} />
        </pre>
      );
    }

    // ── standalone markdown image ─────────────────────────────────────────────
    if (part.startsWith('![')) {
      const m = part.match(/!\[([^\]]*)\]\(([^)]+)\)/);
      if (m) return <img key={i} src={m[2]} alt={m[1]} className="msg-image" />;
    }

    // ── regular text ──────────────────────────────────────────────────────────
    const lines = part.split('\n');
    return (
      <React.Fragment key={i}>
        {lines.map((line, j) => {
          const trimmed = line.trim();

          // Raw data URI on its own line → image
          const rawImg = detectBase64Image(trimmed);
          if (rawImg) return <img key={j} src={rawImg} alt="image" className="msg-image" />;

          if (line.startsWith('# '))   return <h1 key={j}>{line.slice(2)}</h1>;
          if (line.startsWith('## '))  return <h2 key={j}>{line.slice(3)}</h2>;
          if (line.startsWith('### ')) return <h3 key={j}>{line.slice(4)}</h3>;
          if (line.startsWith('#### ')) return <h4 key={j}>{line.slice(5)}</h4>;
          if (line.startsWith('- ') || line.startsWith('* ') || line.startsWith('• '))
            return <li key={j} dangerouslySetInnerHTML={{ __html: fmt(line.replace(/^[-*•] /, '')) }} />;
          if (/^\d+\. /.test(line))
            return <li key={j} dangerouslySetInnerHTML={{ __html: fmt(line.replace(/^\d+\. /, '')) }} />;
          if (trimmed === '') return j === 0 ? null : <br key={j} />;
          return <p key={j} dangerouslySetInnerHTML={{ __html: fmt(line) }} />;
        })}
      </React.Fragment>
    );
  });
}

function fmt(text: string): string {
  return text
    // inline markdown images → <img>
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="msg-image" loading="lazy" />')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// ── agentic block renderers ───────────────────────────────────────────────────

const TOOL_META: Record<string, { verb: string; color: string }> = {
  read_file:       { verb: 'Read',   color: 'var(--yellow)' },
  read_file_lines: { verb: 'Read',   color: 'var(--yellow)' },
  write_file:      { verb: 'Write',  color: 'var(--green)'  },
  list_dir:        { verb: 'List',   color: 'var(--cyan)'   },
  search_files:    { verb: 'Search', color: 'var(--purple)' },
  bash:            { verb: 'Run',    color: 'var(--orange)'  },
};

const FILE_TOOLS = new Set(['read_file', 'read_file_lines', 'write_file', 'list_dir']);

function shortenLabel(rest: string, toolName: string | undefined, projectRoot: string | null): string {
  if (!rest) return rest;

  // For bash and search: keep as-is (no path to extract)
  if (!FILE_TOOLS.has(toolName ?? '')) return rest;

  // Split off optional line-range suffix like " :10–50"
  const lineMatch = rest.match(/^(.+?)\s+(:\d+[–\-]\d+)$/);
  const pathPart = lineMatch ? lineMatch[1] : rest;
  const lineSuffix = lineMatch ? ' ' + lineMatch[2] : '';

  // Strip project root prefix
  let rel = pathPart;
  if (projectRoot) {
    const base = projectRoot.endsWith('/') ? projectRoot : projectRoot + '/';
    rel = pathPart.replace(base, '').replace(projectRoot, '') || pathPart;
  }

  // Keep only the basename
  const basename = rel.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? rel;
  return basename + lineSuffix;
}

function ThinkingBlock({ content, elapsed, streaming }: { content: string; elapsed?: number; streaming?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="thinking-block">
      {streaming ? (
        <div className="thinking-status">
          <span className="thinking-pulse" />
          <span className="thinking-status-text">Thinking…</span>
        </div>
      ) : (
        <button className="thinking-toggle" onClick={() => setOpen(v => !v)}>
          <span className="thinking-done-dot" />
          Thought for {elapsed ?? 0}s
          <span className="thinking-chevron">{open ? '▾' : '▸'}</span>
        </button>
      )}
      {open && !streaming && content && (
        <div className="thinking-content">{content}</div>
      )}
    </div>
  );
}

function renderBlocks(blocks: ContentBlock[], msgStreaming?: boolean, projectRoot?: string | null) {
  return blocks.map((block, i) => {
    if (block.type === 'thinking') {
      return <ThinkingBlock key={i} content={block.content} elapsed={block.elapsed} streaming={block.streaming} />;
    }
    if (block.type === 'tool_use') {
      const meta = TOOL_META[block.name ?? ''];
      const color = meta?.color ?? 'var(--text-dim)';
      const rawLabel = block.label ?? block.name ?? '';
      // Separate verb from path: label is like "Read /full/path" or "Search "pattern""
      const spaceIdx = rawLabel.indexOf(' ');
      const verb = spaceIdx >= 0 ? rawLabel.slice(0, spaceIdx) : rawLabel;
      const rest = spaceIdx >= 0 ? rawLabel.slice(spaceIdx + 1) : '';
      const shortRest = shortenLabel(rest, block.name, projectRoot ?? null);
      return (
        <div key={i} className={`tool-use-block ${block.done ? 'done' : 'running'}`}>
          <span className="tool-verb" style={{ color }}>{verb}</span>
          {shortRest && <span className="tool-path">{shortRest}</span>}
          {!block.done && <span className="tool-spinner-inline" style={{ borderTopColor: color }} />}
        </div>
      );
    }
    if (block.type === 'text') {
      const isLast = i === blocks.length - 1;
      return (
        <div key={i} className="text-block">
          {renderContent(block.content)}
          {isLast && msgStreaming && <span className="cursor" />}
        </div>
      );
    }
    return null;
  });
}

// ── chat card ─────────────────────────────────────────────────────────────────

function ChatCard({ chat, isStreaming, projectRoot, models, onDelete, onToggle, onSetModel, onSend, onEditInstruction, onStop }: CardProps) {
  const [mode, setMode] = useState<'chat' | 'ask'>('chat');
  const [showModels, setShowModels] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (chat.isExpanded) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat.messages, chat.isExpanded]);

  function submit() {
    const val = textareaRef.current?.value.trim();
    if (!val || isStreaming || !projectRoot) return;
    textareaRef.current!.value = '';
    (textareaRef.current as HTMLTextAreaElement).style.height = 'auto';
    onSend(val, mode);
  }

  return (
    <div className={`chat-card ${chat.isExpanded ? 'expanded' : ''}`}>
      {/* header */}
      <div className="chat-card-header" onClick={onToggle}>
        <span className="chat-card-arrow">{chat.isExpanded ? '▾' : '▸'}</span>
        <span className="chat-card-title">{chat.title}</span>
        <div className="chat-card-right" onClick={e => e.stopPropagation()}>
          <div className="model-selector">
            <button
              className="model-badge"
              onClick={() => setShowModels(v => !v)}
            >
              {chat.model.startsWith('agent:')
                ? `@ ${chat.model.slice(6)}`
                : chat.model.split('-').slice(0, 2).join('-')} ▾
            </button>
            {showModels && (
              <div className="model-dropdown">
                {models.map(m => (
                  <button
                    key={m}
                    className={`model-option ${m === chat.model ? 'active' : ''}`}
                    onClick={() => { onSetModel(m); setShowModels(false); }}
                  >
                    {m.startsWith('agent:') ? `@ ${m.slice(6)}` : m}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="chat-close-btn" onClick={onDelete} title="Close chat"><X size={12} strokeWidth={2.5} /></button>
        </div>
      </div>

      {/* body — only when expanded */}
      {chat.isExpanded && (
        <>
          <div className="chat-messages">
            {chat.messages.length === 0 && (
              <div className="chat-empty">
                {projectRoot ? 'Start chatting with your codebase…' : 'Open a project folder first'}
              </div>
            )}
            {chat.messages.map((msg: Message) => (
              <div key={msg.id} className="message">
                <div className={`message-header ${msg.role}`}>
                  {msg.role === 'user' ? 'You' : 'AI'}
                </div>
                <div className={`message-body ${msg.role}`}>
                  {msg.blocks
                    ? (msg.blocks.length === 0 && msg.streaming
                        ? <div className="thinking-status"><span className="thinking-pulse" /><span className="thinking-status-text">Iniciando…</span></div>
                        : renderBlocks(msg.blocks, msg.streaming, projectRoot))
                    : <>{renderContent(msg.content)}{msg.streaming && <span className="cursor" />}</>
                  }
                  {msg.interrupted && (
                    <div className="msg-interrupted">⏹ Interrompido</div>
                  )}
                  {msg.summary && !msg.streaming && (
                    <div className="msg-summary">
                      {msg.summary.text && <p className="msg-summary-text">{msg.summary.text}</p>}
                      <span className="msg-summary-stats">{msg.summary.stats}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {chat.editLoading && (
              <div className="edit-loading">
                <div className="spinner" /> Generating edit…
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* edit instruction prompt */}
          {chat.pendingEditFile && !chat.editLoading && (
            <div className="edit-prompt">
              <div className="edit-prompt-label">
                Edit: <strong>{chat.pendingEditFile.filePath.split('/').pop()}</strong>
              </div>
              <form
                onSubmit={e => {
                  e.preventDefault();
                  const input = e.currentTarget.querySelector('input') as HTMLInputElement;
                  const v = input.value.trim();
                  if (v) onEditInstruction(v);
                }}
              >
                <div className="edit-prompt-row">
                  <input autoFocus type="text" placeholder="What should I change?" className="edit-input" />
                  <button type="submit" className="send-btn">Go</button>
                </div>
              </form>
            </div>
          )}

          {/* streaming status bar */}
          {isStreaming && (() => {
            const lastMsg = chat.messages[chat.messages.length - 1];
            if (!lastMsg?.streaming) return null;
            let label = 'Trabalhando…';
            if (lastMsg.blocks) {
              const runningTool = [...lastMsg.blocks].reverse().find(b => b.type === 'tool_use' && !b.done);
              if (runningTool) label = runningTool.label ?? runningTool.name ?? label;
              else if (lastMsg.blocks.find(b => b.type === 'thinking' && b.streaming)) label = 'Pensando…';
              else if (lastMsg.blocks.length > 0) label = 'Gerando resposta…';
            }
            return (
              <div className="streaming-status">
                <span className="streaming-status-dot" />
                <span className="streaming-status-text">{label}</span>
              </div>
            );
          })()}

          {/* input area */}
          <div className="chat-input-area">
            <div className="mode-tabs">
              <button className={`mode-tab ${mode === 'chat' ? 'active' : ''}`} onClick={() => setMode('chat')}>
                Chat
              </button>
              <button className={`mode-tab ${mode === 'ask' ? 'active' : ''}`} onClick={() => setMode('ask')}>
                Ask
              </button>
            </div>
            <div className="input-row">
              <textarea
                ref={textareaRef}
                className="input-textarea"
                placeholder={mode === 'chat' ? 'Chat with the codebase…' : 'Ask a one-shot question…'}
                rows={1}
                disabled={isStreaming || !projectRoot}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
                }}
                onInput={e => {
                  const el = e.currentTarget;
                  el.style.height = 'auto';
                  el.style.height = `${Math.min(el.scrollHeight, 100)}px`;
                }}
              />
              {isStreaming ? (
                <button className="stop-btn" onClick={onStop} title="Stop">
                  <span className="stop-icon" />
                </button>
              ) : (
                <button
                  className="send-btn"
                  onClick={submit}
                  disabled={!projectRoot}
                >
                  ↵
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── panel ─────────────────────────────────────────────────────────────────────

export default function ChatsPanel({
  workspace,
  streamingChatIds,
  onOpenProject,
  onAddChat,
  onDeleteChat,
  onToggleExpand,
  onSetModel,
  onSendMessage,
  onEditInstruction,
  onStop,
}: PanelProps) {
  const settings = loadSettings();
  const providerModels = settings.providers
    .filter(p => p.enabled && p.models)
    .flatMap(p => p.models.split(',').map(m => m.trim()).filter(Boolean));
  const agentModels = settings.agents.map(a => `agent:${a.name}`);
  const allModels = [...new Set([...providerModels, ...agentModels])];

  return (
    <div className="chats-panel">
      <div className="chats-panel-header">
        <span className="chats-panel-title">{workspace?.name ?? 'No workspace'}</span>
        <div className="chats-panel-actions">
          {!workspace?.projectRoot && (
            <button className="panel-btn" onClick={onOpenProject}>Open folder</button>
          )}
          <button className="panel-btn primary" onClick={onAddChat}><Plus size={12} strokeWidth={2.5} /> Chat</button>
        </div>
      </div>

      <div className="chats-list">
        {workspace?.chats.map(chat => (
          <ChatCard
            key={chat.id}
            chat={chat}
            isStreaming={streamingChatIds.includes(chat.id)}
            projectRoot={workspace.projectRoot}
            models={allModels}
            onDelete={() => onDeleteChat(chat.id)}
            onToggle={() => onToggleExpand(chat.id)}
            onSetModel={model => onSetModel(chat.id, model)}
            onSend={(text, mode) => onSendMessage(chat.id, text, mode)}
            onEditInstruction={instruction => onEditInstruction(chat.id, instruction)}
            onStop={() => onStop(chat.id)}
          />
        ))}
      </div>
    </div>
  );
}
