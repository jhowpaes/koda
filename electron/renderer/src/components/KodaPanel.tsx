import React, { useState, useRef, useEffect, useCallback } from 'react';
import { History, ArrowLeft } from 'lucide-react';
import type { KodaHistoryEntry } from '../App';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface CeoStep {
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  description: string;
}

export interface CeoPlan {
  thinking?: string;
  complexity?: 'simple' | 'moderate' | 'complex';
  steps: CeoStep[];
  parallel: boolean;
}

export type KodaProgressEvent =
  | { type: 'plan'; plan: CeoPlan }
  | { type: 'step_start'; step: CeoStep; index: number; total: number; chatId?: string }
  | { type: 'step_done'; step: CeoStep; index: number; result: string }
  | { type: 'step_error'; step: CeoStep; index: number; error: string }
  | { type: 'done'; summary: string };

export interface KodaStepState {
  step: CeoStep;
  status: 'pending' | 'running' | 'done' | 'error';
  result?: string;
  error?: string;
  chatId?: string;
  resolvedModel?: string;
}

export interface KodaState {
  running: boolean;
  planning: boolean;
  confirming: boolean;
  pendingTask: string | null;
  plan: CeoPlan | null;
  steps: KodaStepState[];
  summary: string | null;
  error: string | null;
}

export const EMPTY_KODA_STATE: KodaState = {
  running: false,
  planning: false,
  confirming: false,
  pendingTask: null,
  plan: null,
  steps: [],
  summary: null,
  error: null,
};

// ─── Voice phase ───────────────────────────────────────────────────────────────
//
// off          → voice mode inactive
// wake_word    → SpeechRecognition watching for "KODA" (no audio capture)
// listening    → recording microphone (task or confirmation)
// transcribing → sending audio to Whisper STT
// waiting_plan → task submitted, parent is generating plan
// confirming   → plan ready, about to record confirmation
// executing    → plan confirmed, running

type VoicePhase = 'off' | 'wake_word' | 'listening' | 'transcribing' | 'waiting_plan' | 'confirming' | 'executing';

// ─── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  workspaceId: string;
  projectRoot: string | null;
  kodaState: KodaState;
  history: KodaHistoryEntry[];
  onRun: (task: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onStop: () => void;
}

// ─── History entry card ────────────────────────────────────────────────────────

