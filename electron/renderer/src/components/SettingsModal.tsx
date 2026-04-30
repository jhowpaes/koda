import React, { useState, useEffect, useCallback, memo } from 'react';
import { Settings, X, Mic, Server, Bot, Brain, Search, GitBranch, Volume2, Plus, Sparkles, Loader2 } from 'lucide-react';

// ── types ─────────────────────────────────────────────────────────────────────

export interface LLMProvider {
  id: string;
  name: string;
  apiKey: string;
  baseUrl: string;
  models: string;
  enabled: boolean;
}

export interface AgentConfig {
  id: string;
  name: string;
  model: string;
  systemPrompt: string;
  skills: string;
}

export interface KodaRouting {
  code?:   { providerId: string; model: string };
  review?: { providerId: string; model: string };
  git?:    { providerId: string; model: string };
}

export interface AppSettings {
  providers: LLMProvider[];
  agents: AgentConfig[];
  kodaRouting?: KodaRouting;
}

// ── persistence ───────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'code-ai:settings';

const DEFAULT_PROVIDERS: LLMProvider[] = [
  { id: 'openai',    name: 'OpenAI',        apiKey: '', baseUrl: 'https://api.openai.com/v1',                          models: 'gpt-4o,gpt-4-turbo,gpt-3.5-turbo',                                  enabled: true },
  { id: 'anthropic', name: 'Anthropic',     apiKey: '', baseUrl: 'https://api.anthropic.com',                          models: 'claude-sonnet-4-6,claude-opus-4-7,claude-haiku-4-5-20251001',       enabled: true },
  { id: 'google',    name: 'Google Gemini', apiKey: '', baseUrl: 'https://generativelanguage.googleapis.com/v1beta',   models: 'gemini-2.0-flash,gemini-1.5-pro',                                   enabled: true },
  { id: 'glm',       name: 'GLM / ZhipuAI', apiKey: '', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',               models: 'glm-5.1,glm-4-air',                                                 enabled: true },
];

const DEFAULT_AGENTS: AgentConfig[] = [
  {
    id: 'default-reviewer',
    name: 'Code Reviewer',
    model: '',
    skills: 'code-review, security, performance',
    systemPrompt: `You are a senior software engineer performing code reviews.

Rules:
- Always read the actual file before reviewing — never comment based on assumptions
- Use search_files to understand how the code is used elsewhere before judging it

Review structure (use this format exactly):
## Critical Issues
[security vulnerabilities, bugs, data loss risks — each with file:line and exact fix]

## Suggestions
[performance, maintainability, readability — prioritized, actionable]

## Summary
[2 sentences: overall quality and the single most important change]

Be direct. Skip praise unless something is genuinely non-obvious. Reference exact line numbers.`,
  },
  {
    id: 'default-explainer',
    name: 'Code Explainer',
    model: '',
    skills: 'explain, documentation, architecture',
    systemPrompt: `You are a code explainer specialized in making complex code understandable.

Rules:
- Always read the actual file/section before explaining — never explain from memory
- Use read_file_lines to read only the relevant section, not the whole file
- Use search_files to understand context and dependencies

Explanation structure:
1. **Purpose** — what this code does in one sentence
2. **How it works** — step-by-step, plain language, no jargon
3. **Key dependencies** — only the non-obvious ones
4. **Usage** — how to call/use it, with a short example if helpful

Keep it concise. Use analogies for complex concepts. Skip obvious things.`,
  },
  {
    id: 'default-refactor',
    name: 'Refactor Pro',
    model: '',
    skills: 'refactoring, clean-code, best-practices',
    systemPrompt: `You are a refactoring expert focused on clarity, performance, and maintainability.

Rules:
- Read the target file/section FIRST — never refactor based on assumptions
- Use search_files to check if changed symbols are used elsewhere before renaming
- Never change behavior — only structure, naming, and clarity
- Keep diffs minimal: change only what was asked

Process:
1. Read the relevant code
2. Identify issues: duplication, complexity, poor naming, missing abstractions
3. Apply changes with write_file (always include the complete file)
4. List what changed and why (one line each)

If refactoring would break external callers, warn before proceeding.`,
  },
  {
    id: 'default-tests',
    name: 'Test Writer',
    model: '',
    skills: 'testing, tdd, coverage',
    systemPrompt: `You are a test generation specialist.

Rules:
- Read the source file before writing tests — understand the actual implementation
- Use search_files to find existing test files and match their style/framework
- Never write tests that test implementation details — test behavior and contracts

Test coverage checklist:
- Happy path (normal inputs)
- Edge cases (empty, null, boundary values)
- Error conditions (what should throw or return error)
- Side effects (database, network calls — mock them)

Output: complete, runnable test file with no placeholders or TODOs.
If you need clarification on expected behavior, ask before writing.`,
  },
  {
    id: 'default-engineer',
    name: 'Software Engineer',
    model: '',
    skills: 'architecture, implementation, code-design',
    systemPrompt: `You are a senior software engineer responsible for implementing features and solving technical problems end-to-end.

Rules:
- Always explore the codebase before proposing or implementing anything — use list_dir and search_files to understand the existing structure, conventions, and patterns
- Match the project's existing code style, naming conventions, and architecture
- Never introduce unnecessary dependencies or abstractions
- When implementing: read related files first, implement, then verify consistency with the rest of the codebase

Implementation process:
1. Understand the request fully — ask if anything is ambiguous
2. Explore relevant parts of the codebase
3. Plan: list files to create/modify and why
4. Implement: write complete, working code (no TODOs, no placeholders)
5. Check: use search_files to verify the implementation is consistent with existing patterns

Output: working code with a brief explanation of design decisions. Skip obvious comments.`,
  },
  {
    id: 'default-docs',
    name: 'Documentation Writer',
    model: '',
    skills: 'documentation, readme, jsdoc, api-docs',
    systemPrompt: `You are a technical writer specialized in developer documentation.

Rules:
- Always read the actual code before writing any documentation — never document from assumptions
- Use search_files to find all public APIs, exports, and entry points
- Match the documentation style already present in the project (if any)
- Write for the target audience: if it's a library, document the public API; if it's an app, document setup and architecture

Documentation types you handle:
- **README**: purpose, quick-start, installation, usage examples, configuration
- **JSDoc/TSDoc**: function signatures, params, return values, usage examples
- **Architecture docs**: high-level structure, data flow, key decisions
- **API reference**: endpoints, request/response formats, error codes

Format rules:
- Use clear headings and short paragraphs
- Include runnable code examples
- Document the WHY, not just the WHAT
- Keep it up to date: if you change code, update the docs in the same response`,
  },
  {
    id: 'default-debug',
    name: 'Debug Detective',
    model: '',
    skills: 'debugging, error-analysis, root-cause',
    systemPrompt: `You are a debugging specialist focused on finding root causes, not symptoms.

Process (follow in order):
1. Read the error message and stack trace carefully
2. Use search_files to find the relevant code
3. Use read_file_lines to read the exact failing section with context (±20 lines)
4. Form a hypothesis about the root cause
5. Verify the hypothesis by reading related code
6. Apply the fix with write_file

Rules:
- NEVER guess the cause — trace the actual code path
- If the bug is in a dependency, say so explicitly
- Explain the root cause in one sentence, then show the minimal fix
- If you cannot reproduce or find the issue in the code, say so clearly

Output format: Root cause → Fix → Why this fix works`,
  },
  {
    id: 'default-security',
    name: 'Security Analyst',
    model: '',
    skills: 'security, pentest, owasp, code-audit',
    systemPrompt: `You are a senior application security engineer and penetration tester.

Rules:
- Always read the actual code before reporting vulnerabilities — never assume
- Use search_files to trace data flows from input to output (sources → sinks)
- Report only confirmed issues — clearly distinguish confirmed from suspected
- For each finding: explain the attack scenario, not just the vulnerability class

Security audit checklist (check what's relevant to the codebase):
- **Injection**: SQL, command, LDAP, XPath — trace user input through queries and exec calls
- **Auth/AuthZ**: missing authentication, broken access control, insecure tokens
- **Sensitive data**: secrets in code/logs, unencrypted storage, weak crypto
- **Input validation**: missing sanitization, unsafe deserialization, path traversal
- **Dependencies**: outdated packages with known CVEs (check package.json / requirements)
- **API security**: exposed internal endpoints, missing rate limiting, CORS misconfig
- **Secrets**: hardcoded keys, tokens, passwords in source or config files

Output format per finding:
**[SEVERITY: Critical/High/Medium/Low]** — Title
- Location: file:line
- Attack scenario: how an attacker exploits this
- Impact: what they can achieve
- Fix: exact code change or mitigation

Finish with a prioritized remediation list.`,
  },
  {
    id: 'default-analyst',
    name: 'Project Analyst',
    model: '',
    skills: 'architecture-review, tech-debt, roadmap, task-planning',
    systemPrompt: `You are a senior engineering lead specialized in project analysis and technical planning.

Process:
1. Explore the full project structure with list_dir
2. Read key files: README, package.json (or equivalent), main entry points, config files
3. Use search_files to identify patterns, anti-patterns, and recurring issues
4. Read .codeai/MEMORY.md if it exists for prior context
5. Synthesize findings into actionable improvements and tasks

Analysis dimensions:
- **Architecture**: structure clarity, separation of concerns, scalability bottlenecks
- **Code quality**: duplication, complexity hotspots, inconsistent patterns
- **Tech debt**: outdated deps, deprecated APIs, TODO/FIXME comments, missing error handling
- **Documentation**: missing README sections, undocumented APIs, stale docs
- **Testing**: coverage gaps, missing test types (unit/integration/e2e)
- **Developer experience**: build setup, onboarding friction, missing tooling
- **Performance**: obvious inefficiencies visible in the code

Output format:

## Project Overview
[2–3 sentences: what it is, stack, current state]

## Strengths
[bullet list — what is already done well, keep it brief]

## Issues Found
[grouped by dimension, each with severity: 🔴 Critical / 🟡 Important / 🔵 Nice-to-have]

## Proposed Tasks
[numbered, prioritized backlog ready to execute — each task: title, why it matters, estimated effort: S/M/L]

## Recommended Next Step
[single most impactful action to take right now, and why]

Be objective and specific. Reference actual files and line numbers. Skip generic advice.`,
  },
];

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const parsed: AppSettings = JSON.parse(raw);
      // Seed default agents on first use
      if (!parsed.agents?.length) parsed.agents = DEFAULT_AGENTS;
      return parsed;
    }
  } catch {}
  return { providers: DEFAULT_PROVIDERS, agents: DEFAULT_AGENTS };
}

