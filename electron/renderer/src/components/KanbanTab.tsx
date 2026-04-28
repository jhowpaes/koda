import React, { useState, useEffect, useRef } from 'react';
import { loadSettings } from './SettingsModal';

export type KanbanColumn = 'backlog' | 'next' | 'in-progress' | 'testing' | 'done';

export interface KanbanCard {
  id: string;
  title: string;
  description?: string;
  column: KanbanColumn;
  createdBy: 'user' | 'agent';
  createdAt: string;
  updatedAt: string;
  priority?: 'low' | 'medium' | 'high';
  tags?: string[];
  assignedTo?: 'ceo';
  error?: string;
}

const COLUMNS: { key: KanbanColumn; label: string; accent: string }[] = [
  { key: 'backlog',     label: 'Backlog',     accent: '#6e7681' },
  { key: 'next',        label: 'Next',        accent: '#569cd6' },
  { key: 'in-progress', label: 'In Progress', accent: '#e5c07b' },
  { key: 'testing',     label: 'Testing',     accent: '#c678dd' },
  { key: 'done',        label: 'Done',        accent: '#4ec9b0' },
];

const PRIORITY_COLOR: Record<string, string> = {
  low:    '#6e7681',
  medium: '#e5c07b',
  high:   '#f85149',
};