function HistoryCard({ entry }: { entry: KodaHistoryEntry }) {
  const [open, setOpen] = useState(false);
  const date = new Date(entry.timestamp);
  const dateStr = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const timeStr = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="koda-history-card">
      <button className="koda-history-card-header" onClick={() => setOpen(v => !v)}>
        <span className="koda-history-card-arrow">{open ? '▾' : '▸'}</span>
        <span className="koda-history-card-task">{entry.task}</span>
        <span className="koda-history-card-meta">
          {entry.complexity && (
            <span className="koda-history-card-complexity" style={{ color: COMPLEXITY_COLOR[entry.complexity] ?? 'var(--text-dim)' }}>
              {entry.complexity}
            </span>
          )}
          <span className="koda-history-card-date">{dateStr} {timeStr}</span>
        </span>
      </button>
      {open && (
        <div className="koda-history-card-body">
          <div className="koda-history-steps">
            {entry.steps.map((s, i) => (
              <div key={i} className={`koda-history-step ${s.error ? 'error' : 'done'}`}>
                <div className="koda-history-step-header">
                  <span className="koda-step-icon">{s.error ? '✕' : '✓'}</span>
                  <span className="koda-step-agent" style={{ color: agentColor(s.agent) }}>[{s.agent}]</span>
                  <span className="koda-step-desc">{s.description}</span>
                </div>
                {s.error && <div className="koda-step-error">{s.error}</div>}
              </div>
            ))}
          </div>
          {entry.summary && (
            <pre className="koda-history-summary">{entry.summary}</pre>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Agent colors ──────────────────────────────────────────────────────────────

const AGENT_COLOR: Record<string, string> = {
  code:   '#238be6',
  review: '#a371f7',
  git:    '#3fb950',
};
const AGENT_ICON: Record<string, string> = {
  code: '⚡', review: '🔍', git: '🌿',
};

function agentColor(n: string) { return AGENT_COLOR[n] ?? '#e3b341'; }
function agentIcon(n: string)  { return AGENT_ICON[n]  ?? '•'; }

/** Extracts the ## Achados block from agent result text, or returns null. */
function extractAchados(result: string): string | null {
  const match = result.match(/##\s*Achados[\s\S]+/i);
  if (!match) return null;
  const text = match[0].trim();
  return text.length > 600 ? text.slice(0, 600).trimEnd() + '…' : text;
}

const COMPLEXITY_COLOR: Record<string, string> = {
  simple: '#3fb950', moderate: '#e3b341', complex: '#f85149',
};

// ─── TTS ───────────────────────────────────────────────────────────────────────

// Strips markdown and code artifacts so TTS receives clean spoken text.
// Keeps only readable prose — removes headers, bullets, code blocks, line refs.
function stripForTTS(text: string, maxChars = 480): string {
  return text
    .replace(/```[\s\S]*?```/g, '')            // remove fenced code blocks
    .replace(/`[^`\n]+`/g, '')                 // remove inline code
    .replace(/^#{1,6}\s+/gm, '')               // remove markdown headers
    .replace(/\[L\d+\]/g, '')                  // remove line refs [L123]
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')       // unbold
    .replace(/\*([^*\n]+)\*/g, '$1')           // unitalic
    .replace(/^[\t ]*[-*•]\s+/gm, '')          // remove bullet points
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')   // strip markdown links, keep text
    .replace(/\n{2,}/g, '. ')                  // collapse paragraph breaks
    .replace(/\n/g, ' ')                        // collapse remaining newlines
    .replace(/\s{2,}/g, ' ')                   // collapse whitespace
    .replace(/\.\s*\./g, '.')                  // fix double dots
    .trim()
    .slice(0, maxChars);
}

// TTS audio cache for short repeated phrases to avoid redundant API calls
const ttsCache = new Map<string, string>();

async function playTTS(text: string): Promise<void> {
  try {
    const cfg = await (window.api as any).koda.getConfig();
    if (!cfg?.tts?.enabled || !cfg?.tts?.apiKey) return;
    const cleaned = stripForTTS(text);
    if (!cleaned) return;
    let b64 = ttsCache.get(cleaned);
    if (!b64) {
      const result = await (window.api as any).koda.tts(cleaned, cfg.tts);
      if (!result?.data) return;
      b64 = result.data as string;
      // Only cache short static phrases (< 120 chars) to avoid unbounded memory
      if (cleaned.length < 120) ttsCache.set(cleaned, b64);
    }
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const url   = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    return new Promise<void>(res => {
      const a = new Audio(url);
      a.onended = () => { URL.revokeObjectURL(url); res(); };
      a.onerror = () => { URL.revokeObjectURL(url); res(); };
      a.play().catch(() => res());
    });
  } catch {}
}

// ─── Voice flow hook (MediaRecorder + Whisper only — no SpeechRecognition) ─────

function useVoiceFlow(deps: {
  isConfirming: boolean;
  isRunning:    boolean;
  summary:      string | null;
  error:        string | null;
  planThinking: string | undefined;
  pendingTask:  string | null;
  steps:        KodaStepState[];
  kodaWorkspace?: unknown;
  onTaskReady:  (task: string) => void;
  onConfirm:    () => void;
  onCancel:     () => void;
}) {
  const [voicePhase,   setVoicePhaseState] = useState<VoicePhase>('off');
  const [liveText,     setLiveText]        = useState('');
  const [audioLevel,   setAudioLevel]      = useState(0);   // 0-1 bar height
  const [voiceError,   setVoiceError]      = useState<string | null>(null);

  const phaseRef    = useRef<VoicePhase>('off');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const wakeRef     = useRef<any>(null);
  const rafRef      = useRef(0);
  const depsRef     = useRef(deps);
  depsRef.current = deps;

  // Getter prevents TypeScript from narrowing phaseRef.current type in async callbacks
  const getPhase = useCallback((): VoicePhase => phaseRef.current, []);

  const setPhase = useCallback((p: VoicePhase) => {
    phaseRef.current = p;
    setVoicePhaseState(p);
  }, []);

  // ── Stop everything ────────────────────────────────────────────────────────

  const stopAudio = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    setAudioLevel(0);
    if (wakeRef.current) {
      try { wakeRef.current.stop(); } catch {}
      wakeRef.current = null;
    }
    if (recorderRef.current) {
      try { recorderRef.current.stop(); } catch {}
      recorderRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
  }, []);

  // ── Record + silence detect + Whisper ─────────────────────────────────────

  const recordUntilSilence = useCallback(async (silenceMs = 800, onStopped?: () => void): Promise<string | null> => {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setVoiceError('Não foi possível acessar o microfone.');
      return null;
    }

    return new Promise<string | null>(resolve => {
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      recorderRef.current = recorder;

      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        cancelAnimationFrame(rafRef.current);
        setAudioLevel(0);
        if (audioCtxRef.current) {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
        }
        // If phase is 'off' the recorder was stopped externally — discard audio
        if (chunks.length === 0 || getPhase() === 'off') { resolve(null); return; }

        onStopped?.();

        // Transcribe via Whisper
        const blob  = new Blob(chunks, { type: 'audio/webm' });
        const b64   = await new Promise<string>(res => {
          const fr = new FileReader();
          fr.readAsDataURL(blob);
          fr.onloadend = () => res((fr.result as string).split(',')[1]);
        });
        const result = await (window.api as any).koda.stt(b64);
        resolve(result?.text?.trim() || null);
      };

      // Silence detection via AudioContext
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;
      const src      = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      const buf = new Uint8Array(analyser.frequencyBinCount);

      let lastSound      = Date.now();
      let speakingBegan  = false;

      const tick = () => {
        // Stop if phase changed externally
        if (getPhase() === 'off') { recorder.stop(); return; }

        analyser.getByteFrequencyData(buf);
        const avg = buf.reduce((a, b) => a + b, 0) / buf.length;
        setAudioLevel(Math.min(1, avg / 35));

        if (avg > 15) { lastSound = Date.now(); speakingBegan = true; }
        const silence = Date.now() - lastSound;

        if (speakingBegan  && silence > silenceMs) { recorder.stop(); return; }
        if (!speakingBegan && silence > 3000)      { recorder.stop(); return; }

        rafRef.current = requestAnimationFrame(tick);
      };

      recorder.start(100);
      rafRef.current = requestAnimationFrame(tick);
    });
  }, [getPhase]);

  // ── Task listening ─────────────────────────────────────────────────────────

  const listenForTask = useCallback(async () => {
    if (getPhase() !== 'listening') return;
    const text = await recordUntilSilence(800, () => setPhase('transcribing'));
    if (getPhase() === 'off') return;

    if (!text || text.length < 3) {
      setPhase('listening');
      await playTTS('Não entendi. Pode repetir?');
      if (getPhase() === 'listening') listenForTask();
      return;
    }

    setLiveText(text);
    setPhase('waiting_plan');
    depsRef.current.onTaskReady(text);
  }, [getPhase, recordUntilSilence, setPhase]);

  // ── Confirmation listening ─────────────────────────────────────────────────

  const listenForConfirm = useCallback(async () => {
    if (getPhase() !== 'confirming') return;

    // Keep 'confirming' phase visible during transcription so UI buttons stay hidden.
    // Only switch to 'transcribing' when speech was detected (not external stop).
    const text = await recordUntilSilence(600, () => {
      if (getPhase() !== 'off') setPhase('transcribing');
    });

    // Abort if the flow was externally interrupted
    const p = getPhase();
    if (p === 'off' || p === 'executing' || p === 'listening' || p === 'waiting_plan') return;

    // No audio captured (timeout with no speech) — retry silently
    if (!text) {
      setPhase('confirming');
      if (getPhase() === 'confirming') listenForConfirm();
      return;
    }

    // Normalize accents so "não"/"Não"/"nao" all match after NFD decomposition
    const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    const isYes = /\b(sim|pode|confirma|confirmar|ok|vai|certo|ta|isso|execute|executar)\b/.test(t);
    const isNo  = /\b(nao|cancela|cancelar|para|parar|errado|muda|mudar|outro|volta|voltar)\b/.test(t);

    if (isYes) {
      setPhase('executing');
      depsRef.current.onConfirm();
    } else if (isNo) {
      // Set phase before onCancel so koda-state change doesn't trigger unexpected effects
      setPhase('listening');
      setLiveText('');
      depsRef.current.onCancel();
      await playTTS('Ok, cancelado. O que você quer fazer?');
      if (getPhase() === 'listening') listenForTask();
    } else {
      setPhase('confirming');
      await playTTS('Não entendi. Diga sim para confirmar ou não para cancelar.');
      if (getPhase() === 'confirming') listenForConfirm();
    }
  }, [getPhase, recordUntilSilence, setPhase, listenForTask]);

  // ── Wake word ("KODA") via SpeechRecognition — zero audio capture ──────────

  const listenForWakeWord = useCallback(() => {
    // webkitSpeechRecognition is available in Electron/Chromium but routes audio to
    // Google's cloud via Chromium's internal network stack (bypasses all JS interceptors),
    // causing repeated chunked-upload failures (net::ERR_FAILED -2) in the network service.
    // In Electron we use Whisper directly via recordUntilSilence instead.
    const isElectron = navigator.userAgent.includes('Electron');
    const SR = isElectron ? null : ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition);
    if (!SR) {
      setPhase('listening');
      listenForTask();
      return;
    }

    const rec = new SR();
    wakeRef.current = rec;
    rec.lang = 'pt-BR';
    rec.continuous = true;
    rec.interimResults = true;

    rec.onresult = (e: any) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = (e.results[i][0].transcript as string).toLowerCase().trim();
        if (/^(koda|coda)\b/.test(t)) {
          try { rec.stop(); } catch {}
          wakeRef.current = null;
          if (getPhase() === 'wake_word') {
            setPhase('listening');
            listenForTask();
          }
          return;
        }
      }
    };

    rec.onend = () => {
      if (getPhase() === 'wake_word') {
        try { rec.start(); } catch {}
      }
    };

    rec.onerror = (e: any) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      setVoiceError(`Erro no reconhecimento: ${e.error}`);
    };

    try { rec.start(); } catch {}
  }, [getPhase, setPhase, listenForTask]);

  // ── React: plan ready → start confirmation ─────────────────────────────────

  const prevConfirmingRef = useRef(false);
  useEffect(() => {
    const was = prevConfirmingRef.current;
    prevConfirmingRef.current = deps.isConfirming;

    if (!was && deps.isConfirming && getPhase() === 'waiting_plan') {
      setPhase('confirming');
      const t = deps.planThinking;
      const tts = t
        ? `Entendido. ${t.slice(0, 120)}. É isso que você quer? Diga sim ou não.`
        : 'Plano pronto. É isso que você quer? Diga sim para confirmar ou não para cancelar.';
      playTTS(tts).then(() => {
        if (getPhase() === 'confirming' && depsRef.current.isConfirming) {
          listenForConfirm();
        }
      });
    }
  }, [deps.isConfirming, deps.planThinking, getPhase, setPhase, listenForConfirm]);

  // ── React: execution done → restart ───────────────────────────────────────

  const prevRunningRef = useRef(false);
  useEffect(() => {
    const was = prevRunningRef.current;
    prevRunningRef.current = deps.isRunning;
    if (was && !deps.isRunning && getPhase() === 'executing') {
      const { pendingTask, steps: completedSteps, kodaWorkspace } = depsRef.current;

      (async () => {
        let ttsText: string;
        try {
          const spoken = await (window.api as any).koda.spokenSummary({
            task: pendingTask ?? '',
            steps: completedSteps,
            kodaWorkspace,
          });
          ttsText = spoken || 'Tarefa concluída. Pode me dizer o que mais quer fazer.';
        } catch {
          ttsText = 'Tarefa concluída. Pode me dizer o que mais quer fazer.';
        }

        await playTTS(ttsText);
        if (getPhase() === 'executing') {
          setLiveText('');
          setPhase('listening');
          listenForTask();
        }
      })();
    }
  }, [deps.isRunning, getPhase, setPhase, listenForTask]);

  // ── React: planning error ──────────────────────────────────────────────────

  const prevErrorRef = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevErrorRef.current;
    prevErrorRef.current = deps.error;
    const p = getPhase();
    if (deps.error && !prev && (p === 'waiting_plan' || p === 'confirming' || p === 'executing')) {
      stopAudio();
      playTTS('Ocorreu um erro. Pode tentar de novo?').then(() => {
        if (getPhase() !== 'off') {
          setLiveText('');
          setPhase('listening');
          listenForTask();
        }
      });
    }
  }, [deps.error, getPhase, stopAudio, setPhase, listenForTask]);

  // ── Activate / deactivate ──────────────────────────────────────────────────

  const activateVoice = useCallback(async () => {
    const perm = await (window.api as any).requestMicPermission?.();
    if (perm && !perm.granted) {
      setVoiceError('Acesso ao microfone negado. Verifique as Preferências do Sistema.');
      return;
    }
    setVoiceError(null);
    setLiveText('');
    setPhase('wake_word');
    listenForWakeWord();
  }, [setPhase, listenForWakeWord]);

  const deactivateVoice = useCallback(() => {
    stopAudio();
    setPhase('off');
    setLiveText('');
    setVoiceError(null);
  }, [stopAudio, setPhase]);

  useEffect(() => () => { stopAudio(); }, [stopAudio]);

  return { voicePhase, liveText, audioLevel, voiceError, activateVoice, deactivateVoice };
}

// ─── Voice label/color maps ────────────────────────────────────────────────────

const VOICE_LABEL: Partial<Record<VoicePhase, string>> = {
  wake_word:    'Aguardando "KODA"...',
  listening:    'Ouvindo...',
  transcribing: 'Transcrevendo...',
  waiting_plan: 'Gerando plano...',
  confirming:   'Diga sim ou não...',
  executing:    'Executando...',
};
const VOICE_COLOR: Partial<Record<VoicePhase, string>> = {
  wake_word:    'var(--text-dim)',
  listening:    'var(--green)',
  transcribing: 'var(--yellow)',
  waiting_plan: 'var(--yellow)',
  confirming:   'var(--yellow)',
  executing:    'var(--accent)',
};

// ─── KodaPanel ─────────────────────────────────────────────────────────────────

export default function KodaPanel({ workspaceId: _workspaceId, projectRoot, kodaState, history, onRun, onConfirm, onCancel, onStop }: Props) {
  const [task, setTask]             = useState('');
  const [activeTab, setActiveTab]   = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const textareaRef      = useRef<HTMLTextAreaElement>(null);
  const bodyRef          = useRef<HTMLDivElement>(null);
  const prevRunningTTS   = useRef(false);

  const { running, planning, confirming, plan, steps, summary, error } = kodaState;

  const { voicePhase, liveText, audioLevel, voiceError, activateVoice, deactivateVoice } =
    useVoiceFlow({
      isConfirming: confirming,
      isRunning:    running,
      summary,
      error,
      planThinking: plan?.thinking,
      pendingTask:  kodaState.pendingTask,
      steps:        kodaState.steps,
      onTaskReady:  onRun,
      onConfirm,
      onCancel,
    });

  const voiceActive = voicePhase !== 'off';

  // Scroll to bottom on updates
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' });
  }, [steps.length, summary]);

  // TTS summary in manual mode — dispara apenas quando running vai de true→false
  useEffect(() => {
    const was = prevRunningTTS.current;
    prevRunningTTS.current = running;
    if (was && !running && summary && !voiceActive) {
      playTTS(summary);
    }
  }, [running, summary, voiceActive]);

  // Default active tab
  useEffect(() => {
    if (steps.length > 0 && !activeTab) setActiveTab(steps[0].step.agent);
  }, [steps, activeTab]);

  // Auto-resize textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [task]);

  function handleSend() {
    const t = task.trim();
    if (!t || !projectRoot || running) return;
    setTask('');
    setActiveTab(null);
    onRun(t);
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  const agentTabs  = plan ? Array.from(new Set(plan.steps.map(s => s.agent))) : [];
  const visibleTab = activeTab ?? agentTabs[0] ?? null;
  const tabSteps   = steps.filter(s => s.step.agent === visibleTab);
  const doneCount  = steps.filter(s => s.status === 'done').length;
  const totalSteps = plan?.steps.length ?? 0;

  // Hide manual confirm/cancel buttons during both 'confirming' and 'transcribing' phases
  const isVoiceConfirming = voicePhase === 'confirming' || voicePhase === 'transcribing';

  return (
    <div className="koda-panel">

      {/* ── Header ── */}
      <div className="koda-header">
        <span className="koda-logo">KODA</span>
        {!showHistory && plan && (
          <span className="koda-complexity" style={{ color: COMPLEXITY_COLOR[plan.complexity ?? 'moderate'] }}>
            {plan.complexity ?? 'moderate'}
          </span>
        )}
        {voiceActive && !showHistory && (
          <span className="koda-voice-status" style={{ color: VOICE_COLOR[voicePhase] ?? 'var(--text-dim)' }}>
            <span className={`koda-voice-dot ${voicePhase === 'listening' ? 'pulsing' : ''}`} />
            {VOICE_LABEL[voicePhase]}
          </span>
        )}
        <div className="koda-header-right">
          {!running && !confirming && (
            <button
              className={`koda-history-btn ${showHistory ? 'active' : ''}`}
              onClick={() => setShowHistory(v => !v)}
              title="Histórico de execuções"
            >
              {showHistory
                ? <><ArrowLeft size={11} strokeWidth={2} /> Voltar</>
                : <><History size={11} strokeWidth={2} /> {`Histórico${history.length ? ` (${history.length})` : ''}`}</>
              }
            </button>
          )}
          {!showHistory && confirming && !isVoiceConfirming && (
            <>
              <button className="koda-confirm-btn" onClick={onConfirm} title="Executar este plano">
                ▶ Executar
              </button>
              <button className="koda-cancel-btn" onClick={onCancel} title="Descartar plano">
                Cancelar
              </button>
            </>
          )}
          {!showHistory && running && (
            <button className="koda-stop-btn" onClick={onStop} title="Parar CEO">
              ■ Parar
            </button>
          )}
        </div>
      </div>

      {/* ── Body ── */}
      <div className="koda-body" ref={bodyRef}>

        {/* ── History view ── */}
        {showHistory && (
          <div className="koda-history">
            {history.length === 0 ? (
              <div className="koda-empty">
                <div className="koda-empty-title">Sem histórico</div>
                <div className="koda-empty-sub">As execuções do CEO aparecerão aqui.</div>
              </div>
            ) : (
              history.map(entry => <HistoryCard key={entry.id} entry={entry} />)
            )}
          </div>
        )}

        {/* Voice: wake word */}
        {!showHistory && voicePhase === 'wake_word' && (
          <div className="koda-voice-listening">
            <div className="koda-orb koda-orb--wake" />
            <div className="koda-voice-listening-label">Diga <strong>KODA</strong> para começar</div>
          </div>
        )}

        {/* Voice: listening */}
        {!showHistory && voicePhase === 'listening' && !planning && !plan && !summary && (
          <div className="koda-voice-listening">
            <div className="koda-orb koda-orb--listening" style={{ '--level': audioLevel } as any} />
            <div className="koda-voice-listening-label">Ouvindo sua tarefa...</div>
            {liveText && <div className="koda-transcript">{liveText}</div>}
          </div>
        )}

        {/* Voice: waiting for plan */}
        {!showHistory && voicePhase === 'waiting_plan' && !plan && (
          <div className="koda-voice-listening">
            <div className="koda-orb koda-orb--processing" />
            <div className="koda-voice-listening-label">Gerando plano...</div>
            {liveText && <div className="koda-transcript">{liveText}</div>}
          </div>
        )}

        {/* Empty state (no voice) */}
        {!showHistory && !voiceActive && !running && !plan && !summary && !error && (
          <div className="koda-empty">
            <button
              className="koda-empty-orb"
              onClick={activateVoice}
              disabled={!projectRoot}
              title="Ativar modo voz"
            >
              <span className="koda-empty-orb-icon">⚡</span>
            </button>
            <div className="koda-empty-title">Agente CEO</div>
            <div className="koda-empty-sub">
              Descreva uma tarefa e o KODA irá planejar e executá-la usando os agentes de Código, Revisão e Git.
            </div>
          </div>
        )}

        {/* Planning spinner */}
        {!showHistory && planning && (
          <div className="koda-planning">
            <span className="koda-spinner" /> Planejando...
          </div>
        )}

        {/* Confirmation banner — shows CEO's interpretation BEFORE executing */}
        {!showHistory && confirming && plan && (
          <div className={`koda-confirm-banner${isVoiceConfirming ? ' koda-confirm-banner--voice' : ''}`}>
            <div className="koda-confirm-banner-top">
              <span className="koda-confirm-icon">📋</span>
              <span className="koda-confirm-meta">
                <strong>{plan.steps.length} passo{plan.steps.length !== 1 ? 's' : ''}</strong>
                {plan.complexity && <> · <span style={{ color: COMPLEXITY_COLOR[plan.complexity] }}>{plan.complexity}</span></>}
              </span>
              {isVoiceConfirming
                ? <span className="koda-voice-prompt">🎙 Diga <strong>sim</strong> ou <strong>não</strong></span>
                : <span className="koda-confirm-hint">Confira o plano abaixo e clique em Executar.</span>}
            </div>
            {plan.thinking && (
              <div className="koda-confirm-thinking">
                <span className="koda-confirm-thinking-label">Entendi assim:</span> {plan.thinking}
              </div>
            )}
          </div>
        )}

        {/* Plan + steps */}
        {!showHistory && plan && plan.steps.length > 0 && (
          <>
            <div className="koda-progress-bar-wrap">
              <div className="koda-progress-bar" style={{ width: `${totalSteps ? (doneCount / totalSteps) * 100 : 0}%` }} />
            </div>

            {agentTabs.length > 1 && (
              <div className="koda-tabs">
                {agentTabs.map(agent => (
                  <button
                    key={agent}
                    className={`koda-tab ${visibleTab === agent ? 'active' : ''}`}
                    style={{ '--agent-color': agentColor(agent) } as any}
                    onClick={() => setActiveTab(agent)}
                  >
                    {agentIcon(agent)} {agent}
                  </button>
                ))}
              </div>
            )}

            <div className="koda-steps">
              {(visibleTab ? tabSteps : steps).map((s, i) => (
                <div key={i} className={`koda-step koda-step--${s.status}`}>
                  <div className="koda-step-header">
                    <span className="koda-step-icon">
                      {s.status === 'done'    ? '✓' :
                       s.status === 'error'   ? '✕' :
                       s.status === 'running' ? <span className="koda-spinner-sm" /> : '○'}
                    </span>
                    <span className="koda-step-agent" style={{ color: agentColor(s.step.agent) }}>
                      [{s.step.agent}]
                    </span>
                    <span className="koda-step-tool">{s.step.tool}</span>
                    {s.resolvedModel && (
                      <span className="koda-step-model" title="Modelo usado neste passo">
                        {s.resolvedModel}
                      </span>
                    )}
                  </div>
                  <div className="koda-step-desc">{s.step.description}</div>
                  {s.status === 'done' && s.result && (
                    <div className="koda-step-result">{extractAchados(s.result) || s.result.slice(-300).trim()}</div>
                  )}
                  {s.status === 'error' && <div className="koda-step-error">{s.error}</div>}
                </div>
              ))}

              {plan.steps.filter((_, i) => !steps[i]).map((s, i) => (
                <div key={`p-${i}`} className="koda-step koda-step--pending">
                  <div className="koda-step-header">
                    <span className="koda-step-icon">○</span>
                    <span className="koda-step-agent" style={{ color: agentColor(s.agent) }}>[{s.agent}]</span>
                    <span className="koda-step-tool">{s.tool}</span>
                  </div>
                  <div className="koda-step-desc">{s.description}</div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Summary */}
        {!showHistory && summary && !running && (
          <div className="koda-summary">
            <div className="koda-summary-header">
              <span className="koda-summary-label">Resumo</span>
              <button className="koda-new-task-btn" onClick={onCancel} title="Iniciar nova tarefa">
                + Nova tarefa
              </button>
            </div>
            <div className="koda-summary-steps">
              {steps.map((s, i) => (
                <div key={i} className={`koda-summary-step koda-summary-step--${s.status}`}>
                  <div className="koda-summary-step-row">
                    <span className="koda-summary-step-icon">{s.status === 'error' ? '✕' : '✓'}</span>
                    <span className="koda-summary-step-agent" style={{ color: agentColor(s.step.agent) }}>
                      [{s.step.agent}]
                    </span>
                    <span className="koda-summary-step-desc">{s.step.description}</span>
                    {s.resolvedModel && (
                      <span className="koda-summary-step-model">{s.resolvedModel}</span>
                    )}
                  </div>
                  {s.error && <div className="koda-summary-step-error">{s.error}</div>}
                  {!s.error && s.result && (
                    <div className="koda-summary-step-result">
                      {extractAchados(s.result) || s.result.slice(-300).trim()}
                    </div>
                  )}
                </div>
              ))}
            </div>
            {voiceActive && (
              <div className="koda-voice-done-hint">🎙 Pronto para nova tarefa — ouvindo...</div>
            )}
          </div>
        )}

        {/* Errors */}
        {!showHistory && error      && <div className="koda-error">{error}</div>}
        {!showHistory && voiceError && <div className="koda-error">{voiceError}</div>}
      </div>

      {/* ── Input (manual, shown when voice is off) ── */}
      {!voiceActive && (
        <div className="koda-input-wrap">
          <textarea
            ref={textareaRef}
            className="koda-input"
            placeholder={
              running    ? 'CEO em execução...' :
              confirming ? 'Confirme ou cancele o plano acima...' :
              planning   ? 'Planejando...' :
                           'Descreva uma tarefa para o CEO...'
            }
            value={task}
            onChange={e => setTask(e.target.value)}
            onKeyDown={handleKey}
            disabled={running || planning || confirming || !projectRoot}
            rows={1}
          />
          <div className="koda-input-actions">
            <button
              className="koda-send-btn"
              onClick={handleSend}
              disabled={!task.trim() || running || planning || confirming || !projectRoot}
              title="Executar tarefa (Enter)"
            >
              ▶
            </button>
          </div>
        </div>
      )}

      {/* ── Voice bottom bar (when voice active) ── */}
      {voiceActive && (
        <div className="koda-voice-bar">
          {voicePhase === 'listening' && (
            <div className="koda-voice-bars">
              {[...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className="koda-voice-bar-item"
                  style={{
                    animationDelay: `${i * 0.1}s`,
                    transform: `scaleY(${0.3 + audioLevel * 0.7})`,
                  }}
                />
              ))}
            </div>
          )}
          <span className="koda-voice-bar-label">
            {VOICE_LABEL[voicePhase] ?? 'Modo voz ativo'}
          </span>
          <button className="koda-voice-deactivate" onClick={deactivateVoice} title="Desativar voz">
            ✕
          </button>
        </div>
      )}

      {!projectRoot && (
        <div className="koda-no-project">Abra um projeto para usar o KODA</div>
      )}
    </div>
  );
}