function persistSettings(s: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

let _id = 0;
function uid() { return `cfg-${Date.now()}-${++_id}`; }

// ── component ─────────────────────────────────────────────────────────────────

interface Props {
  onClose: () => void;
}

// ── KODA config types (mirrors src/app/config.ts) ────────────────────────────

interface KodaConfig {
  tts: {
    enabled: boolean;
    apiKey: string;
    voice: string;
    model: string;
    speed: number;
  };
  stt: {
    enabled: boolean;
    apiKey: string;
  };
}

const DEFAULT_KODA_CONFIG: KodaConfig = {
  tts: { enabled: false, apiKey: '', voice: 'nova', model: 'tts-1', speed: 1.0 },
  stt: { enabled: false, apiKey: '' },
};

type Tab = 'providers' | 'agents' | 'koda';

// ── Claude Code constants ──────────────────────────────────────────────────────

const CLAUDE_CODE_PROVIDER_ID = 'claude-code';
const CLAUDE_CODE_BASE_URL    = 'https://api.anthropic.com';
const CLAUDE_CODE_MODELS_STR  = 'claude-opus-4-7,claude-sonnet-4-6,claude-haiku-4-5-20251001';

// ── ClaudeCodeSection component ────────────────────────────────────────────────

type ClaudeLoginStep = 'idle' | 'waiting' | 'connected' | 'error';

function ClaudeCodeSection({ onProviderUpdated }: { onProviderUpdated: () => void }) {
  const [accountStatus, setAccountStatus] = useState<'loading' | 'connected' | 'disconnected'>('loading');
  const [loginStep, setLoginStep]         = useState<ClaudeLoginStep>('idle');
  const [loginError, setLoginError]       = useState('');
  const [info, setInfo]                   = useState<{ emailAddress?: string; displayName?: string; organizationName?: string; billingType?: string } | null>(null);
  const api = (window as any).api;

  function applyStatus(s: any) {
    if (s?.connected) {
      setAccountStatus('connected');
      setLoginStep('connected');
      setInfo(s);
      syncProvider(true, s);
    } else {
      setAccountStatus('disconnected');
      setInfo(null);
      syncProvider(false);
    }
  }

  useEffect(() => {
    api.claudeCode.getStatus().then(applyStatus).catch(() => setAccountStatus('disconnected'));
    api.claudeCode.onAccountChanged(applyStatus);
    return () => api.claudeCode.offAccountChanged();
  }, []);

  function syncProvider(connected: boolean, s?: typeof info) {
    const settings = loadSettings();
    if (connected && s) {
      const entry: LLMProvider = {
        id:      CLAUDE_CODE_PROVIDER_ID,
        name:    `Claude Code${s.displayName ? ` (${s.displayName})` : ''}`,
        apiKey:  'claude-code-oauth',
        baseUrl: CLAUDE_CODE_BASE_URL,
        models:  CLAUDE_CODE_MODELS_STR,
        enabled: true,
      };
      const existing = settings.providers.find(p => p.id === CLAUDE_CODE_PROVIDER_ID);
      const providers = existing
        ? settings.providers.map(p => p.id === CLAUDE_CODE_PROVIDER_ID ? entry : p)
        : [entry, ...settings.providers];
      localStorage.setItem('code-ai:settings', JSON.stringify({ ...settings, providers }));
    } else {
      const providers = settings.providers.filter(p => p.id !== CLAUDE_CODE_PROVIDER_ID);
      localStorage.setItem('code-ai:settings', JSON.stringify({ ...settings, providers }));
    }
    onProviderUpdated();
  }

  async function startLogin() {
    setLoginError('');
    setLoginStep('waiting');
    const result = await api.claudeCode.login().catch(() => ({ ok: false, error: 'Falha ao iniciar login' }));
    if (!result.ok) {
      setLoginError(result.error ?? 'Erro ao iniciar login');
      setLoginStep('error');
      return;
    }
    // Token is in Keychain — refresh status directly (file watcher won't catch it)
    const status = await api.claudeCode.getStatus().catch(() => null);
    if (status) applyStatus(status);
  }

  function planLabel(billingType?: string) {
    if (!billingType) return '';
    if (billingType === 'stripe_subscription') return 'Pro';
    if (billingType === 'claude_code') return 'Claude Code';
    return billingType;
  }

  const isConnected = accountStatus === 'connected';

  return (
    <div className="provider-card copilot-card claude-code-card">
      <div className="provider-header">
        <span className="settings-section-title">
          <svg width="14" height="14" viewBox="0 0 28 28" fill="currentColor" style={{ verticalAlign: 'middle', marginRight: 6 }}>
            <path d="M14.0002 0C6.26863 0 0 6.26863 0 14.0002C0 21.7317 6.26863 28 14.0002 28C21.7317 28 28 21.7317 28 14.0002C28 6.26863 21.7317 0 14.0002 0Z"/>
          </svg>
          Claude Code
        </span>
        {isConnected && <span className="copilot-badge">Conectado</span>}
      </div>

      {accountStatus === 'loading' && (
        <p className="settings-hint">Verificando credenciais…</p>
      )}

      {accountStatus === 'disconnected' && (loginStep === 'idle' || loginStep === 'error') && (
        <>
          {loginError && <p className="copilot-error">{loginError}</p>}
          <p className="settings-hint" style={{ marginBottom: 10 }}>
            Conecte sua conta Anthropic via OAuth — sem precisar de API key.
          </p>
          <button className="settings-add-btn copilot-connect-btn" onClick={startLogin}>
            Fazer login com Claude
          </button>
        </>
      )}

      {accountStatus === 'disconnected' && loginStep === 'waiting' && (
        <p className="settings-hint">
          Navegador aberto para autenticação. Aguardando você concluir o login…
        </p>
      )}

      {isConnected && info && (
        <div className="copilot-connected">
          <div className="claude-code-avatar">C</div>
          <div className="copilot-user-info">
            <span className="copilot-username">{info.displayName ?? info.emailAddress}</span>
            <span className="settings-hint">
              {info.emailAddress}
              {info.billingType && ` · ${planLabel(info.billingType)}`}
            </span>
            <span className="settings-hint">Modelos: {CLAUDE_CODE_MODELS_STR.split(',').join(', ')}</span>
          </div>
          <button
            className="copilot-disconnect-btn"
            onClick={async () => {
              await api.claudeCode.logout().catch(() => {});
              applyStatus({ connected: false });
            }}
          >
            Desconectar
          </button>
        </div>
      )}
    </div>
  );
}

// ── GitHub Copilot constants ───────────────────────────────────────────────────

const COPILOT_PROVIDER_ID  = 'github-copilot';
const COPILOT_BASE_URL     = 'https://api.githubcopilot.com';
const COPILOT_MODELS_STR   = 'gpt-4o,gpt-4o-mini,o3-mini,claude-3.5-sonnet,claude-3.7-sonnet,gemini-2.0-flash';

type CopilotStep = 'idle' | 'loading' | 'device' | 'polling' | 'connected' | 'error';

interface DeviceInfo { userCode: string; verificationUri: string; deviceCode: string; interval: number }

// ── CopilotSection component ──────────────────────────────────────────────────

function CopilotSection({ onProviderUpdated }: { onProviderUpdated: () => void }) {
  const [step, setStep]         = useState<CopilotStep>('idle');
  const [device, setDevice]     = useState<DeviceInfo | null>(null);
  const [username, setUsername] = useState<string | undefined>();
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();
  const [error, setError]       = useState<string>('');
  const api = (window as any).api;

  // Check connection on mount
  useEffect(() => {
    api.copilot.getStatus().then((s: any) => {
      if (s?.connected) {
        setStep('connected');
        setUsername(s.username);
        setAvatarUrl(s.avatarUrl);
      }
    }).catch(() => {});
  }, []);

  const syncProvider = useCallback((connected: boolean, uname?: string) => {
    const settings = loadSettings();
    const existing = settings.providers.find(p => p.id === COPILOT_PROVIDER_ID);
    if (connected) {
      const entry: LLMProvider = {
        id:      COPILOT_PROVIDER_ID,
        name:    `GitHub Copilot${uname ? ` (${uname})` : ''}`,
        apiKey:  'copilot-oauth',
        baseUrl: COPILOT_BASE_URL,
        models:  COPILOT_MODELS_STR,
        enabled: true,
      };
      const providers = existing
        ? settings.providers.map(p => p.id === COPILOT_PROVIDER_ID ? entry : p)
        : [entry, ...settings.providers];
      localStorage.setItem('code-ai:settings', JSON.stringify({ ...settings, providers }));
    } else {
      const providers = settings.providers.filter(p => p.id !== COPILOT_PROVIDER_ID);
      localStorage.setItem('code-ai:settings', JSON.stringify({ ...settings, providers }));
    }
    onProviderUpdated();
  }, [onProviderUpdated]);

  async function startAuth() {
    setError('');
    setStep('loading');
    try {
      const info = await api.copilot.startAuth();
      setDevice({ userCode: info.userCode, verificationUri: info.verificationUri, deviceCode: info.deviceCode, interval: info.interval });
      setStep('device');
      // Open browser automatically
      window.open(info.verificationUri, '_blank');
    } catch (e: any) {
      setError(e.message ?? 'Erro ao iniciar autenticação');
      setStep('error');
    }
  }

  async function startPolling() {
    if (!device) return;
    setStep('polling');
    const intervalMs = (device.interval + 1) * 1000;
    const deadline = Date.now() + 15 * 60 * 1000; // 15 min

    const poll = async (): Promise<void> => {
      if (Date.now() > deadline) {
        setError('Tempo expirado. Tente novamente.');
        setStep('error');
        return;
      }
      try {
        const res = await api.copilot.pollAuth(device.deviceCode);
        if (res.status === 'complete') {
          setStep('connected');
          setUsername(res.username);
          setAvatarUrl(res.avatarUrl);
          syncProvider(true, res.username);
        } else if (res.status === 'expired') {
          setError('Código expirado. Tente novamente.');
          setStep('error');
        } else {
          setTimeout(poll, intervalMs);
        }
      } catch (e: any) {
        setError(e.message ?? 'Erro ao verificar autenticação');
        setStep('error');
      }
    };

    setTimeout(poll, intervalMs);
  }

  async function logout() {
    await api.copilot.logout();
    setStep('idle');
    setDevice(null);
    setUsername(undefined);
    setAvatarUrl(undefined);
    syncProvider(false);
  }

  return (
    <div className="provider-card copilot-card">
      <div className="provider-header">
        <span className="settings-section-title">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" style={{ verticalAlign: 'middle', marginRight: 6 }}>
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
          </svg>
          GitHub Copilot
        </span>
        {step === 'connected' && (
          <span className="copilot-badge">Conectado</span>
        )}
      </div>

      {step === 'idle' || step === 'error' ? (
        <>
          {error && <p className="copilot-error">{error}</p>}
          <p className="settings-hint" style={{ marginBottom: 10 }}>
            Conecte sua conta GitHub com uma assinatura ativa do Copilot para usar os modelos via OAuth — sem precisar de API key.
          </p>
          <button className="settings-add-btn copilot-connect-btn" onClick={startAuth}>
            Conectar com GitHub
          </button>
        </>
      ) : step === 'loading' ? (
        <p className="settings-hint">Iniciando fluxo OAuth…</p>
      ) : step === 'device' ? (
        <>
          <p className="settings-hint">
            1. Abra{' '}
            <a href={device!.verificationUri} target="_blank" rel="noreferrer" className="copilot-link">
              {device!.verificationUri}
            </a>{' '}
            no browser e insira o código abaixo:
          </p>
          <div className="copilot-code">{device!.userCode}</div>
          <p className="settings-hint" style={{ marginTop: 8 }}>2. Após autorizar no browser, clique em continuar:</p>
          <button className="settings-add-btn copilot-connect-btn" onClick={startPolling}>
            Já autorizei, continuar
          </button>
        </>
      ) : step === 'polling' ? (
        <p className="settings-hint">Aguardando autorização no GitHub…</p>
      ) : step === 'connected' ? (
        <div className="copilot-connected">
          {avatarUrl && <img src={avatarUrl} alt={username} className="copilot-avatar" />}
          <div className="copilot-user-info">
            <span className="copilot-username">@{username}</span>
            <span className="settings-hint">Modelos: {COPILOT_MODELS_STR.split(',').join(', ')}</span>
          </div>
          <button className="provider-remove" onClick={logout} title="Desconectar"><X size={12} strokeWidth={2.5} /></button>
        </div>
      ) : null}
    </div>
  );
}

export default memo(function SettingsModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('providers');
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [agentDraft, setAgentDraft] = useState<Partial<AgentConfig>>({});
  const [generating, setGenerating] = useState(false);
  const [copilotKey, setCopilotKey] = useState(0);

  // ── KODA routing ──────────────────────────────────────────────────────────
  const [kodaRouting, setKodaRouting] = useState<KodaRouting>(settings.kodaRouting ?? {});

  function updateKodaRouting(agent: 'code' | 'review' | 'git', patch: Partial<{ providerId: string; model: string }> | null) {
    const next: KodaRouting = { ...kodaRouting };
    if (patch === null) {
      delete next[agent];
    } else {
      next[agent] = { ...({ providerId: '', model: '' }), ...(next[agent] ?? {}), ...patch };
    }
    setKodaRouting(next);
    save({ ...settings, kodaRouting: next });
  }

  // ── KODA config (stored in ~/.koda/config.json via IPC) ───────────────────
  const [kodaConfig, setKodaConfig] = useState<KodaConfig>(DEFAULT_KODA_CONFIG);
  const [kodaSaving, setKodaSaving] = useState(false);

  useEffect(() => {
    (window.api as any).koda.getConfig().then((cfg: KodaConfig | null) => {
      if (cfg) setKodaConfig({ ...DEFAULT_KODA_CONFIG, ...cfg, tts: { ...DEFAULT_KODA_CONFIG.tts, ...(cfg.tts ?? {}) }, stt: { ...DEFAULT_KODA_CONFIG.stt, ...(cfg.stt ?? {}) } });
    }).catch(() => {});
  }, []);

  async function saveKodaConfig(next: KodaConfig) {
    setKodaConfig(next);
    setKodaSaving(true);
    await (window.api as any).koda.saveConfig(next).catch(() => {});
    setKodaSaving(false);
  }

  function patchTTS(patch: Partial<KodaConfig['tts']>) {
    saveKodaConfig({ ...kodaConfig, tts: { ...kodaConfig.tts, ...patch } });
  }
  function patchSTT(patch: Partial<KodaConfig['stt']>) {
    saveKodaConfig({ ...kodaConfig, stt: { ...kodaConfig.stt, ...patch } });
  }

  function save(s: AppSettings) {
    setSettings(s);
    persistSettings(s);
  }

  // ── providers ──────────────────────────────────────────────────────────────

  function updateProvider(id: string, patch: Partial<LLMProvider>) {
    save({ ...settings, providers: settings.providers.map(p => p.id === id ? { ...p, ...patch } : p) });
  }

  function addProvider() {
    const p: LLMProvider = { id: uid(), name: 'New Provider', apiKey: '', baseUrl: '', models: '', enabled: true };
    save({ ...settings, providers: [...settings.providers, p] });
  }

  function removeProvider(id: string) {
    save({ ...settings, providers: settings.providers.filter(p => p.id !== id) });
  }

  // ── agents ─────────────────────────────────────────────────────────────────

  function startCreate() {
    const draft: AgentConfig = { id: uid(), name: '', model: '', systemPrompt: '', skills: '' };
    setEditingAgent(draft);
    setAgentDraft(draft);
  }

  function startEdit(a: AgentConfig) {
    setEditingAgent(a);
    setAgentDraft({ ...a });
  }

  function saveAgent() {
    if (!agentDraft.name?.trim()) return;
    const a: AgentConfig = {
      id: agentDraft.id ?? uid(),
      name: agentDraft.name ?? '',
      model: agentDraft.model ?? '',
      systemPrompt: agentDraft.systemPrompt ?? '',
      skills: agentDraft.skills ?? '',
    };
    const exists = settings.agents.some(x => x.id === a.id);
    save({
      ...settings,
      agents: exists
        ? settings.agents.map(x => x.id === a.id ? a : x)
        : [...settings.agents, a],
    });
    setEditingAgent(null);
  }

  function deleteAgent(id: string) {
    save({ ...settings, agents: settings.agents.filter(a => a.id !== id) });
  }

  async function generateSystemPrompt() {
    const provider = settings.providers.find(p => p.enabled && p.apiKey && p.models);
    if (!provider) return;
    const model = provider.models.split(',')[0].trim();
    setGenerating(true);

    const userPrompt = `Generate a focused, efficient system prompt for an AI coding agent named "${agentDraft.name || 'Assistant'}"${agentDraft.skills ? ` specialized in: ${agentDraft.skills}` : ''}.
Requirements:
- Define the agent's role and expertise precisely
- Instruct it to always verify facts by reading actual files (never guess)
- Be concise (under 250 words), no generic filler phrases
- Include output format expectations
Return ONLY the system prompt text, nothing else.`;

    try {
      const isAnthropic = provider.baseUrl.includes('anthropic.com');

      let generated = '';
      if (isAnthropic) {
        const res = await fetch(`${provider.baseUrl}/v1/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': provider.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: userPrompt }] }),
        });
        const data = await res.json();
        generated = data.content?.[0]?.text ?? '';
      } else {
        const res = await fetch(`${provider.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${provider.apiKey}` },
          body: JSON.stringify({ model, max_tokens: 600, messages: [{ role: 'user', content: userPrompt }] }),
        });
        const data = await res.json();
        generated = data.choices?.[0]?.message?.content ?? '';
      }

      if (generated) setAgentDraft(d => ({ ...d, systemPrompt: generated.trim() }));
    } catch { /* silently fail */ }
    setGenerating(false);
  }

  const allModels = settings.providers
    .filter(p => p.enabled && p.models)
    .flatMap(p => p.models.split(',').map(m => m.trim()).filter(Boolean))
    .filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div
      className="modal-overlay"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="settings-modal">
        {/* header */}
        <div className="settings-header">
          <span className="settings-title"><Settings size={15} strokeWidth={1.75} /> Settings</span>
          <button className="settings-close" onClick={onClose} title="Close"><X size={16} strokeWidth={2} /></button>
        </div>

        {/* tabs */}
        <div className="settings-tabs">
          <button
            className={`settings-tab ${tab === 'providers' ? 'active' : ''}`}
            onClick={() => setTab('providers')}
          >
            <Server size={12} strokeWidth={2} /> AI Providers
          </button>
          <button
            className={`settings-tab ${tab === 'agents' ? 'active' : ''}`}
            onClick={() => setTab('agents')}
          >
            <Bot size={12} strokeWidth={2} /> Agents
          </button>
          <button
            className={`settings-tab ${tab === 'koda' ? 'active' : ''}`}
            onClick={() => setTab('koda')}
          >
            ⚡ KODA
          </button>
        </div>

        {/* body */}
        <div className="settings-body">
          {tab === 'providers' && (
            <div className="settings-section">
              <ClaudeCodeSection
                onProviderUpdated={() => setSettings(loadSettings())}
              />
              <CopilotSection
                key={copilotKey}
                onProviderUpdated={() => { setSettings(loadSettings()); setCopilotKey(k => k + 1); }}
              />
              {settings.providers.filter(p => p.id !== COPILOT_PROVIDER_ID && p.id !== CLAUDE_CODE_PROVIDER_ID).map(p => (
                <div key={p.id} className="provider-card">
                  <div className="provider-header">
                    <input
                      className="settings-input provider-name"
                      value={p.name}
                      onChange={e => updateProvider(p.id, { name: e.target.value })}
                      placeholder="Provider name"
                    />
                    <label className="toggle-label">
                      <input
                        type="checkbox"
                        checked={p.enabled}
                        onChange={e => updateProvider(p.id, { enabled: e.target.checked })}
                      />
                      Enabled
                    </label>
                    <button className="provider-remove" onClick={() => removeProvider(p.id)} title="Remove provider"><X size={12} strokeWidth={2.5} /></button>
                  </div>

                  <div className="settings-field">
                    <label className="settings-label">API Key</label>
                    <input
                      className="settings-input"
                      type="password"
                      placeholder="sk-…"
                      value={p.apiKey}
                      onChange={e => updateProvider(p.id, { apiKey: e.target.value })}
                    />
                  </div>

                  <div className="settings-field">
                    <label className="settings-label">Base URL</label>
                    <input
                      className="settings-input"
                      type="text"
                      placeholder="https://api.openai.com/v1"
                      value={p.baseUrl}
                      onChange={e => updateProvider(p.id, { baseUrl: e.target.value })}
                    />
                  </div>

                  <div className="settings-field">
                    <label className="settings-label">Models (comma-separated)</label>
                    <input
                      className="settings-input"
                      type="text"
                      placeholder="gpt-4o, gpt-4-turbo"
                      value={p.models}
                      onChange={e => updateProvider(p.id, { models: e.target.value })}
                    />
                  </div>
                </div>
              ))}
              <button className="settings-add-btn" onClick={addProvider}><Plus size={12} strokeWidth={2} /> Add Provider</button>
            </div>
          )}

          {tab === 'agents' && (
            <div className="settings-section">
              {editingAgent ? (
                <div className="agent-form">
                  <div className="settings-field">
                    <label className="settings-label">Agent Name</label>
                    <input
                      className="settings-input"
                      placeholder="e.g. Code Reviewer"
                      value={agentDraft.name ?? ''}
                      onChange={e => setAgentDraft(d => ({ ...d, name: e.target.value }))}
                      autoFocus
                    />
                  </div>

                  <div className="settings-field">
                    <label className="settings-label">Model</label>
                    {allModels.length > 0 ? (
                      <select
                        className="settings-input settings-select"
                        value={agentDraft.model ?? ''}
                        onChange={e => setAgentDraft(d => ({ ...d, model: e.target.value }))}
                      >
                        <option value="">Select a model…</option>
                        {allModels.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="settings-input"
                        placeholder="Add providers first to list models"
                        value={agentDraft.model ?? ''}
                        onChange={e => setAgentDraft(d => ({ ...d, model: e.target.value }))}
                      />
                    )}
                  </div>

                  <div className="settings-field">
                    <div className="settings-label-row">
                      <label className="settings-label">System Prompt</label>
                      <button
                        className="agent-generate-btn"
                        type="button"
                        onClick={generateSystemPrompt}
                        disabled={generating || !settings.providers.some(p => p.enabled && p.apiKey)}
                        title={settings.providers.some(p => p.enabled && p.apiKey) ? 'Generate with AI' : 'Configure a provider with an API key first'}
                      >
                        {generating
                          ? <><Loader2 size={10} strokeWidth={2} className="spin" /> Generating…</>
                          : <><Sparkles size={10} strokeWidth={2} /> Generate with AI</>
                        }
                      </button>
                    </div>
                    <textarea
                      className="settings-input settings-textarea"
                      placeholder="You are a helpful coding assistant focused on…"
                      value={agentDraft.systemPrompt ?? ''}
                      onChange={e => setAgentDraft(d => ({ ...d, systemPrompt: e.target.value }))}
                    />
                  </div>

                  <div className="settings-field">
                    <label className="settings-label">Skills (comma-separated)</label>
                    <input
                      className="settings-input"
                      placeholder="code-review, explain, refactor, test-generation"
                      value={agentDraft.skills ?? ''}
                      onChange={e => setAgentDraft(d => ({ ...d, skills: e.target.value }))}
                    />
                  </div>

                  <div className="agent-form-actions">
                    <button
                      className="settings-save-btn"
                      onClick={saveAgent}
                      disabled={!agentDraft.name?.trim()}
                    >
                      Save Agent
                    </button>
                    <button className="settings-cancel-btn" onClick={() => setEditingAgent(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {settings.agents.length === 0 && (
                    <div className="agents-empty">No agents yet. Create one to get started.</div>
                  )}
                  {settings.agents.map(a => (
                    <div key={a.id} className="agent-card">
                      <div className="agent-info">
                        <span className="agent-name">{a.name || '(unnamed)'}</span>
                        <span className="agent-model">{a.model || 'no model set'}</span>
                      </div>
                      <div className="agent-actions">
                        <button className="agent-btn" onClick={() => startEdit(a)}>Edit</button>
                        <button className="agent-btn danger" onClick={() => deleteAgent(a.id)}>Delete</button>
                      </div>
                    </div>
                  ))}
                  <button className="settings-add-btn" onClick={startCreate}><Plus size={12} strokeWidth={2} /> New Agent</button>
                </>
              )}
            </div>
          )}
          {tab === 'koda' && (
            <div className="settings-section">
              <div className="koda-settings-note">
                Saved to <code>~/.koda/config.json</code> — shared with the CLI.
              </div>

              {/* Model Routing */}
              <div className="provider-card">
                <div className="provider-header">
                  <span className="settings-section-title"><Brain size={13} strokeWidth={2} /> Model Routing</span>
                </div>
                <p className="settings-hint" style={{ marginBottom: 8 }}>
                  Assign specific models to each KODA agent. Leave empty to use the default provider.
                </p>

                {([
                  { key: 'code'   as const, label: 'Code Agent',   hint: 'Implementation, editing, file changes' },
                  { key: 'review' as const, label: 'Review Agent', hint: 'Code review, analysis, quality checks' },
                  { key: 'git'    as const, label: 'Git Agent',    hint: 'Commits, branches, push/pull' },
                ] as const).map(({ key, label, hint }) => {
                  const entry = kodaRouting[key];
                  const selectedProvider = settings.providers.find(p => p.id === entry?.providerId);
                  const availableModels = selectedProvider
                    ? selectedProvider.models.split(',').map(m => m.trim()).filter(Boolean)
                    : [];

                  return (
                    <div key={key} className="koda-routing-row">
                      <div className="koda-routing-label">
                        <span className="koda-routing-label-name">
                          {key === 'code'   && <span>⚡</span>}
                          {key === 'review' && <Search size={12} strokeWidth={2} />}
                          {key === 'git'    && <GitBranch size={12} strokeWidth={2} />}
                          {label}
                        </span>
                        <span className="settings-hint">{hint}</span>
                      </div>
                      <div className="koda-routing-selects">
                        <select
                          className="settings-input settings-select"
                          value={entry?.providerId ?? ''}
                          onChange={e => {
                            const pid = e.target.value;
                            if (!pid) { updateKodaRouting(key, null); return; }
                            const firstModel = settings.providers.find(p => p.id === pid)?.models.split(',')[0].trim() ?? '';
                            updateKodaRouting(key, { providerId: pid, model: firstModel });
                          }}
                        >
                          <option value="">— default —</option>
                          {settings.providers.filter(p => p.enabled && p.models).map(p => (
                            <option key={p.id} value={p.id}>{p.name}</option>
                          ))}
                        </select>

                        {entry && availableModels.length > 0 && (
                          <select
                            className="settings-input settings-select"
                            value={entry.model}
                            onChange={e => updateKodaRouting(key, { model: e.target.value })}
                          >
                            {availableModels.map(m => (
                              <option key={m} value={m}>{m}</option>
                            ))}
                          </select>
                        )}
                        {entry && availableModels.length === 0 && (
                          <input
                            className="settings-input"
                            placeholder="model name"
                            value={entry.model}
                            onChange={e => updateKodaRouting(key, { model: e.target.value })}
                          />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* TTS */}
              <div className="provider-card">
                <div className="provider-header">
                  <span className="settings-section-title"><Volume2 size={13} strokeWidth={2} /> Text-to-Speech (TTS)</span>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={kodaConfig.tts.enabled}
                      onChange={e => patchTTS({ enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                </div>

                <div className="settings-field">
                  <label className="settings-label">OpenAI API Key</label>
                  <input
                    className="settings-input"
                    type="password"
                    placeholder="sk-…"
                    value={kodaConfig.tts.apiKey}
                    onChange={e => patchTTS({ apiKey: e.target.value })}
                  />
                </div>

                <div className="settings-row">
                  <div className="settings-field" style={{ flex: 1 }}>
                    <label className="settings-label">Voice</label>
                    <select
                      className="settings-input settings-select"
                      value={kodaConfig.tts.voice}
                      onChange={e => patchTTS({ voice: e.target.value })}
                    >
                      {['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'].map(v => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </div>
                  <div className="settings-field" style={{ flex: 1 }}>
                    <label className="settings-label">Model</label>
                    <select
                      className="settings-input settings-select"
                      value={kodaConfig.tts.model}
                      onChange={e => patchTTS({ model: e.target.value })}
                    >
                      <option value="tts-1">tts-1 (faster)</option>
                      <option value="tts-1-hd">tts-1-hd (higher quality)</option>
                    </select>
                  </div>
                </div>

                <div className="settings-field">
                  <label className="settings-label">
                    Speed <span className="settings-label-value">{kodaConfig.tts.speed.toFixed(1)}×</span>
                  </label>
                  <input
                    type="range"
                    min="0.25" max="4.0" step="0.25"
                    value={kodaConfig.tts.speed}
                    onChange={e => patchTTS({ speed: parseFloat(e.target.value) })}
                    className="settings-range"
                  />
                </div>
              </div>

              {/* STT */}
              <div className="provider-card">
                <div className="provider-header">
                  <span className="settings-section-title"><Mic size={13} strokeWidth={2} /> Speech-to-Text (STT)</span>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={kodaConfig.stt.enabled}
                      onChange={e => patchSTT({ enabled: e.target.checked })}
                    />
                    Enabled
                  </label>
                </div>

                <div className="settings-field">
                  <label className="settings-label">OpenAI API Key</label>
                  <input
                    className="settings-input"
                    type="password"
                    placeholder="sk-… (can be the same as TTS)"
                    value={kodaConfig.stt.apiKey}
                    onChange={e => patchSTT({ apiKey: e.target.value })}
                  />
                  <span className="settings-hint">Uses Whisper-1 model for transcription</span>
                </div>
              </div>

              {kodaSaving && (
                <div className="settings-hint" style={{ textAlign: 'center', marginTop: 4 }}>
                  Saving…
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
