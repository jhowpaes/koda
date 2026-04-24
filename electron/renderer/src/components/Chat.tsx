import React, { useEffect, useRef } from 'react';

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
}

interface Props {
  messages: Message[];
  isStreaming: boolean;
  mode: 'chat' | 'ask';
  onModeChange: (m: 'chat' | 'ask') => void;
  onSend: (text: string) => void;
  editPending: boolean;
}

function renderContent(text: string) {
  const parts = text.split(/(```[\w]*\n[\s\S]*?```)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```')) {
      const match = part.match(/```(\w*)\n([\s\S]*?)```/);
      const code = match ? match[2] : part.slice(3);
      return <pre key={i}><code>{code}</code></pre>;
    }
    // simple inline formatting
    const lines = part.split('\n');
    return (
      <React.Fragment key={i}>
        {lines.map((line, j) => {
          if (line.startsWith('## ')) return <h2 key={j}>{line.slice(3)}</h2>;
          if (line.startsWith('### ')) return <h3 key={j}>{line.slice(4)}</h3>;
          if (line.startsWith('- ') || line.startsWith('* ')) {
            return <li key={j} dangerouslySetInnerHTML={{ __html: formatInline(line.slice(2)) }} />;
          }
          if (line.trim() === '') return j === 0 ? null : <br key={j} />;
          return <p key={j} dangerouslySetInnerHTML={{ __html: formatInline(line) }} />;
        })}
      </React.Fragment>
    );
  });
}

function formatInline(text: string): string {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

export default function Chat({ messages, isStreaming, mode, onModeChange, onSend, editPending }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  function submit() {
    const val = textareaRef.current?.value.trim();
    if (!val || isStreaming || editPending) return;
    textareaRef.current!.value = '';
    onSend(val);
  }

  const placeholder = mode === 'chat'
    ? 'Chat with the codebase… (Shift+Enter for new line)'
    : 'Ask a one-shot question…';

  return (
    <div className="chat-area">
      <div className="messages">
        {messages.length === 0 && (
          <div style={{ color: 'var(--text-dim)', textAlign: 'center', marginTop: 40 }}>
            Start by asking a question or selecting a file from the sidebar.
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className="message">
            <div className={`message-header ${msg.role}`}>
              {msg.role === 'user' ? 'You' : 'AI'}
            </div>
            <div className={`message-body ${msg.role}`}>
              {renderContent(msg.content)}
              {msg.streaming && <span className="cursor" />}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="input-area">
        <div className="mode-tabs">
          <button className={`mode-tab ${mode === 'chat' ? 'active' : ''}`} onClick={() => onModeChange('chat')}>
            Chat
          </button>
          <button className={`mode-tab ${mode === 'ask' ? 'active' : ''}`} onClick={() => onModeChange('ask')}>
            Ask
          </button>
        </div>
        <div className="input-row">
          <textarea
            ref={textareaRef}
            className="input-textarea"
            placeholder={placeholder}
            rows={1}
            onKeyDown={handleKey}
            onInput={e => {
              const el = e.currentTarget;
              el.style.height = 'auto';
              el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
            }}
            disabled={isStreaming || editPending}
          />
          <button
            className="send-btn"
            onClick={submit}
            disabled={isStreaming || editPending}
          >
            {isStreaming ? '…' : 'Send ↵'}
          </button>
        </div>
      </div>
    </div>
  );
}
