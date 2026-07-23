// aiditor.ai built-in connection definitions.
;(function (aiditor) {
  'use strict'

  const ai = aiditor.ai = aiditor.ai || {}

  const openAiDefaults = {
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    defaultModel: '',
    stream: true,
  }

  const anthropicDefaults = {
    baseUrl: 'https://api.anthropic.com',
    apiKey: '',
    defaultModel: '',
    stream: true,
  }

  const localBridgeDefaults = {
    baseUrl: 'http://127.0.0.1:8787',
    apiKey: '',
    defaultModel: '',
    stream: true,
  }

  function connection(id, label, provider, authType, transportType, defaults, hints, order, capabilities) {
    ai.registerConnection(id, {
      label: label,
      provider: provider,
      auth: { type: authType },
      transport: { type: transportType },
      configDefaults: defaults,
      modelHints: hints || defaults.modelHints || [],
      order: order,
      capabilities: capabilities || {},
    })
  }

  connection('mock', 'Mock', 'mock', 'none', 'mock', { responsePrefix: 'Echo:', defaultModel: '', stream: false }, [], 10)
  connection('openai-api', 'OpenAI API', 'openai', 'apiKey', 'openai-compatible', openAiDefaults, ['gpt-5.1', 'gpt-4.1'], 110, { outputProtocol: 'native', toolArguments: 'strict' })
  connection('openai-codex', 'ChatGPT / Codex Auth', 'openai', 'subscriptionBridge', 'codex-bridge', { baseUrl: 'http://127.0.0.1:8787', defaultModel: 'gpt-5.5', stream: true }, ['gpt-5.5', 'gpt-5.5-pro', 'gpt-5.3-codex', 'gpt-5.3-codex-spark'], 115)
  connection('openrouter', 'OpenRouter', 'openrouter', 'apiKey', 'openai-compatible', { baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', defaultModel: '', stream: true }, ['anthropic/claude-sonnet-4.5', 'openai/gpt-5', 'google/gemini-2.5-pro'], 130)
  connection('groq', 'Groq', 'groq', 'apiKey', 'openai-compatible', { baseUrl: 'https://api.groq.com/openai/v1', apiKey: '', defaultModel: '', stream: true }, ['openai/gpt-oss-120b', 'openai/gpt-oss-20b', 'llama-3.3-70b-versatile'], 140)
  connection('mistral', 'Mistral', 'mistral', 'apiKey', 'openai-compatible', { baseUrl: 'https://api.mistral.ai/v1', apiKey: '', defaultModel: '', stream: true }, ['mistral-large-latest', 'mistral-medium-latest', 'codestral-latest'], 150)
  connection('xai', 'xAI', 'xai', 'apiKey', 'openai-compatible', { baseUrl: 'https://api.x.ai/v1', apiKey: '', defaultModel: '', stream: true }, ['grok-4', 'grok-code-fast-1'], 160)
  connection('deepseek', 'DeepSeek', 'deepseek', 'apiKey', 'openai-compatible', { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', defaultModel: '', stream: true }, ['deepseek-v4-flash', 'deepseek-v4-pro'], 170)
  connection('ollama', 'Ollama', 'ollama', 'none', 'openai-compatible', { baseUrl: 'http://127.0.0.1:11434/v1', apiKey: '', defaultModel: '', stream: true }, ['llama3.2', 'qwen2.5-coder', 'deepseek-r1'], 180)
  connection('custom-openai', 'Custom OpenAI Compatible', 'custom', 'apiKey', 'openai-compatible', { baseUrl: '', apiKey: '', defaultModel: '', stream: true }, [], 190)
  connection('anthropic-api', 'Anthropic API', 'anthropic', 'apiKey', 'anthropic', anthropicDefaults, ['claude-sonnet-4-5', 'claude-opus-4-1'], 210, { toolArguments: 'strict' })
  connection('claude-code', 'Claude Code Auth', 'anthropic', 'subscriptionBridge', 'local-bridge', { baseUrl: 'http://127.0.0.1:8787', apiKey: '', defaultModel: '', stream: true }, ['claude-sonnet-4-5', 'claude-opus-4-1'], 220)
  connection('local-bridge', 'Local Bridge', 'bridge', 'localBridge', 'local-bridge', localBridgeDefaults, [], 300)

  if (ai.loadCustomConnections) ai.loadCustomConnections()
  ai.setActiveConnection('mock')
})(window.aiditor = window.aiditor || {})
