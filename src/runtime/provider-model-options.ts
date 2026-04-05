export const PROVIDERS = [
  'openrouter',
  'anthropic',
  'openai',
  'google',
  'ollama',
  'mistral',
  'groq',
  'xai',
] as const;

export const STATIC_MODELS: Record<string, string[]> = {
  anthropic: [
    'claude-opus-4-20250514',
    'claude-sonnet-4-20250514',
    'claude-haiku-4-5-20251001',
  ],
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1', 'o1-mini', 'o3-mini'],
  openrouter: [
    'anthropic/claude-sonnet-4-20250514',
    'anthropic/claude-haiku-4-5-20251001',
    'openai/gpt-4o',
    'openai/o3-mini',
    'google/gemini-2.0-flash',
    'meta-llama/llama-3.1-70b-instruct',
    'mistralai/mistral-large',
    'deepseek/deepseek-chat-v3',
  ],
  google: ['gemini-2.0-flash', 'gemini-2.0-pro', 'gemini-1.5-pro'],
  ollama: ['llama3.1', 'mistral', 'codellama', 'mixtral'],
  mistral: [
    'mistral-large-latest',
    'mistral-medium-latest',
    'mistral-small-latest',
  ],
  groq: ['llama-3.1-70b-versatile', 'mixtral-8x7b-32768'],
  xai: ['grok-2', 'grok-2-mini'],
};
