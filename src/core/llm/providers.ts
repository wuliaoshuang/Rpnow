/**
 * Provider registry.
 *
 * ~38 providers, classified by what the transport actually needs:
 *
 *   OAI     — plain OpenAI-compatible; base URL + Bearer is enough.
 *   OAI-AUTH— OpenAI-shaped body, different auth header.
 *   NATIVE  — genuinely different request AND response (Anthropic, Gemini).
 *
 * `browserCors` reflects whether the endpoint sends CORS headers so a browser
 * may call it directly. This is *probed* data from the research notes, not a
 * guess: NovelAI, OpenAI, Ark and Groq block browser calls, so the UI warns and
 * the proxy plugin is used. Local servers work only if the user enables CORS on
 * their side.
 *
 * Model ids rotate constantly; these are seeds for the picker, never a limit —
 * the UI always allows a free-text model id and can populate from `/models`.
 */

export type ProviderCompat = 'oai' | 'oai-auth' | 'native';

export interface ProviderInfo {
  /** Registry key used by {@link LLMProviderAdapter.key}. */
  key: string;
  label: string;
  /** Grouping in the UI. */
  group: '国际' | '中国' | '聚合/推理平台' | '本地/自建' | '其他';
  compat: ProviderCompat;
  baseURL: string;
  /** Alternate endpoints (regional variants), shown as suggestions. */
  altBaseURLs?: string[];
  models: string[];
  /** Direct browser access possible. */
  browserCors: boolean;
  /** Works with an empty API key. */
  keyOptional?: boolean;
  /** Short note shown under the field. */
  note?: string;
  /** Suggested context window (tokens) used to compute the history budget. */
  defaultContext?: number;
}

