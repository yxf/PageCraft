import type { CustomTool } from './tools/custom-model';
export interface Version {
  id: string;
  prompt: string;
  script: string;
  css: string;
  steps: string[];
  createdAt: number;
}
export interface Craft {
  id: string;
  name: string;
  description: string;
  matches: string[];
  excludeMatches: string[];
  enabled: boolean;
  activeVersionId: string;
  versions: Version[];
  createdAt: number;
  updatedAt: number;
  deletedUntil?: number;
}
export type Provider = 'openai' | 'deepseek' | 'google' | 'claude';
export interface ProviderProfile {
  apiKey: string;
  model: string;
  consent: boolean;
}
export interface Settings extends ProviderProfile {
  provider: Provider;
  profiles: Partial<Record<Provider, ProviderProfile>>;
}
export interface Run {
  craftId: string;
  versionId: string;
  tabId: number;
  url: string;
  status: 'ok' | 'error' | 'refresh';
  at: number;
}
export interface Task {
  id: string;
  tabId: number;
  stage: string;
  startedAt: number;
  receivedChars?: number;
  lastResponseAt?: number;
  error?: string;
  craftId?: string;
}
export interface State {
  schemaVersion: 1;
  settings: Settings;
  crafts: Craft[];
  customTools: CustomTool[];
  runs: Run[];
  tasks: Record<string, Task>;
}
export interface Context {
  url: string;
  title: string;
  summary: string;
  truncated: boolean;
}
export interface Generated {
  name: string;
  description: string;
  script: string;
  css: string;
  steps: string[];
}
export const emptyState = (): State => ({
  schemaVersion: 1,
  settings: { provider: 'openai', profiles: {}, apiKey: '', model: '', consent: false },
  crafts: [],
  customTools: [],
  runs: [],
  tasks: {},
});
export const activeVersion = (craft: Craft) =>
  craft.versions.find((v) => v.id === craft.activeVersionId)!;