function uid() {
  return `k-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getProposeLLMConfig(): { apiKey: string; baseUrl: string; model: string } | null {
  const settings = loadSettings();
  const provider = settings.providers.find(p => p.enabled && p.apiKey);
  if (!provider) return null;
  return {
    apiKey:  provider.apiKey,
    baseUrl: provider.baseUrl,
    model:   provider.models.split(',')[0]?.trim() ?? '',
  };
}

interface Props {
  projectRoot: string | null;
}

export default function KanbanTab({ projectRoot }: Props) {
  const [cards, setCards]         = useState<KanbanCard[]>([]);
  const [dragId, setDragId]       = useState<string | null>(null);
  const [dragOver, setDragOver]   = useState<KanbanColumn | null>(null);
  const [addingTo, setAddingTo]   = useState<KanbanColumn | null>(null);
  const [newTitle, setNewTitle]   = useState('');
  const [newDesc, setNewDesc]     = useState('');
  const [newPri, setNewPri]       = useState<KanbanCard['priority']>('medium');
  const [editing, setEditing]     = useState<KanbanCard | null>(null);
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueCardId, setQueueCardId]   = useState<string | null>(null);
  const [analyzing, setAnalyzing]       = useState(false);
  const [toast, setToast]               = useState('');

  const saveTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardsRef   = useRef<KanbanCard[]>([]);
  const queueRef   = useRef<string[]>([]);

  // Keep cardsRef in sync with state
  useEffect(() => { cardsRef.current = cards; }, [cards]);

  // Load kanban on project change
  useEffect(() => {
    if (!projectRoot) return;
    setCards([]);
    window.api.loadKanban(projectRoot).then(loaded => {
      setCards(loaded as KanbanCard[]);
    }).catch(() => setCards([]));
  }, [projectRoot]);

  // Subscribe to CEO done events for kanban cards
  useEffect(() => {
    if (!projectRoot) return;

    const onDone = ({ workspaceId, error }: { workspaceId: string; error?: string }) => {
      const cardId = workspaceId.slice('kanban-'.length);

      setCards(prev => {
        const updated = prev.map(c => {
          if (c.id !== cardId) return c;
          if (error) return { ...c, column: 'backlog' as KanbanColumn, error };
          return { ...c, column: 'testing' as KanbanColumn, error: undefined };
        });
        cardsRef.current = updated;
        persistNow(projectRoot, updated);
        return updated;
      });

      if (error) {
        showToast(`CEO failed: ${error}`);
        queueRef.current = [];
        setQueueRunning(false);
        setQueueCardId(null);
      } else {
        // Advance to next card in queue
        runNextInQueue(projectRoot);
      }
    };

    window.api.onKanbanCeoDone(onDone);
    return () => { window.api.offKanbanCeoDone(onDone); };
  }, [projectRoot]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── persistence ────────────────────────────────────────────────────────────

  function persistNow(root: string, updated: KanbanCard[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      window.api.saveKanban(root, updated);
    }, 400);
  }

  function updateCards(next: KanbanCard[]) {
    setCards(next);
    if (projectRoot) persistNow(projectRoot, next);
  }

  // ── toast helper ───────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  // ── CEO queue ──────────────────────────────────────────────────────────────

  async function startQueue() {
    if (!projectRoot || queueRunning) return;

    const assigned = cardsRef.current.filter(
      c => c.assignedTo === 'ceo' && c.column !== 'done' && c.column !== 'testing'
    );
    const colOrder: KanbanColumn[] = ['next', 'in-progress', 'backlog'];
    const sorted = [...assigned].sort(
      (a, b) => colOrder.indexOf(a.column) - colOrder.indexOf(b.column)
    );

    if (sorted.length === 0) { showToast('No cards assigned to CEO.'); return; }

    queueRef.current = sorted.map(c => c.id);
    setQueueRunning(true);
    runNextInQueue(projectRoot);
  }

  async function runNextInQueue(root: string) {
    const nextId = queueRef.current.shift();
    if (!nextId) {
      setQueueRunning(false);
      setQueueCardId(null);
      showToast('Queue complete.');
      return;
    }

    const card = cardsRef.current.find(c => c.id === nextId);
    if (!card) { runNextInQueue(root); return; }

    setQueueCardId(nextId);

    // Move card to in-progress
    setCards(prev => {
      const updated = prev.map(c =>
        c.id === nextId ? { ...c, column: 'in-progress' as KanbanColumn, error: undefined } : c
      );
      cardsRef.current = updated;
      persistNow(root, updated);
      return updated;
    });

    // Plan the task first
    const planResult = await window.api.koda.plan(root, card.title);
    if (planResult.error || !planResult.plan) {
      setCards(prev => {
        const updated = prev.map(c =>
          c.id === nextId
            ? { ...c, column: 'backlog' as KanbanColumn, error: planResult.error ?? 'Planning failed' }
            : c
        );
        cardsRef.current = updated;
        persistNow(root, updated);
        return updated;
      });
      showToast(`Planning failed for "${card.title}"`);
      queueRef.current = [];
      setQueueRunning(false);
      setQueueCardId(null);
      return;
    }

    // Run without confirmation
    window.api.koda.run(
      `kanban-${nextId}`,
      root,
      card.title,
      planResult.plan,
      undefined,
      loadSettings(),
    );
  }

  function stopQueue() {
    if (!queueCardId) return;
    window.api.koda.stop(`kanban-${queueCardId}`);
    queueRef.current = [];
    setQueueRunning(false);
    setQueueCardId(null);
    showToast('Queue stopped.');
  }

  // ── CEO propose ────────────────────────────────────────────────────────────

  async function proposeCards() {
    if (!projectRoot || analyzing) return;
    const cfg = getProposeLLMConfig();
    if (!cfg) { showToast('Configure a provider in Settings first.'); return; }

    setAnalyzing(true);
    try {
      const result = await window.api.proposeKanban(projectRoot, cfg);
      if (result.error) {
        showToast(result.error);
        return;
      }
      const proposed = (result.cards ?? []) as KanbanCard[];
      if (!proposed.length) { showToast('No tasks proposed.'); return; }
      updateCards([...cardsRef.current, ...proposed]);
      showToast(`Added ${proposed.length} task${proposed.length > 1 ? 's' : ''} to Backlog.`);
    } catch (e) {
      showToast((e as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  // ── card CRUD ──────────────────────────────────────────────────────────────

  function addCard() {
    if (!newTitle.trim() || !addingTo) return;
    const card: KanbanCard = {
      id: uid(),
      title: newTitle.trim(),
      description: newDesc.trim() || undefined,
      column: addingTo,
      createdBy: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      priority: newPri,
    };
    updateCards([...cards, card]);
    setNewTitle('');
    setNewDesc('');
    setNewPri('medium');
    setAddingTo(null);
  }

  function deleteCard(id: string) {
    updateCards(cards.filter(c => c.id !== id));
  }

  function toggleCeo(id: string) {
    updateCards(cards.map(c =>
      c.id === id
        ? { ...c, assignedTo: c.assignedTo === 'ceo' ? undefined : 'ceo' }
        : c
    ));
  }

  function saveEdit() {
    if (!editing) return;
    updateCards(cards.map(c =>
      c.id === editing.id ? { ...editing, updatedAt: new Date().toISOString() } : c
    ));
    setEditing(null);
  }

  // ── drag & drop ────────────────────────────────────────────────────────────

  function onDragStart(e: React.DragEvent, id: string) {
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  }

  function onDrop(e: React.DragEvent, col: KanbanColumn) {
    e.preventDefault();
    if (!dragId) return;
    updateCards(cards.map(c =>
      c.id === dragId ? { ...c, column: col, updatedAt: new Date().toISOString() } : c
    ));
    setDragId(null);
    setDragOver(null);
  }

  // ── counts ─────────────────────────────────────────────────────────────────

  const assignedCount = cards.filter(c => c.assignedTo === 'ceo' && c.column !== 'done' && c.column !== 'testing').length;

  if (!projectRoot) {
    return <div className="kanban-empty">Open a project to use the Kanban board.</div>;
  }

  return (
    <div className="kanban-root">
      {/* Board header */}
      <div className="kanban-header">
        <span className="kanban-header-title">
          Tasks
          {assignedCount > 0 && (
            <span className="kanban-assigned-badge">{assignedCount} for CEO</span>
          )}
        </span>
        <div className="kanban-header-actions">
          <button
            className={`kanban-header-btn${analyzing ? ' loading' : ''}`}
            onClick={proposeCards}
            disabled={analyzing}
            title="Ask CEO to analyze project and propose tasks"
          >
            {analyzing ? '⏳ Analyzing…' : '🔍 Analyze & Propose'}
          </button>
          {queueRunning ? (
            <button className="kanban-header-btn danger" onClick={stopQueue} title="Stop CEO queue">
              ■ Stop Queue
            </button>
          ) : (
            <button
              className={`kanban-header-btn ceo${assignedCount === 0 ? ' disabled' : ''}`}
              onClick={startQueue}
              disabled={assignedCount === 0}
              title={assignedCount === 0 ? 'Assign cards to CEO first' : `Run ${assignedCount} card${assignedCount > 1 ? 's' : ''} in sequence`}
            >
              ▶ Run Queue{assignedCount > 0 ? ` (${assignedCount})` : ''}
            </button>
          )}
        </div>
      </div>

      {/* Board columns */}
      <div className="kanban-board">
        {COLUMNS.map(col => {
          const colCards = cards.filter(c => c.column === col.key);
          return (
            <div
              key={col.key}
              className={`kanban-col${dragOver === col.key ? ' drag-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(col.key); }}
              onDragLeave={() => setDragOver(null)}
              onDrop={e => onDrop(e, col.key)}
            >
              <div className="kanban-col-header">
                <span className="kanban-col-dot" style={{ background: col.accent }} />
                <span className="kanban-col-title">{col.label}</span>
                <span className="kanban-col-count">{colCards.length}</span>
              </div>

              <div className="kanban-cards">
                {colCards.map(card => {
                  const isRunning = queueCardId === card.id;
                  return (
                    <div
                      key={card.id}
                      className={[
                        'kanban-card',
                        dragId === card.id ? 'dragging' : '',
                        card.assignedTo === 'ceo' ? 'ceo-assigned' : '',
                        isRunning ? 'ceo-running' : '',
                        card.error ? 'has-error' : '',
                      ].filter(Boolean).join(' ')}
                      draggable={!isRunning}
                      onDragStart={e => onDragStart(e, card.id)}
                      onDragEnd={() => { setDragId(null); setDragOver(null); }}
                    >
                      <div className="kanban-card-header">
                        {card.priority && (
                          <span
                            className="kanban-priority-dot"
                            style={{ background: PRIORITY_COLOR[card.priority] }}
                            title={card.priority}
                          />
                        )}
                        <span className="kanban-card-title">{card.title}</span>
                        <div className="kanban-card-actions">
                          {isRunning && <span className="kanban-running-dot" title="CEO is working on this" />}
                          <button
                            className={`kanban-card-btn ceo-toggle${card.assignedTo === 'ceo' ? ' active' : ''}`}
                            onClick={() => toggleCeo(card.id)}
                            title={card.assignedTo === 'ceo' ? 'Unassign from CEO' : 'Assign to CEO'}
                            disabled={isRunning}
                          >
                            🤖
                          </button>
                          <button className="kanban-card-btn" onClick={() => setEditing({ ...card })} title="Edit" disabled={isRunning}>✎</button>
                          <button className="kanban-card-btn danger" onClick={() => deleteCard(card.id)} title="Delete" disabled={isRunning}>✕</button>
                        </div>
                      </div>

                      {card.description && (
                        <p className="kanban-card-desc">{card.description}</p>
                      )}

                      {card.error && (
                        <p className="kanban-card-error" title={card.error}>
                          ⚠ {card.error.slice(0, 80)}
                        </p>
                      )}

                      <div className="kanban-card-meta">
                        <div className="kanban-card-tags">
                          {card.tags?.map(tag => (
                            <span key={tag} className="kanban-tag">{tag}</span>
                          ))}
                        </div>
                        <div className="kanban-card-meta-right">
                          <span className="kanban-creator" title={card.createdBy}>
                            {card.createdBy === 'agent' ? '🤖' : '👤'}
                          </span>
                          <span className="kanban-date">
                            {new Date(card.createdAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {addingTo === col.key ? (
                <div className="kanban-add-form">
                  <input
                    className="kanban-input"
                    placeholder="Card title..."
                    value={newTitle}
                    autoFocus
                    onChange={e => setNewTitle(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') addCard();
                      if (e.key === 'Escape') setAddingTo(null);
                    }}
                  />
                  <textarea
                    className="kanban-input"
                    placeholder="Description (optional)..."
                    value={newDesc}
                    rows={2}
                    onChange={e => setNewDesc(e.target.value)}
                  />
                  <div className="kanban-priority-row">
                    {(['low', 'medium', 'high'] as const).map(p => (
                      <button
                        key={p}
                        className={`kanban-priority-btn${newPri === p ? ' active' : ''}`}
                        style={{ '--p-color': PRIORITY_COLOR[p] } as React.CSSProperties}
                        onClick={() => setNewPri(p)}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                  <div className="kanban-form-actions">
                    <button className="kanban-btn primary" onClick={addCard}>Add</button>
                    <button className="kanban-btn" onClick={() => { setAddingTo(null); setNewTitle(''); setNewDesc(''); }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <button className="kanban-add-btn" onClick={() => setAddingTo(col.key)}>
                  + Add card
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Edit modal */}
      {editing && (
        <div className="kanban-modal-overlay" onClick={() => setEditing(null)}>
          <div className="kanban-modal" onClick={e => e.stopPropagation()}>
            <h3 className="kanban-modal-title">Edit Card</h3>

            <label className="kanban-label">Title</label>
            <input
              className="kanban-input"
              value={editing.title}
              autoFocus
              onChange={e => setEditing({ ...editing, title: e.target.value })}
            />

            <label className="kanban-label">Description</label>
            <textarea
              className="kanban-input"
              value={editing.description ?? ''}
              rows={4}
              onChange={e => setEditing({ ...editing, description: e.target.value })}
            />

            <label className="kanban-label">Priority</label>
            <div className="kanban-priority-row">
              {(['low', 'medium', 'high'] as const).map(p => (
                <button
                  key={p}
                  className={`kanban-priority-btn${editing.priority === p ? ' active' : ''}`}
                  style={{ '--p-color': PRIORITY_COLOR[p] } as React.CSSProperties}
                  onClick={() => setEditing({ ...editing, priority: p })}
                >
                  {p}
                </button>
              ))}
            </div>

            <label className="kanban-label">Column</label>
            <select
              className="kanban-input"
              value={editing.column}
              onChange={e => setEditing({ ...editing, column: e.target.value as KanbanColumn })}
            >
              {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>

            <label className="kanban-label">
              <input
                type="checkbox"
                checked={editing.assignedTo === 'ceo'}
                onChange={e => setEditing({ ...editing, assignedTo: e.target.checked ? 'ceo' : undefined })}
                style={{ marginRight: 6 }}
              />
              Assign to CEO
            </label>

            <div className="kanban-form-actions" style={{ marginTop: 12 }}>
              <button className="kanban-btn primary" onClick={saveEdit}>Save</button>
              <button className="kanban-btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="kanban-toast">{toast}</div>}
    </div>
  );
}