export const PROVIDERS: ProviderInfo[] = [
  // ---------------------------------------------------------------- 国际
  {
    key: 'openai',
    label: 'OpenAI',
    group: '国际',
    compat: 'oai',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4o', 'o4-mini'],
    browserCors: false,
    note: '官方接口不允许浏览器直连，需要开启代理或使用中转地址。',
    defaultContext: 400000,
  },
  {
    key: 'anthropic',
    label: 'Anthropic Claude',
    group: '国际',
    compat: 'native',
    baseURL: 'https://api.anthropic.com',
    models: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5', 'claude-sonnet-5'],
    browserCors: true,
    note: '使用 x-api-key 鉴权，并会自动附带 anthropic-dangerous-direct-browser-access。',
    defaultContext: 200000,
  },
  {
    key: 'gemini',
    label: 'Google Gemini',
    group: '国际',
    compat: 'native',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-3-pro-preview'],
    browserCors: true,
    note: '原生 generateContent，思考内容以 parts[].thought 返回。',
    defaultContext: 1000000,
  },
  {
    key: 'xai',
    label: 'xAI Grok',
    group: '国际',
    compat: 'oai',
    baseURL: 'https://api.x.ai/v1',
    models: ['grok-4', 'grok-3-mini'],
    browserCors: true,
    defaultContext: 131072,
  },
  {
    key: 'mistral',
    label: 'Mistral AI',
    group: '国际',
    compat: 'oai',
    baseURL: 'https://api.mistral.ai/v1',
    models: ['mistral-large-latest', 'mistral-small-latest', 'codestral-latest'],
    browserCors: true,
    defaultContext: 131072,
  },
  {
    key: 'cohere',
    label: 'Cohere',
    group: '国际',
    compat: 'oai',
    baseURL: 'https://api.cohere.ai/compatibility/v1',
    models: ['command-a-03-2025', 'command-r-plus-08-2024'],
    browserCors: true,
    defaultContext: 128000,
  },
  {
    key: 'perplexity',
    label: 'Perplexity',
    group: '国际',
    compat: 'oai',
    baseURL: 'https://api.perplexity.ai',
    models: ['sonar', 'sonar-pro', 'sonar-reasoning'],
    browserCors: true,
    defaultContext: 127072,
  },
  {
    key: 'ai21',
    label: 'AI21 Jamba',
    group: '国际',
    compat: 'oai',
    baseURL: 'https://api.ai21.com/studio/v1',
    models: ['jamba-large-1.7', 'jamba-mini-1.7'],
    browserCors: true,
    defaultContext: 256000,
  },

  // ---------------------------------------------------------------- 中国
  {
    key: 'deepseek',
    label: 'DeepSeek 深度求索',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    browserCors: false,
    note: '推理模型会把思考过程放在 reasoning_content 字段。',
    defaultContext: 64000,
  },
  {
    key: 'moonshot',
    label: 'Moonshot Kimi',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://api.moonshot.cn/v1',
    altBaseURLs: ['https://api.moonshot.ai/v1'],
    models: ['kimi-k2.5', 'kimi-k2-thinking', 'moonshot-v1-128k'],
    browserCors: true,
    defaultContext: 262144,
  },
  {
    key: 'zhipu',
    label: '智谱 GLM',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-4.7', 'glm-4.5', 'glm-4-air'],
    browserCors: false,
    defaultContext: 128000,
  },
  {
    key: 'dashscope',
    label: '阿里云百炼 / 通义千问',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    altBaseURLs: ['https://dashscope-intl.aliyuncs.com/compatible-mode/v1'],
    models: ['qwen-max', 'qwen-plus', 'qwen3-235b-a22b'],
    browserCors: false,
    defaultContext: 131072,
  },
  {
    key: 'minimax',
    label: 'MiniMax',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://api.minimax.chat/v1',
    altBaseURLs: ['https://api.minimax.io/v1'],
    models: ['MiniMax-M2', 'MiniMax-Text-01'],
    browserCors: true,
    defaultContext: 200000,
  },
  {
    key: 'ark',
    label: '字节火山方舟（豆包）',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-1-6-250615', 'doubao-pro-32k'],
    browserCors: false,
    note: '模型名需填写控制台里的接入点或模型 ID。',
    defaultContext: 256000,
  },
  {
    key: 'qianfan',
    label: '百度千帆（文心）',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://qianfan.baidubce.com/v2',
    models: ['ernie-4.5-turbo-128k', 'ernie-4.0-8k'],
    browserCors: true,
    defaultContext: 131072,
  },
  {
    key: 'hunyuan',
    label: '腾讯混元',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://api.hunyuan.cloud.tencent.com/v1',
    models: ['hunyuan-turbos-latest', 'hunyuan-t1-latest'],
    browserCors: true,
    defaultContext: 32768,
  },
  {
    key: 'spark',
    label: '讯飞星火',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://spark-api-open.xf-yun.com/v1',
    models: ['4.0Ultra', 'generalv3.5'],
    browserCors: false,
    defaultContext: 32768,
  },
  {
    key: 'baichuan',
    label: '百川智能',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://api.baichuan-ai.com/v1',
    models: ['Baichuan4-Turbo', 'Baichuan4-Air'],
    browserCors: true,
    defaultContext: 32768,
  },
  {
    key: 'stepfun',
    label: '阶跃星辰 StepFun',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://api.stepfun.com/v1',
    models: ['step-2-16k', 'step-1-8k'],
    browserCors: false,
    defaultContext: 32768,
  },
  {
    key: 'siliconflow',
    label: '硅基流动 SiliconFlow',
    group: '中国',
    compat: 'oai',
    baseURL: 'https://api.siliconflow.cn/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen3-235B-A22B'],
    browserCors: true,
    note: '一个 Key 可用多家开源模型，适合角色扮演。',
    defaultContext: 131072,
  },

  // ------------------------------------------------------- 聚合/推理平台
  {
    key: 'openrouter',
    label: 'OpenRouter（聚合）',
    group: '聚合/推理平台',
    compat: 'oai',
    baseURL: 'https://openrouter.ai/api/v1',
    models: ['openrouter/auto', 'anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat'],
    browserCors: true,
    note: '支持浏览器直连，一个 Key 调用上百个模型。',
    defaultContext: 200000,
  },
  {
    key: 'groq',
    label: 'Groq',
    group: '聚合/推理平台',
    compat: 'oai',
    baseURL: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'],
    browserCors: false,
    defaultContext: 131072,
  },
  {
    key: 'together',
    label: 'Together AI',
    group: '聚合/推理平台',
    compat: 'oai',
    baseURL: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo', 'deepseek-ai/DeepSeek-V3'],
    browserCors: true,
    defaultContext: 131072,
  },
  {
    key: 'fireworks',
    label: 'Fireworks AI',
    group: '聚合/推理平台',
    compat: 'oai',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    models: ['accounts/fireworks/models/llama-v3p3-70b-instruct'],
    browserCors: false,
    defaultContext: 131072,
  },
  {
    key: 'cerebras',
    label: 'Cerebras',
    group: '聚合/推理平台',
    compat: 'oai',
    baseURL: 'https://api.cerebras.ai/v1',
    models: ['llama-3.3-70b', 'llama-4-scout-17b-16e-instruct'],
    browserCors: false,
    defaultContext: 131072,
  },
  {
    key: 'deepinfra',
    label: 'DeepInfra',
    group: '聚合/推理平台',
    compat: 'oai',
    baseURL: 'https://api.deepinfra.com/v1/openai',
    models: ['meta-llama/Meta-Llama-3.1-70B-Instruct'],
    browserCors: true,
    defaultContext: 131072,
  },
  {
    key: 'nebius',
    label: 'Nebius AI Studio',
    group: '聚合/推理平台',
    compat: 'oai',
    baseURL: 'https://api.studio.nebius.ai/v1',
    models: ['deepseek-ai/DeepSeek-V3', 'meta-llama/Llama-3.3-70B-Instruct'],
    browserCors: true,
    defaultContext: 131072,
  },
  {
    key: 'novita',
    label: 'Novita AI',
    group: '聚合/推理平台',
    compat: 'oai',
    baseURL: 'https://api.novita.ai/v3/openai',
    models: ['deepseek/deepseek-v3.2', 'zai-org/glm-4.7'],
    browserCors: true,
    defaultContext: 131072,
  },
  {
    key: 'hyperbolic',
    label: 'Hyperbolic',
    group: '聚合/推理平台',
    compat: 'oai',
    baseURL: 'https://api.hyperbolic.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct'],
    browserCors: true,
    defaultContext: 131072,
  },
  {
    key: 'nvidia',
    label: 'NVIDIA NIM',
    group: '聚合/推理平台',
    compat: 'oai',
    baseURL: 'https://integrate.api.nvidia.com/v1',
    models: ['meta/llama-3.3-70b-instruct', 'deepseek-ai/deepseek-r1'],
    browserCors: false,
    defaultContext: 131072,
  },
  {
    key: 'github',
    label: 'GitHub Models',
    group: '聚合/推理平台',
    compat: 'oai',
    baseURL: 'https://models.github.ai/inference',
    models: ['openai/gpt-4o', 'deepseek/DeepSeek-V3-0324'],
    browserCors: false,
    defaultContext: 128000,
  },
  {
    key: 'lingyiwanwu',
    label: '零一万物 Yi',
    group: '其他',
    compat: 'oai',
    baseURL: 'https://api.lingyiwanwu.com/v1',
    models: ['yi-large', 'yi-lightning'],
    browserCors: false,
    defaultContext: 16384,
  },

  // ------------------------------------------------------------ 本地/自建
  {
    key: 'ollama',
    label: 'Ollama（本地）',
    group: '本地/自建',
    compat: 'oai',
    baseURL: 'http://localhost:11434/v1',
    models: ['llama3.2', 'qwen2.5', 'mistral'],
    browserCors: true,
    keyOptional: true,
    note: '需要在 Ollama 设置里允许跨域：OLLAMA_ORIGINS=*',
    defaultContext: 32768,
  },
  {
    key: 'lmstudio',
    label: 'LM Studio（本地）',
    group: '本地/自建',
    compat: 'oai',
    baseURL: 'http://localhost:1234/v1',
    models: [],
    browserCors: true,
    keyOptional: true,
    note: '在 Server 设置中开启 CORS 后即可直连。',
    defaultContext: 32768,
  },
  {
    key: 'vllm',
    label: 'vLLM（自建）',
    group: '本地/自建',
    compat: 'oai',
    baseURL: 'http://localhost:8000/v1',
    models: [],
    browserCors: true,
    keyOptional: true,
    note: '自建服务默认开启 CORS，模型名用 --served-model-name 指定的值。',
    defaultContext: 32768,
  },
  {
    key: 'koboldcpp',
    label: 'KoboldCpp（本地）',
    group: '本地/自建',
    compat: 'oai',
    baseURL: 'http://localhost:5001/v1',
    models: [],
    browserCors: true,
    keyOptional: true,
    note: '同时提供 /api/v1/generate 原生接口和 OpenAI 兼容接口。',
    defaultContext: 8192,
  },
  {
    key: 'textgenwebui',
    label: 'text-generation-webui',
    group: '本地/自建',
    compat: 'oai',
    baseURL: 'http://localhost:5000/v1',
    models: [],
    browserCors: true,
    keyOptional: true,
    note: '启动时加 --api 开启接口。',
    defaultContext: 8192,
  },
  {
    key: 'custom',
    label: '自定义（OpenAI 兼容）',
    group: '本地/自建',
    compat: 'oai',
    baseURL: '',
    models: [],
    browserCors: true,
    note: '任意兼容 Chat Completions 的地址；填到 /v1 为止，不要加 /chat/completions。',
    defaultContext: 32768,
  },
];

export const PROVIDER_MAP = new Map(PROVIDERS.map((p) => [p.key, p]));

export function providerInfo(key: string): ProviderInfo | undefined {
  return PROVIDER_MAP.get(key);
}

/** Group providers for the picker UI, preserving declaration order. */
export function providersByGroup(): Array<{ group: string; items: ProviderInfo[] }> {
  const order: string[] = ['国际', '中国', '聚合/推理平台', '本地/自建', '其他'];
  const map = new Map<string, ProviderInfo[]>();
  for (const p of PROVIDERS) {
    const list = map.get(p.group) ?? [];
    list.push(p);
    map.set(p.group, list);
  }
  return order.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }));
}
