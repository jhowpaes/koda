import fs from 'fs';
import path from 'path';
import os from 'os';

const CONFIG_PATH = path.join(os.homedir(), '.koda', 'config.json');

export interface AppTTSConfig {
  enabled: boolean;
  apiKey: string;
  voice: 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer';
  model: 'tts-1' | 'tts-1-hd';
  speed: number;
}

export interface AppSTTConfig {
  enabled: boolean;
  apiKey: string;
}

export interface AppConfig {
  tts: AppTTSConfig;
  stt: AppSTTConfig;
}

const DEFAULTS: AppConfig = {
  tts: { enabled: false, apiKey: '', voice: 'nova', model: 'tts-1', speed: 1.0 },
  stt: { enabled: false, apiKey: '' },
};

export function loadAppConfig(): AppConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    return {
      tts: { ...DEFAULTS.tts, ...(parsed.tts ?? {}) },
      stt: { ...DEFAULTS.stt, ...(parsed.stt ?? {}) },
    };
  } catch {
    return { tts: { ...DEFAULTS.tts }, stt: { ...DEFAULTS.stt } };
  }
}

export function saveAppConfig(config: AppConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8');
}
