import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, Play, X, Pencil, Trash2, TriangleAlert, Plus } from 'lucide-react';
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
  ceoSummary?: string;
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
  // ── card state ──────────────────────────────────────────────────────────────
  const [cards, setCards]         = useState<KanbanCard[]>([]);
  const [dragId, setDragId]       = useState<string | null>(null);
  const [dragOver, setDragOver]   = useState<KanbanColumn | null>(null);
  const [addingTo, setAddingTo]   = useState<KanbanColumn | null>(null);
  const [newTitle, setNewTitle]   = useState('');
  const [newDesc, setNewDesc]     = useState('');
  const [newPri, setNewPri]       = useState<KanbanCard['priority']>('medium');
  const [editing, setEditing]     = useState<KanbanCard | null>(null);

  // ── CEO queue state ─────────────────────────────────────────────────────────
  const [queueRunning, setQueueRunning] = useState(false);
  const [queueCardId, setQueueCardId]   = useState<string | null>(null);
  const [analyzing, setAnalyzing]       = useState(false);
  const [ceoProgress, setCeoProgress]   = useState<Record<string, string>>({});
  const [expandedSummaries, setExpandedSummaries] = useState<Set<string>>(new Set());
  const [pendingClarifications, setPendingClarifications] = useState<Record<string, { question: string; taskText: string }>>({});
  const [clarificationInputs, setClarificationInputs]     = useState<Record<string, string>>({});

  // ── filter state ────────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery]     = useState('');
  const [filterPriority, setFilterPriority] = useState<KanbanCard['priority'] | null>(null);
  const [filterCreator, setFilterCreator]   = useState<'user' | 'agent' | null>(null);
  const [filterAssigned, setFilterAssigned] = useState(false);
  const [filterTag, setFilterTag]           = useState<string | null>(null);

  // ── feedback ────────────────────────────────────────────────────────────────
  const [toast, setToast] = useState('');

  // ── refs ────────────────────────────────────────────────────────────────────
  const saveTimer          = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardsRef           = useRef<KanbanCard[]>([]);
  const queueRef           = useRef<string[]>([]);
  const ceoSummaryCapture  = useRef<Record<string, string>>({});

  useEffect(() => { cardsRef.current = cards; }, [cards]);

  // ── load on project change ──────────────────────────────────────────────────

  useEffect(() => {
    if (!projectRoot) return;
    setCards([]);
    setSearchQuery('');
    setFilterPriority(null);
    setFilterCreator(null);
    setFilterAssigned(false);
    setFilterTag(null);
    window.api.loadKanban(projectRoot)
      .then(loaded => setCards(loaded as KanbanCard[]))
      .catch(() => setCards([]));
  }, [projectRoot]);

  // ── CEO events ──────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!projectRoot) return;

    const onProgress = ({ workspaceId, event }: { workspaceId: string; event: unknown }) => {
      const cardId = workspaceId.slice('kanban-'.length);
      const ev = event as Record<string, any>;

      if (ev.type === 'step_start') {
        setCeoProgress(prev => ({
          ...prev,
          [cardId]: `[${ev.step?.agent ?? '?'}] ${ev.step?.description ?? ''}`,
        }));
      } else if (ev.type === 'step_done' || ev.type === 'step_error') {
        setCeoProgress(prev => { const n = { ...prev }; delete n[cardId]; return n; });
      } else if (ev.type === 'done' && ev.summary) {
        ceoSummaryCapture.current[cardId] = String(ev.summary);
      }
    };

    const onDone = ({ workspaceId, error }: { workspaceId: string; error?: string }) => {
      const cardId = workspaceId.slice('kanban-'.length);
      const summary = ceoSummaryCapture.current[cardId];
      delete ceoSummaryCapture.current[cardId];

      setCeoProgress(prev => { const n = { ...prev }; delete n[cardId]; return n; });

      setCards(prev => {
        const updated = prev.map(c => {
          if (c.id !== cardId) return c;
          if (error) return { ...c, column: 'backlog' as KanbanColumn, error };
          return {
            ...c,
            column: 'testing' as KanbanColumn,
            error: undefined,
            ceoSummary: summary || undefined,
          };
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
        runNextInQueue(projectRoot);
      }
    };

    window.api.onKanbanCeoProgress(onProgress);
    window.api.onKanbanCeoDone(onDone);
    return () => {
      window.api.offKanbanCeoProgress(onProgress);
      window.api.offKanbanCeoDone(onDone);
    };
  }, [projectRoot]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── persistence ─────────────────────────────────────────────────────────────

  function persistNow(root: string, updated: KanbanCard[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => window.api.saveKanban(root, updated), 400);
  }

  function updateCards(next: KanbanCard[]) {
    setCards(next);
    if (projectRoot) persistNow(projectRoot, next);
  }

  // ── toast ───────────────────────────────────────────────────────────────────

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 4000);
  }

  // ── CEO queue ───────────────────────────────────────────────────────────────

  async function startQueue() {
    if (!projectRoot || queueRunning) return;
    const colOrder: KanbanColumn[] = ['next', 'in-progress', 'backlog'];
    const assigned = [...cardsRef.current.filter(
      c => c.assignedTo === 'ceo' && c.column !== 'done' && c.column !== 'testing'
    )].sort((a, b) => colOrder.indexOf(a.column) - colOrder.indexOf(b.column));

    if (!assigned.length) { showToast('No cards assigned to CEO.'); return; }
    queueRef.current = assigned.map(c => c.id);
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
    setCards(prev => {
      const updated = prev.map(c =>
        c.id === nextId ? { ...c, column: 'in-progress' as KanbanColumn, error: undefined } : c
      );
      cardsRef.current = updated;
      persistNow(root, updated);
      return updated;
    });

    const taskText = card.description?.trim()
      ? `${card.title}\n\nDetalhes: ${card.description}`
      : card.title;

    const planResult = await window.api.koda.plan(root, taskText, undefined, loadSettings());

    if (planResult.needsClarification) {
      setPendingClarifications(prev => ({
        ...prev,
        [nextId]: { question: planResult.clarificationQuestion ?? 'Preciso de mais informações para continuar.', taskText },
      }));
      setCards(prev => {
        const updated = prev.map(c =>
          c.id === nextId ? { ...c, column: 'backlog' as KanbanColumn, error: undefined } : c
        );
        cardsRef.current = updated;
        persistNow(root, updated);
        return updated;
      });
      showToast(`CEO needs more info for "${card.title}"`);
      queueRef.current = [];
      setQueueRunning(false);
      setQueueCardId(null);
      return;
    }

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

    window.api.koda.run(`kanban-${nextId}`, root, taskText, planResult.plan, undefined, loadSettings());
  }

  function stopQueue() {
    if (!queueCardId) return;
    window.api.koda.stop(`kanban-${queueCardId}`);
    queueRef.current = [];
    setQueueRunning(false);
    setQueueCardId(null);
    showToast('Queue stopped.');
  }

  async function submitClarification(cardId: string) {
    if (!projectRoot) return;
    const pending = pendingClarifications[cardId];
    const answer  = clarificationInputs[cardId]?.trim();
    if (!pending || !answer) return;

    const enrichedTask = `${pending.taskText}\n\nResposta ao CEO: ${answer}`;

    setPendingClarifications(prev => { const n = { ...prev }; delete n[cardId]; return n; });
    setClarificationInputs(prev => { const n = { ...prev }; delete n[cardId]; return n; });

    setQueueCardId(cardId);
    setQueueRunning(true);
    setCards(prev => {
      const updated = prev.map(c =>
        c.id === cardId ? { ...c, column: 'in-progress' as KanbanColumn, error: undefined } : c
      );
      cardsRef.current = updated;
      persistNow(projectRoot, updated);
      return updated;
    });

    const planResult = await window.api.koda.plan(projectRoot, enrichedTask, undefined, loadSettings());

    if (planResult.needsClarification) {
      setPendingClarifications(prev => ({
        ...prev,
        [cardId]: { question: planResult.clarificationQuestion ?? 'Preciso de mais informações.', taskText: enrichedTask },
      }));
      setCards(prev => {
        const updated = prev.map(c =>
          c.id === cardId ? { ...c, column: 'backlog' as KanbanColumn } : c
        );
        cardsRef.current = updated;
        persistNow(projectRoot, updated);
        return updated;
      });
      setQueueRunning(false);
      setQueueCardId(null);
      return;
    }

    if (planResult.error || !planResult.plan) {
      setCards(prev => {
        const updated = prev.map(c =>
          c.id === cardId ? { ...c, column: 'backlog' as KanbanColumn, error: planResult.error ?? 'Planning failed' } : c
        );
        cardsRef.current = updated;
        persistNow(projectRoot, updated);
        return updated;
      });
      setQueueRunning(false);
      setQueueCardId(null);
      return;
    }

    window.api.koda.run(`kanban-${cardId}`, projectRoot, enrichedTask, planResult.plan, undefined, loadSettings());
  }

  // ── CEO propose ─────────────────────────────────────────────────────────────

  async function proposeCards() {
    if (!projectRoot || analyzing) return;
    const cfg = getProposeLLMConfig();
    if (!cfg) { showToast('Configure a provider in Settings first.'); return; }

    setAnalyzing(true);
    try {
      const result = await window.api.proposeKanban(projectRoot, cfg);
      if (result.error) { showToast(result.error); return; }
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

  // ── card CRUD ────────────────────────────────────────────────────────────────

  function addCard() {
    if (!newTitle.trim() || !addingTo) return;
    updateCards([...cards, {
      id: uid(), title: newTitle.trim(),
      description: newDesc.trim() || undefined,
      column: addingTo, createdBy: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      priority: newPri,
    }]);
    setNewTitle(''); setNewDesc(''); setNewPri('medium'); setAddingTo(null);
  }

  function deleteCard(id: string) { updateCards(cards.filter(c => c.id !== id)); }

  function toggleCeo(id: string) {
    updateCards(cards.map(c =>
      c.id === id ? { ...c, assignedTo: c.assignedTo === 'ceo' ? undefined : 'ceo' } : c
    ));
  }

  function toggleSummary(id: string) {
    setExpandedSummaries(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function saveEdit() {
    if (!editing) return;
    updateCards(cards.map(c =>
      c.id === editing.id ? { ...editing, updatedAt: new Date().toISOString() } : c
    ));
    setEditing(null);
  }

  // ── drag & drop ──────────────────────────────────────────────────────────────

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
    setDragId(null); setDragOver(null);
  }

  // ── filters ──────────────────────────────────────────────────────────────────

  const allTags = useMemo(() => {
    const s = new Set<string>();
    cards.forEach(c => c.tags?.forEach(t => s.add(t)));
    return Array.from(s);
  }, [cards]);

  const visibleCards = useMemo(() => {
    let r = cards;
    const q = searchQuery.trim().toLowerCase();
    if (q) r = r.filter(c =>
      c.title.toLowerCase().includes(q) ||
      (c.description ?? '').toLowerCase().includes(q)
    );
    if (filterPriority) r = r.filter(c => c.priority === filterPriority);
    if (filterCreator)  r = r.filter(c => c.createdBy === filterCreator);
    if (filterAssigned) r = r.filter(c => c.assignedTo === 'ceo');
    if (filterTag)      r = r.filter(c => c.tags?.includes(filterTag));
    return r;
  }, [cards, searchQuery, filterPriority, filterCreator, filterAssigned, filterTag]);

  const hasFilters = !!(searchQuery.trim() || filterPriority || filterCreator || filterAssigned || filterTag);

  function clearFilters() {
    setSearchQuery(''); setFilterPriority(null);
    setFilterCreator(null); setFilterAssigned(false); setFilterTag(null);
  }

  // ── derived counts ───────────────────────────────────────────────────────────

  const assignedCount = cards.filter(
    c => c.assignedTo === 'ceo' && c.column !== 'done' && c.column !== 'testing'
  ).length;

  if (!projectRoot) {
    return <div className="kanban-empty">Open a project to use the Kanban board.</div>;
  }

  return (
    <div className="kanban-root">

      {/* Header */}
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
            {analyzing ? '⏳ Analyzing…' : <><Search size={13} strokeWidth={2} /> Analyze & Propose</>}
          </button>
          {queueRunning ? (
            <button className="kanban-header-btn danger" onClick={stopQueue}>■ Stop Queue</button>
          ) : (
            <button
              className={`kanban-header-btn ceo${assignedCount === 0 ? ' disabled' : ''}`}
              onClick={startQueue}
              disabled={assignedCount === 0}
              title={assignedCount === 0 ? 'Assign cards to CEO first' : `Run ${assignedCount} card(s) in sequence`}
            >
              <Play size={13} strokeWidth={2} /> Run Queue{assignedCount > 0 ? ` (${assignedCount})` : ''}
            </button>
          )}
        </div>
      </div>

      {/* Filter bar */}
      <div className="kanban-filter-bar">
        <input
          className="kanban-search"
          placeholder="Search cards…"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
        />
        <div className="kanban-filter-chips">
          {(['high', 'medium', 'low'] as const).map(p => (
            <button
              key={p}
              className={`kanban-filter-chip${filterPriority === p ? ' active' : ''}`}
              style={{ '--chip-color': PRIORITY_COLOR[p] } as React.CSSProperties}
              onClick={() => setFilterPriority(filterPriority === p ? null : p)}
            >
              {p}
            </button>
          ))}
          <button
            className={`kanban-filter-chip${filterCreator === 'agent' ? ' active' : ''}`}
            onClick={() => setFilterCreator(filterCreator === 'agent' ? null : 'agent')}
          >
            🤖 AI
          </button>
          <button
            className={`kanban-filter-chip${filterAssigned ? ' active' : ''}`}
            onClick={() => setFilterAssigned(v => !v)}
          >
            CEO
          </button>
          {allTags.map(tag => (
            <button
              key={tag}
              className={`kanban-filter-chip${filterTag === tag ? ' active' : ''}`}
              onClick={() => setFilterTag(filterTag === tag ? null : tag)}
            >
              {tag}
            </button>
          ))}
          {hasFilters && (
            <button className="kanban-filter-clear" onClick={clearFilters}><X size={11} strokeWidth={2.5} /> clear</button>
          )}
        </div>
      </div>

      {/* Board */}
      <div className="kanban-board">
        {COLUMNS.map(col => {
          const colCards = visibleCards.filter(c => c.column === col.key);
          const totalInCol = cards.filter(c => c.column === col.key).length;
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
                <span className="kanban-col-count">
                  {hasFilters && colCards.length !== totalInCol
                    ? `${colCards.length}/${totalInCol}`
                    : colCards.length}
                </span>
              </div>

              <div className="kanban-cards">
                {colCards.map(card => {
                  const isRunning  = queueCardId === card.id;
                  const stepText   = ceoProgress[card.id];
                  const hasSummary = !!card.ceoSummary;
                  const summaryOpen = expandedSummaries.has(card.id);

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
                          >🤖</button>
                          <button className="kanban-card-btn" onClick={() => setEditing({ ...card })} title="Edit" disabled={isRunning}><Pencil size={12} strokeWidth={2} /></button>
                          <button className="kanban-card-btn danger" onClick={() => deleteCard(card.id)} title="Delete" disabled={isRunning}><Trash2 size={12} strokeWidth={2} /></button>
                        </div>
                      </div>

                      {card.description && (
                        <p className="kanban-card-desc">{card.description}</p>
                      )}

                      {/* CEO real-time step */}
                      {stepText && (
                        <p className="kanban-card-progress">⏳ {stepText}</p>
                      )}

                      {card.error && (
                        <p className="kanban-card-error" title={card.error}><TriangleAlert size={12} strokeWidth={2} /> {card.error.slice(0, 80)}</p>
                      )}

                      {/* CEO clarification request */}
                      {pendingClarifications[card.id] && (
                        <div className="kanban-clarification">
                          <p className="kanban-clarification-q">❓ {pendingClarifications[card.id].question}</p>
                          <div className="kanban-clarification-row">
                            <input
                              className="kanban-input kanban-clarification-input"
                              placeholder="Sua resposta..."
                              value={clarificationInputs[card.id] ?? ''}
                              autoFocus
                              onChange={e => setClarificationInputs(prev => ({ ...prev, [card.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter') submitClarification(card.id); }}
                            />
                            <button
                              className="kanban-clarification-send"
                              onClick={() => submitClarification(card.id)}
                              disabled={!clarificationInputs[card.id]?.trim()}
                            >Enviar</button>
                          </div>
                        </div>
                      )}

                      {/* CEO summary (expandable) */}
                      {hasSummary && (
                        <div className="kanban-card-summary">
                          <button
                            className="kanban-summary-toggle"
                            onClick={() => toggleSummary(card.id)}
                          >
                            {summaryOpen ? '▾' : '▸'} CEO summary
                          </button>
                          {summaryOpen && (
                            <pre className="kanban-summary-text">{card.ceoSummary}</pre>
                          )}
                        </div>
                      )}

                      <div className="kanban-card-meta">
                        <div className="kanban-card-tags">
                          {card.tags?.map(tag => (
                            <span
                              key={tag}
                              className={`kanban-tag${filterTag === tag ? ' active' : ''}`}
                              onClick={() => setFilterTag(filterTag === tag ? null : tag)}
                              style={{ cursor: 'pointer' }}
                              title="Filter by this tag"
                            >
                              {tag}
                            </span>
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
                    onKeyDown={e => { if (e.key === 'Enter') addCard(); if (e.key === 'Escape') setAddingTo(null); }}
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
                      >{p}</button>
                    ))}
                  </div>
                  <div className="kanban-form-actions">
                    <button className="kanban-btn primary" onClick={addCard}>Add</button>
                    <button className="kanban-btn" onClick={() => { setAddingTo(null); setNewTitle(''); setNewDesc(''); }}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button className="kanban-add-btn" onClick={() => setAddingTo(col.key)}><Plus size={13} strokeWidth={2} /> Add card</button>
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
            <input className="kanban-input" value={editing.title} autoFocus
              onChange={e => setEditing({ ...editing, title: e.target.value })} />

            <label className="kanban-label">Description</label>
            <textarea className="kanban-input" value={editing.description ?? ''} rows={4}
              onChange={e => setEditing({ ...editing, description: e.target.value })} />

            <label className="kanban-label">Priority</label>
            <div className="kanban-priority-row">
              {(['low', 'medium', 'high'] as const).map(p => (
                <button key={p}
                  className={`kanban-priority-btn${editing.priority === p ? ' active' : ''}`}
                  style={{ '--p-color': PRIORITY_COLOR[p] } as React.CSSProperties}
                  onClick={() => setEditing({ ...editing, priority: p })}
                >{p}</button>
              ))}
            </div>

            <label className="kanban-label">Column</label>
            <select className="kanban-input" value={editing.column}
              onChange={e => setEditing({ ...editing, column: e.target.value as KanbanColumn })}>
              {COLUMNS.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>

            <label className="kanban-label">
              <input type="checkbox" checked={editing.assignedTo === 'ceo'}
                onChange={e => setEditing({ ...editing, assignedTo: e.target.checked ? 'ceo' : undefined })}
                style={{ marginRight: 6 }} />
              Assign to CEO
            </label>

            <div className="kanban-form-actions" style={{ marginTop: 12 }}>
              <button className="kanban-btn primary" onClick={saveEdit}>Save</button>
              <button className="kanban-btn" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="kanban-toast">{toast}</div>}
    </div>
  );
}
