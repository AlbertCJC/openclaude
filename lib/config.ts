import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import type { McpServer } from './mcp';

export type Provider = { id: string; name: string; baseURL: string; keyName: string; keysUrl?: string; example: string; local?: boolean };

// Same idea as free-claude-code's provider catalog: one *_API_KEY setting per provider, model = "<provider-id>/<model-id>".
export const PROVIDERS: Provider[] = [
  { id: 'open_router', name: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', keyName: 'OPENROUTER_API_KEY', keysUrl: 'https://openrouter.ai/keys', example: 'open_router/openrouter/free' },
  { id: 'groq', name: 'Groq', baseURL: 'https://api.groq.com/openai/v1', keyName: 'GROQ_API_KEY', keysUrl: 'https://console.groq.com/keys', example: 'groq/llama-3.3-70b-versatile' },
  { id: 'gemini', name: 'Google AI Studio (Gemini)', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai', keyName: 'GEMINI_API_KEY', keysUrl: 'https://aistudio.google.com/apikey', example: 'gemini/gemini-2.5-flash' },
  { id: 'nvidia_nim', name: 'NVIDIA NIM', baseURL: 'https://integrate.api.nvidia.com/v1', keyName: 'NVIDIA_NIM_API_KEY', keysUrl: 'https://build.nvidia.com/settings/api-keys', example: 'nvidia_nim/meta/llama-3.3-70b-instruct' },
  { id: 'cerebras', name: 'Cerebras', baseURL: 'https://api.cerebras.ai/v1', keyName: 'CEREBRAS_API_KEY', keysUrl: 'https://cloud.cerebras.ai', example: 'cerebras/llama-3.3-70b' },
  { id: 'mistral', name: 'Mistral', baseURL: 'https://api.mistral.ai/v1', keyName: 'MISTRAL_API_KEY', keysUrl: 'https://console.mistral.ai/api-keys', example: 'mistral/mistral-small-latest' },
  { id: 'deepseek', name: 'DeepSeek', baseURL: 'https://api.deepseek.com/v1', keyName: 'DEEPSEEK_API_KEY', keysUrl: 'https://platform.deepseek.com/api_keys', example: 'deepseek/deepseek-chat' },
  { id: 'together', name: 'Together AI', baseURL: 'https://api.together.xyz/v1', keyName: 'TOGETHER_API_KEY', keysUrl: 'https://api.together.ai/settings/api-keys', example: 'together/meta-llama/Llama-3.3-70B-Instruct-Turbo-Free' },
  { id: 'openai_api', name: 'OpenAI API', baseURL: 'https://api.openai.com/v1', keyName: 'OPENAI_API_KEY', keysUrl: 'https://platform.openai.com/api-keys', example: 'openai_api/gpt-4o-mini' },
  { id: 'ollama', name: 'Ollama (local)', baseURL: 'http://localhost:11434/v1', keyName: 'OLLAMA_API_KEY', example: 'ollama/qwen2.5', local: true },
  { id: 'lmstudio', name: 'LM Studio (local)', baseURL: 'http://localhost:1234/v1', keyName: 'LMSTUDIO_API_KEY', example: 'lmstudio/local-model', local: true },
];

// web_search providers; keys live in Config.keys under the same id. DuckDuckGo needs no key and is the fallback.
export const SEARCH_PROVIDERS: Provider[] = [
  { id: 'brave', name: 'Brave Search (web_search)', baseURL: 'https://api.search.brave.com/res/v1', keyName: 'BRAVE_API_KEY', keysUrl: 'https://api-dashboard.search.brave.com/app/keys', example: 'web_search' },
  { id: 'tavily', name: 'Tavily (web_search)', baseURL: 'https://api.tavily.com', keyName: 'TAVILY_API_KEY', keysUrl: 'https://app.tavily.com/home', example: 'web_search' },
];
export type SearchProvider = 'auto' | 'brave' | 'tavily' | 'duckduckgo';

export type Config = {
  keys: Record<string, string[]>;      // provider id -> numbered keys; key 1 is used first
  custom: Provider[];                  // Custom providers (base URL + keys)
  model: string;                       // "<provider-id>/<model-id>"
  workspace: string;
  mode: 'ask' | 'auto' | 'plan';
  effort: 'low' | 'medium' | 'high';
  mcpServers: Record<string, McpServer>;
  hooks: Record<string, unknown[]>;    // Claude Code settings.json hook format also accepted
  trustedWorkspaces: string[];         // project .claude/settings.json hooks only run here
  allowBash: string[];                 // command prefixes that skip approval
  search: SearchProvider;              // auto = first keyed provider, then DuckDuckGo
};

export const DATA = process.env.OPENCLAUDE_DATA || path.join(process.cwd(), 'data');
const FILE = path.join(DATA, 'config.json');
const DEFAULTS: Config = { keys: {}, custom: [], model: 'open_router/openrouter/free', workspace: os.homedir(), mode: 'ask', effort: 'medium', mcpServers: {}, hooks: {}, trustedWorkspaces: [], allowBash: [], search: 'auto' };

export async function loadConfig(): Promise<Config> {
  try { return { ...DEFAULTS, ...JSON.parse(await fs.readFile(FILE, 'utf8')) }; } catch { return { ...DEFAULTS }; }
}

export async function saveConfig(c: Config) {
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
}

export const allProviders = (c: Config) => [...PROVIDERS, ...c.custom];

export function resolveModel(c: Config, model: string) {
  const i = model.indexOf('/');
  const p = allProviders(c).find(x => x.id === model.slice(0, i));
  if (!p) throw new Error(`Unknown provider in model "${model}". Use <provider-id>/<model-id>.`);
  return { provider: p, modelId: model.slice(i + 1), keys: (c.keys[p.id] ?? []).filter(Boolean) };
}

export const mask = (k: string) => (k.length > 8 ? `${k.slice(0, 4)}…${k.slice(-4)}` : '••••');
