import React, { useState, memo } from 'react';

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

export interface AppSettings {
  providers: LLMProvider[];
  agents: AgentConfig[];
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

type Tab = 'providers' | 'agents';

export default memo(function SettingsModal({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>('providers');
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [editingAgent, setEditingAgent] = useState<AgentConfig | null>(null);
  const [agentDraft, setAgentDraft] = useState<Partial<AgentConfig>>({});
  const [generating, setGenerating] = useState(false);

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
          <span className="settings-title">⚙ Settings</span>
          <button className="settings-close" onClick={onClose} title="Close">✕</button>
        </div>

        {/* tabs */}
        <div className="settings-tabs">
          <button
            className={`settings-tab ${tab === 'providers' ? 'active' : ''}`}
            onClick={() => setTab('providers')}
          >
            AI Providers
          </button>
          <button
            className={`settings-tab ${tab === 'agents' ? 'active' : ''}`}
            onClick={() => setTab('agents')}
          >
            Agents
          </button>
        </div>

        {/* body */}
        <div className="settings-body">
          {tab === 'providers' && (
            <div className="settings-section">
              {settings.providers.map(p => (
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
                    <button className="provider-remove" onClick={() => removeProvider(p.id)} title="Remove provider">✕</button>
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
              <button className="settings-add-btn" onClick={addProvider}>+ Add Provider</button>
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
                        {generating ? '⏳ Generating…' : '✦ Generate with AI'}
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
                  <button className="settings-add-btn" onClick={startCreate}>+ New Agent</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
