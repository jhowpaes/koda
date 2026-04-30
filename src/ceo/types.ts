export interface CeoStep {
  agent: string;
  tool: string;
  args: Record<string, unknown>;
  description: string;
}

export type TaskComplexity = 'simple' | 'moderate' | 'complex';

export interface CeoPlan {
  thinking?: string;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  complexity?: TaskComplexity;
  steps: CeoStep[];
  parallel: boolean;
}

export interface CeoResult {
  plan: CeoPlan;
  steps: Array<{ step: CeoStep; result: string; error?: string }>;
  summary: string;
}

// Progress events — used by Electron UI (Phase 5) to render live agent chats
export type ProgressEvent =
  | { type: 'plan';       plan: CeoPlan }
  | { type: 'step_start'; step: CeoStep; index: number; total: number }
  | { type: 'step_done';  step: CeoStep; index: number; result: string }
  | { type: 'step_error'; step: CeoStep; index: number; error: string }
  | { type: 'done';       summary: string };

export type OnProgress = (event: ProgressEvent) => void;
