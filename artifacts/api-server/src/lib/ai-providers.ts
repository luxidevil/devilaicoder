import { db, settingsTable } from "@workspace/db";
import { logger } from "./logger";

export type ProviderName =
  | "gemini"
  | "vertex"
  | "anthropic"
  | "openai"
  | "openrouter"
  | "groq"
  | "moonshot"
  | "deepseek"
  | "together"
  | "mistral"
  | "xai"
  | "cerebras"
  | "github"
  | "huggingface"
  | "cloudflare"
  | "sambanova"
  | "nvidia"
  | "fireworks"
  | "hyperbolic"
  | "perplexity"
  | "cohere"
  | "zhipu"
  | "qwen"
  | "pollinations"
  | "ollama"
  | "custom";

export type ApiStyle = "gemini" | "anthropic" | "openai-compatible";

export interface ProviderSettings {
  provider: ProviderName;
  apiKey: string;
  model: string;
  baseURL?: string;
}

export interface ToolPropertySchema {
  type: string;
  description?: string;
  items?: ToolPropertySchema;
  properties?: Record<string, ToolPropertySchema>;
  required?: string[];
  enum?: string[];
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, ToolPropertySchema>;
    required?: string[];
  };
}

export interface ChatImage {
  dataUrl: string;
  mimeType?: string;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
  images?: ChatImage[];
}

export interface StreamChunk {
  text?: string;
  done?: boolean;
  error?: string;
}

export interface UsageInfo {
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

// USD per 1 million tokens. Best-effort current pricing — used for the dashboard.
// Free providers (groq, cerebras, etc.) report 0.
export const PROVIDER_PRICING: Record<string, { in: number; out: number }> = {
  // OpenAI
  "gpt-4o": { in: 2.5, out: 10 },
  "gpt-4o-mini": { in: 0.15, out: 0.6 },
  "gpt-4.1": { in: 2.0, out: 8.0 },
  "gpt-4.1-mini": { in: 0.4, out: 1.6 },
  "o1": { in: 15.0, out: 60.0 },
  "o3-mini": { in: 1.1, out: 4.4 },
  // Anthropic
  "claude-3-5-sonnet-20241022": { in: 3.0, out: 15.0 },
  "claude-3-5-haiku-20241022": { in: 0.8, out: 4.0 },
  "claude-3-opus-20240229": { in: 15.0, out: 75.0 },
  "claude-sonnet-4-20250514": { in: 3.0, out: 15.0 },
  "claude-opus-4-20250514": { in: 15.0, out: 75.0 },
  // Gemini / Vertex
  "gemini-2.5-pro": { in: 1.25, out: 10.0 },
  "gemini-2.5-flash": { in: 0.075, out: 0.3 },
  "gemini-2.0-flash": { in: 0.075, out: 0.3 },
  "gemini-1.5-pro": { in: 1.25, out: 5.0 },
  "gemini-1.5-flash": { in: 0.075, out: 0.3 },
  // DeepSeek
  "deepseek-chat": { in: 0.14, out: 0.28 },
  "deepseek-reasoner": { in: 0.55, out: 2.19 },
  // Mistral
  "mistral-large-latest": { in: 2.0, out: 6.0 },
  "mistral-small-latest": { in: 0.2, out: 0.6 },
  // xAI
  "grok-2-latest": { in: 2.0, out: 10.0 },
  "grok-beta": { in: 5.0, out: 15.0 },
  // Perplexity
  "llama-3.1-sonar-large-128k-online": { in: 1.0, out: 1.0 },
  // Cohere
  "command-r-plus": { in: 2.5, out: 10.0 },
  "command-r": { in: 0.15, out: 0.6 },
};

export function computeCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const p = PROVIDER_PRICING[model];
  if (!p) return 0;
  return (tokensIn * p.in + tokensOut * p.out) / 1_000_000;
}

export interface AgentResponse {
  textParts: string[];
  toolCalls: { name: string; args: Record<string, any> }[];
  finishReason?: string;
  usage?: UsageInfo;
}

export interface ProviderModelMeta {
  value: string;
  label: string;
  free?: boolean;
  vision?: boolean;
  context?: number;
  recommended?: boolean;
}

export interface ProviderConfig {
  label: string;
  apiStyle: ApiStyle;
  defaultBaseURL?: string;
  baseURLEditable?: boolean;
  needsKey: boolean;
  defaultModel: string;
  signupURL: string;
  description: string;
  freeNote?: string;
  models: ProviderModelMeta[];
}

export const PROVIDER_CONFIGS: Record<ProviderName, ProviderConfig> = {
  gemini: {
    label: "Google Gemini (AI Studio)",
    apiStyle: "gemini",
    defaultBaseURL: "https://generativelanguage.googleapis.com/v1beta",
    baseURLEditable: true,
    needsKey: true,
    defaultModel: "gemini-2.5-flash",
    signupURL: "https://aistudio.google.com/app/apikey",
    description: "Google's flagship multimodal models. Generous free tier.",
    freeNote: "Free tier: 15 RPM on Flash, 2 RPM on Pro.",
    models: [
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Fast, Free)", free: true, vision: true, recommended: true },
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Most capable)", vision: true },
      { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", free: true, vision: true },
      { value: "gemini-2.0-flash-exp", label: "Gemini 2.0 Flash Exp", free: true, vision: true },
      { value: "gemini-1.5-pro", label: "Gemini 1.5 Pro (Legacy)", vision: true },
    ],
  },
  vertex: {
    label: "Google Vertex AI (GCP)",
    apiStyle: "gemini",
    defaultBaseURL: "https://aiplatform.googleapis.com/v1beta1/publishers/google",
    baseURLEditable: true,
    needsKey: true,
    defaultModel: "gemini-2.5-pro",
    signupURL: "https://console.cloud.google.com/vertex-ai",
    description: "Enterprise Gemini on GCP. Express Mode (API key) — paste your Vertex AI key, no project ID required.",
    freeNote: "Express Mode: free tier with quotas. Production tier billed by GCP — you pay all costs.",
    models: [
      { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro (Vertex)", vision: true, recommended: true },
      { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash (Vertex)", vision: true, recommended: true },
      { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", vision: true },
      { value: "gemini-2.0-flash-001", label: "Gemini 2.0 Flash 001", vision: true },
      { value: "gemini-2.0-flash-thinking-exp-01-21", label: "Gemini 2.0 Flash Thinking" },
      { value: "gemini-1.5-pro-002", label: "Gemini 1.5 Pro 002", vision: true },
      { value: "gemini-1.5-flash-002", label: "Gemini 1.5 Flash 002", vision: true },
      { value: "gemini-exp-1206", label: "Gemini Experimental 1206", vision: true },
    ],
  },
  anthropic: {
    label: "Anthropic Claude",
    apiStyle: "anthropic",
    needsKey: true,
    defaultModel: "claude-sonnet-4-20250514",
    signupURL: "https://console.anthropic.com",
    description: "Best-in-class for coding tasks. Claude Sonnet 4 + Opus 4.",
    models: [
      { value: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (Best balance)", vision: true, recommended: true },
      { value: "claude-opus-4-20250514", label: "Claude Opus 4 (Most capable)", vision: true },
      { value: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", vision: true },
      { value: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku (Fast)", vision: true },
    ],
  },
  openai: {
    label: "OpenAI",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.openai.com/v1",
    needsKey: true,
    defaultModel: "gpt-4o",
    signupURL: "https://platform.openai.com/api-keys",
    description: "GPT-4o, o3, o4-mini reasoning models.",
    models: [
      { value: "gpt-4o", label: "GPT-4o (Balanced)", vision: true, recommended: true },
      { value: "gpt-4o-mini", label: "GPT-4o Mini (Fast, cheap)", vision: true },
      { value: "gpt-4-turbo", label: "GPT-4 Turbo", vision: true },
      { value: "o3", label: "o3 (Reasoning)" },
      { value: "o4-mini", label: "o4-mini (Fast reasoning)" },
      { value: "o1", label: "o1 (Reasoning)" },
      { value: "o1-mini", label: "o1-mini" },
    ],
  },
  openrouter: {
    label: "OpenRouter",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://openrouter.ai/api/v1",
    needsKey: true,
    defaultModel: "moonshotai/kimi-k2:free",
    signupURL: "https://openrouter.ai/keys",
    description: "100+ models through one API. Tons of free options.",
    freeNote: "Free models marked :free have rate limits but no cost.",
    models: [
      { value: "moonshotai/kimi-k2:free", label: "Kimi K2 (Free)", free: true, recommended: true },
      { value: "moonshotai/kimi-dev-72b:free", label: "Kimi Dev 72B (Free)", free: true },
      { value: "deepseek/deepseek-chat-v3:free", label: "DeepSeek V3 (Free)", free: true, recommended: true },
      { value: "deepseek/deepseek-r1:free", label: "DeepSeek R1 Reasoning (Free)", free: true },
      { value: "deepseek/deepseek-r1-distill-llama-70b:free", label: "DeepSeek R1 Distill Llama 70B (Free)", free: true },
      { value: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B (Free)", free: true },
      { value: "qwen/qwen-2.5-coder-32b-instruct:free", label: "Qwen 2.5 Coder 32B (Free)", free: true },
      { value: "qwen/qwq-32b:free", label: "Qwen QwQ 32B Reasoning (Free)", free: true },
      { value: "google/gemini-2.0-flash-exp:free", label: "Gemini 2.0 Flash Exp (Free)", free: true, vision: true },
      { value: "mistralai/mistral-small-3.1-24b-instruct:free", label: "Mistral Small 3.1 24B (Free)", free: true, vision: true },
      { value: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (Paid)", vision: true },
      { value: "openai/gpt-4o", label: "GPT-4o (Paid)", vision: true },
      { value: "moonshotai/kimi-k2", label: "Kimi K2 (Paid)" },
    ],
  },
  groq: {
    label: "Groq",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.groq.com/openai/v1",
    needsKey: true,
    defaultModel: "moonshotai/kimi-k2-instruct",
    signupURL: "https://console.groq.com/keys",
    description: "Ridiculous speeds (200+ tok/s) on Llama, Kimi, Qwen — FREE.",
    freeNote: "Generous free tier: ~14k requests/day.",
    models: [
      { value: "moonshotai/kimi-k2-instruct", label: "Kimi K2 Instruct (Free, fast)", free: true, recommended: true },
      { value: "llama-3.3-70b-versatile", label: "Llama 3.3 70B (Free)", free: true, recommended: true },
      { value: "llama-3.1-8b-instant", label: "Llama 3.1 8B (Free, instant)", free: true },
      { value: "qwen-qwq-32b", label: "Qwen QwQ 32B Reasoning (Free)", free: true },
      { value: "deepseek-r1-distill-llama-70b", label: "DeepSeek R1 Distill Llama 70B (Free)", free: true },
      { value: "mixtral-8x7b-32768", label: "Mixtral 8x7B (Free)", free: true },
      { value: "gemma2-9b-it", label: "Gemma 2 9B (Free)", free: true },
    ],
  },
  moonshot: {
    label: "Moonshot (Kimi)",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.moonshot.ai/v1",
    needsKey: true,
    defaultModel: "kimi-k2-0905-preview",
    signupURL: "https://platform.moonshot.ai",
    description: "Direct Kimi access from Moonshot AI. Long context (200K+).",
    models: [
      { value: "kimi-k2-0905-preview", label: "Kimi K2 (Latest)", recommended: true },
      { value: "kimi-k2-turbo-preview", label: "Kimi K2 Turbo" },
      { value: "moonshot-v1-128k", label: "Moonshot v1 128k" },
      { value: "moonshot-v1-32k", label: "Moonshot v1 32k" },
      { value: "moonshot-v1-8k", label: "Moonshot v1 8k" },
    ],
  },
  deepseek: {
    label: "DeepSeek",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.deepseek.com/v1",
    needsKey: true,
    defaultModel: "deepseek-chat",
    signupURL: "https://platform.deepseek.com/api_keys",
    description: "Excellent reasoning + coding at very low cost.",
    models: [
      { value: "deepseek-chat", label: "DeepSeek V3 (Chat)", recommended: true },
      { value: "deepseek-reasoner", label: "DeepSeek R1 (Reasoning)" },
    ],
  },
  together: {
    label: "Together AI",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.together.xyz/v1",
    needsKey: true,
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    signupURL: "https://api.together.xyz/settings/api-keys",
    description: "Open-source models hosted at scale. $1 free credit.",
    models: [
      { value: "meta-llama/Llama-3.3-70B-Instruct-Turbo", label: "Llama 3.3 70B Turbo", recommended: true },
      { value: "Qwen/Qwen2.5-Coder-32B-Instruct", label: "Qwen 2.5 Coder 32B" },
      { value: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V3" },
      { value: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1" },
      { value: "moonshotai/Kimi-K2-Instruct", label: "Kimi K2 Instruct" },
      { value: "mistralai/Mixtral-8x22B-Instruct-v0.1", label: "Mixtral 8x22B" },
    ],
  },
  mistral: {
    label: "Mistral AI",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.mistral.ai/v1",
    needsKey: true,
    defaultModel: "mistral-large-latest",
    signupURL: "https://console.mistral.ai/api-keys",
    description: "European AI lab. Strong code + reasoning models.",
    models: [
      { value: "mistral-large-latest", label: "Mistral Large", recommended: true },
      { value: "mistral-small-latest", label: "Mistral Small" },
      { value: "codestral-latest", label: "Codestral (Code-tuned)" },
      { value: "open-mistral-nemo", label: "Mistral Nemo (Free tier)", free: true },
      { value: "pixtral-large-latest", label: "Pixtral Large (Vision)", vision: true },
    ],
  },
  xai: {
    label: "xAI (Grok)",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.x.ai/v1",
    needsKey: true,
    defaultModel: "grok-4",
    signupURL: "https://console.x.ai",
    description: "Elon's xAI. Grok models with real-time data.",
    models: [
      { value: "grok-4", label: "Grok 4 (Most capable)", recommended: true, vision: true },
      { value: "grok-4-mini", label: "Grok 4 Mini", vision: true },
      { value: "grok-3", label: "Grok 3" },
      { value: "grok-3-mini", label: "Grok 3 Mini" },
      { value: "grok-2-vision", label: "Grok 2 Vision", vision: true },
    ],
  },
  cerebras: {
    label: "Cerebras",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.cerebras.ai/v1",
    needsKey: true,
    defaultModel: "llama-3.3-70b",
    signupURL: "https://cloud.cerebras.ai",
    description: "World's fastest inference (1800+ tok/s). Free tier.",
    freeNote: "Free tier: 1M tokens/day on Llama models.",
    models: [
      { value: "llama-3.3-70b", label: "Llama 3.3 70B (Free, fast)", free: true, recommended: true },
      { value: "llama3.1-8b", label: "Llama 3.1 8B (Free)", free: true },
      { value: "qwen-3-32b", label: "Qwen 3 32B (Free)", free: true },
    ],
  },
  github: {
    label: "GitHub Models (Free)",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://models.inference.ai.azure.com",
    needsKey: true,
    defaultModel: "gpt-4o-mini",
    signupURL: "https://github.com/marketplace/models",
    description: "Free GPT-4o, o1, Llama, Phi, Mistral, Cohere via your GitHub PAT (models:read scope).",
    freeNote: "Free with GitHub account. Daily request limits per model tier (lower/higher/azure).",
    models: [
      { value: "gpt-4o", label: "GPT-4o (Free)", free: true, vision: true, recommended: true },
      { value: "gpt-4o-mini", label: "GPT-4o Mini (Free)", free: true, vision: true },
      { value: "o3-mini", label: "o3-mini (Free reasoning)", free: true },
      { value: "o1", label: "o1 (Free reasoning)", free: true },
      { value: "o1-mini", label: "o1-mini (Free)", free: true },
      { value: "Meta-Llama-3.1-405B-Instruct", label: "Llama 3.1 405B (Free)", free: true },
      { value: "Meta-Llama-3.1-70B-Instruct", label: "Llama 3.1 70B (Free)", free: true },
      { value: "Llama-3.3-70B-Instruct", label: "Llama 3.3 70B (Free)", free: true },
      { value: "Mistral-large-2407", label: "Mistral Large (Free)", free: true },
      { value: "Mistral-Nemo", label: "Mistral Nemo (Free)", free: true },
      { value: "Codestral-2501", label: "Codestral 2501 (Free)", free: true },
      { value: "Phi-3.5-MoE-instruct", label: "Phi 3.5 MoE (Free)", free: true },
      { value: "Phi-3.5-vision-instruct", label: "Phi 3.5 Vision (Free)", free: true, vision: true },
      { value: "Cohere-command-r-plus-08-2024", label: "Cohere Command R+ (Free)", free: true },
      { value: "DeepSeek-R1", label: "DeepSeek R1 (Free reasoning)", free: true },
    ],
  },
  huggingface: {
    label: "Hugging Face (Free)",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api-inference.huggingface.co/v1",
    needsKey: true,
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
    signupURL: "https://huggingface.co/settings/tokens",
    description: "Serverless inference for thousands of OSS models. Generous free tier.",
    freeNote: "Free with HF token (read scope). Rate-limited but unlimited usage.",
    models: [
      { value: "meta-llama/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B (Free)", free: true, recommended: true },
      { value: "Qwen/Qwen2.5-Coder-32B-Instruct", label: "Qwen 2.5 Coder 32B (Free)", free: true, recommended: true },
      { value: "Qwen/Qwen2.5-72B-Instruct", label: "Qwen 2.5 72B (Free)", free: true },
      { value: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V3 (Free)", free: true },
      { value: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1 (Free)", free: true },
      { value: "meta-llama/Llama-3.2-11B-Vision-Instruct", label: "Llama 3.2 11B Vision (Free)", free: true, vision: true },
      { value: "mistralai/Mistral-7B-Instruct-v0.3", label: "Mistral 7B (Free)", free: true },
      { value: "HuggingFaceH4/zephyr-7b-beta", label: "Zephyr 7B (Free)", free: true },
    ],
  },
  cloudflare: {
    label: "Cloudflare Workers AI",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.cloudflare.com/client/v4/accounts/YOUR_ACCOUNT_ID/ai/v1",
    baseURLEditable: true,
    needsKey: true,
    defaultModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    signupURL: "https://dash.cloudflare.com/profile/api-tokens",
    description: "Edge inference. Free tier: 10k requests/day. Replace YOUR_ACCOUNT_ID in the base URL with your Cloudflare account ID.",
    freeNote: "Free: 10,000 neurons/day across all models. Paste your CF account ID into the base URL.",
    models: [
      { value: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B Fast (Free)", free: true, recommended: true },
      { value: "@cf/meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B (Free)", free: true },
      { value: "@cf/meta/llama-3.1-8b-instruct-fast", label: "Llama 3.1 8B Fast (Free)", free: true },
      { value: "@cf/qwen/qwen2.5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B (Free)", free: true },
      { value: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", label: "DeepSeek R1 Distill 32B (Free)", free: true },
      { value: "@cf/meta/llama-3.2-11b-vision-instruct", label: "Llama 3.2 Vision (Free)", free: true, vision: true },
      { value: "@cf/mistral/mistral-small-3.1-24b-instruct", label: "Mistral Small 3.1 (Free)", free: true },
      { value: "@cf/google/gemma-3-12b-it", label: "Gemma 3 12B (Free)", free: true, vision: true },
    ],
  },
  sambanova: {
    label: "SambaNova Cloud",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.sambanova.ai/v1",
    needsKey: true,
    defaultModel: "Meta-Llama-3.3-70B-Instruct",
    signupURL: "https://cloud.sambanova.ai",
    description: "Ultra-fast Llama / DeepSeek inference (200+ tok/s) on RDU chips. Free tier.",
    freeNote: "Free: generous limits on Llama 3.3 70B, DeepSeek R1, DeepSeek V3.",
    models: [
      { value: "Meta-Llama-3.3-70B-Instruct", label: "Llama 3.3 70B (Free, fast)", free: true, recommended: true },
      { value: "Meta-Llama-3.1-405B-Instruct", label: "Llama 3.1 405B (Free)", free: true },
      { value: "Meta-Llama-3.2-90B-Vision-Instruct", label: "Llama 3.2 90B Vision (Free)", free: true, vision: true },
      { value: "DeepSeek-R1", label: "DeepSeek R1 (Free)", free: true },
      { value: "DeepSeek-V3-0324", label: "DeepSeek V3 (Free)", free: true },
      { value: "Qwen2.5-Coder-32B-Instruct", label: "Qwen 2.5 Coder 32B (Free)", free: true },
      { value: "QwQ-32B-Preview", label: "QwQ 32B Reasoning (Free)", free: true },
    ],
  },
  nvidia: {
    label: "NVIDIA NIM",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://integrate.api.nvidia.com/v1",
    needsKey: true,
    defaultModel: "meta/llama-3.3-70b-instruct",
    signupURL: "https://build.nvidia.com",
    description: "NVIDIA-hosted inference with free credits on signup (1000 personal-use requests).",
    freeNote: "Free: 1000 credits on signup, then per-request pricing.",
    models: [
      { value: "meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B", free: true, recommended: true },
      { value: "meta/llama-3.1-405b-instruct", label: "Llama 3.1 405B", free: true },
      { value: "deepseek-ai/deepseek-r1", label: "DeepSeek R1", free: true },
      { value: "qwen/qwen2.5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B", free: true },
      { value: "nvidia/llama-3.1-nemotron-70b-instruct", label: "Nemotron 70B", free: true },
      { value: "mistralai/mixtral-8x22b-instruct-v0.1", label: "Mixtral 8x22B" },
      { value: "google/gemma-2-27b-it", label: "Gemma 2 27B" },
    ],
  },
  fireworks: {
    label: "Fireworks AI",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.fireworks.ai/inference/v1",
    needsKey: true,
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
    signupURL: "https://fireworks.ai/api-keys",
    description: "Fast OSS model inference. $1 free credit on signup, then per-token billing.",
    models: [
      { value: "accounts/fireworks/models/llama-v3p3-70b-instruct", label: "Llama 3.3 70B", recommended: true },
      { value: "accounts/fireworks/models/qwen2p5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B" },
      { value: "accounts/fireworks/models/deepseek-r1", label: "DeepSeek R1" },
      { value: "accounts/fireworks/models/deepseek-v3", label: "DeepSeek V3" },
      { value: "accounts/fireworks/models/mixtral-8x22b-instruct", label: "Mixtral 8x22B" },
      { value: "accounts/fireworks/models/llama-v3p2-90b-vision-instruct", label: "Llama 3.2 90B Vision", vision: true },
    ],
  },
  hyperbolic: {
    label: "Hyperbolic",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.hyperbolic.xyz/v1",
    needsKey: true,
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct",
    signupURL: "https://app.hyperbolic.xyz",
    description: "Cheap OSS inference. $1 free credit + free tier on Llama 3.3 70B.",
    freeNote: "Free tier on Llama 3.3 70B; $1 signup credit.",
    models: [
      { value: "meta-llama/Llama-3.3-70B-Instruct", label: "Llama 3.3 70B (Free)", free: true, recommended: true },
      { value: "Qwen/Qwen2.5-Coder-32B-Instruct", label: "Qwen 2.5 Coder 32B (Free)", free: true },
      { value: "deepseek-ai/DeepSeek-V3", label: "DeepSeek V3" },
      { value: "deepseek-ai/DeepSeek-R1", label: "DeepSeek R1" },
      { value: "Qwen/QwQ-32B", label: "Qwen QwQ 32B Reasoning" },
      { value: "meta-llama/Meta-Llama-3.1-405B-Instruct", label: "Llama 3.1 405B" },
    ],
  },
  perplexity: {
    label: "Perplexity (Online)",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.perplexity.ai",
    needsKey: true,
    defaultModel: "sonar",
    signupURL: "https://www.perplexity.ai/settings/api",
    description: "LLMs with built-in web search. Sonar models cite live sources by default.",
    models: [
      { value: "sonar", label: "Sonar (Online search)", recommended: true },
      { value: "sonar-pro", label: "Sonar Pro (Best search)" },
      { value: "sonar-reasoning", label: "Sonar Reasoning" },
      { value: "sonar-reasoning-pro", label: "Sonar Reasoning Pro" },
      { value: "sonar-deep-research", label: "Sonar Deep Research" },
    ],
  },
  cohere: {
    label: "Cohere",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://api.cohere.ai/compatibility/v1",
    needsKey: true,
    defaultModel: "command-r-plus-08-2024",
    signupURL: "https://dashboard.cohere.com/api-keys",
    description: "Cohere Command R+ via OpenAI-compatibility endpoint. Free trial keys available.",
    freeNote: "Free trial: 1000 calls/month rate-limited.",
    models: [
      { value: "command-r-plus-08-2024", label: "Command R+ 08-2024 (Free)", recommended: true, free: true },
      { value: "command-r-08-2024", label: "Command R 08-2024 (Free)", free: true },
      { value: "command-r7b-12-2024", label: "Command R7B (Free)", free: true },
      { value: "c4ai-aya-expanse-32b", label: "Aya Expanse 32B (Free)", free: true },
      { value: "command-a-03-2025", label: "Command A (Latest)" },
    ],
  },
  zhipu: {
    label: "Zhipu GLM",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://open.bigmodel.cn/api/paas/v4",
    needsKey: true,
    defaultModel: "glm-4-flash",
    signupURL: "https://bigmodel.cn",
    description: "GLM-4 from Zhipu AI. glm-4-flash is fully free. Strong coding ability.",
    freeNote: "glm-4-flash and glm-4-flashx are completely free, no quota.",
    models: [
      { value: "glm-4-flash", label: "GLM-4 Flash (Free)", free: true, recommended: true },
      { value: "glm-4-flashx", label: "GLM-4 FlashX (Free, faster)", free: true },
      { value: "glm-4-plus", label: "GLM-4 Plus" },
      { value: "glm-4-air", label: "GLM-4 Air" },
      { value: "glm-4-long", label: "GLM-4 Long (1M context)" },
      { value: "glm-4v-plus", label: "GLM-4V Plus (Vision)", vision: true },
      { value: "codegeex-4", label: "CodeGeeX-4 (Coding)" },
    ],
  },
  qwen: {
    label: "Qwen (DashScope)",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    baseURLEditable: true,
    needsKey: true,
    defaultModel: "qwen-plus",
    signupURL: "https://dashscope.console.aliyun.com/apiKey",
    description: "Alibaba's Qwen via DashScope. Free quota on most models. Use intl endpoint outside China.",
    freeNote: "Free quota on Qwen Turbo, Qwen Plus, Qwen 2.5 Coder, QwQ.",
    models: [
      { value: "qwen-plus", label: "Qwen Plus (Free)", recommended: true, free: true },
      { value: "qwen-max", label: "Qwen Max (Most capable)" },
      { value: "qwen-turbo", label: "Qwen Turbo (Free, fast)", free: true },
      { value: "qwen2.5-coder-32b-instruct", label: "Qwen 2.5 Coder 32B (Free)", free: true },
      { value: "qwen2.5-72b-instruct", label: "Qwen 2.5 72B (Free)", free: true },
      { value: "qwq-32b-preview", label: "QwQ 32B Reasoning (Free)", free: true },
      { value: "qwen-vl-plus", label: "Qwen VL Plus (Vision, Free)", vision: true, free: true },
      { value: "qwen-vl-max", label: "Qwen VL Max (Vision)", vision: true },
    ],
  },
  pollinations: {
    label: "Pollinations (No-key Free)",
    apiStyle: "openai-compatible",
    defaultBaseURL: "https://text.pollinations.ai/openai",
    needsKey: false,
    defaultModel: "openai-large",
    signupURL: "https://pollinations.ai",
    description: "Anonymous access to GPT-4o, Gemini, DeepSeek, Llama, Mistral. No signup, no key.",
    freeNote: "Completely free, anonymous. Best-effort uptime — use as a fallback.",
    models: [
      { value: "openai-large", label: "OpenAI GPT-4o (Free)", free: true, recommended: true },
      { value: "openai", label: "OpenAI GPT-4o-mini (Free)", free: true },
      { value: "openai-reasoning", label: "OpenAI o3-mini (Free)", free: true },
      { value: "deepseek", label: "DeepSeek V3 (Free)", free: true },
      { value: "deepseek-reasoner", label: "DeepSeek R1 (Free)", free: true },
      { value: "qwen-coder", label: "Qwen Coder (Free)", free: true },
      { value: "llama", label: "Llama 3.3 70B (Free)", free: true },
      { value: "mistral", label: "Mistral (Free)", free: true },
      { value: "gemini", label: "Gemini 2.0 (Free)", free: true, vision: true },
    ],
  },
  ollama: {
    label: "Ollama (Local)",
    apiStyle: "openai-compatible",
    defaultBaseURL: "http://localhost:11434/v1",
    baseURLEditable: true,
    needsKey: false,
    defaultModel: "llama3.2",
    signupURL: "https://ollama.ai",
    description: "Run any open model locally. Zero cost, full privacy.",
    models: [
      { value: "llama3.2", label: "Llama 3.2", free: true },
      { value: "qwen2.5-coder:32b", label: "Qwen 2.5 Coder 32B", free: true, recommended: true },
      { value: "deepseek-coder-v2", label: "DeepSeek Coder v2", free: true },
      { value: "mistral", label: "Mistral 7B", free: true },
      { value: "gemma2", label: "Gemma 2", free: true },
    ],
  },
  custom: {
    label: "Custom (OpenAI-compatible)",
    apiStyle: "openai-compatible",
    baseURLEditable: true,
    needsKey: true,
    defaultModel: "",
    signupURL: "",
    description: "Any OpenAI-compatible endpoint. Set your own base URL + model.",
    models: [],
  },
};

export const PROVIDER_NAMES: ProviderName[] = Object.keys(PROVIDER_CONFIGS) as ProviderName[];

export const PROVIDER_MODELS: Record<ProviderName, { value: string; label: string }[]> =
  Object.fromEntries(
    PROVIDER_NAMES.map((p) => [p, PROVIDER_CONFIGS[p].models.map((m) => ({ value: m.value, label: m.label }))])
  ) as Record<ProviderName, { value: string; label: string }[]>;

let cachedSettings: Record<string, string> = {};
let cacheTime = 0;
let cacheResolved = false;
const CACHE_TTL = 30_000;

export function invalidateSettingsCache() {
  cacheTime = 0;
  cacheResolved = false;
}

async function loadAllSettings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (cacheResolved && now - cacheTime < CACHE_TTL) return cachedSettings;
  const rows = await db.select().from(settingsTable);
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  cachedSettings = map;
  cacheTime = now;
  cacheResolved = true;
  return map;
}

const ENV_KEY_MAP: Record<ProviderName, string> = {
  gemini: "GOOGLE_API_KEY",
  vertex: "VERTEX_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  openrouter: "OPENROUTER_API_KEY",
  groq: "GROQ_API_KEY",
  moonshot: "MOONSHOT_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  together: "TOGETHER_API_KEY",
  mistral: "MISTRAL_API_KEY",
  xai: "XAI_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  github: "GITHUB_MODELS_TOKEN",
  huggingface: "HUGGINGFACE_API_KEY",
  cloudflare: "CLOUDFLARE_API_KEY",
  sambanova: "SAMBANOVA_API_KEY",
  nvidia: "NVIDIA_API_KEY",
  fireworks: "FIREWORKS_API_KEY",
  hyperbolic: "HYPERBOLIC_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  cohere: "COHERE_API_KEY",
  zhipu: "ZHIPU_API_KEY",
  qwen: "DASHSCOPE_API_KEY",
  pollinations: "POLLINATIONS_API_KEY",
  ollama: "OLLAMA_API_KEY",
  custom: "CUSTOM_API_KEY",
};

function settingKeyForApiKey(p: ProviderName): string {
  return `${p}_api_key`;
}

function settingKeyForBaseURL(p: ProviderName): string {
  return `${p}_base_url`;
}

export async function getProviderSettingsByName(name: ProviderName): Promise<ProviderSettings | null> {
  const s = await loadAllSettings();
  const cfg = PROVIDER_CONFIGS[name];
  if (!cfg) return null;

  const apiKey = s[settingKeyForApiKey(name)] || process.env[ENV_KEY_MAP[name]] || "";
  if (cfg.needsKey && !apiKey) return null;

  const model = s[`${name}_model`] || cfg.defaultModel;
  if (!model) return null;

  const baseURL = s[settingKeyForBaseURL(name)] || cfg.defaultBaseURL;

  return { provider: name, apiKey, model, baseURL };
}

export async function getActiveProvider(): Promise<ProviderSettings | null> {
  const s = await loadAllSettings();
  const provider = (s["ai_provider"] as ProviderName) ?? "gemini";

  const cfg = PROVIDER_CONFIGS[provider];
  if (!cfg) return null;

  const apiKey = s[settingKeyForApiKey(provider)] || process.env[ENV_KEY_MAP[provider]] || "";
  if (cfg.needsKey && !apiKey) return null;

  const model = s["ai_model"] || s[`${provider}_model`] || cfg.defaultModel;
  if (!model) return null;

  const baseURL = s[settingKeyForBaseURL(provider)] || cfg.defaultBaseURL;

  return { provider, apiKey, model, baseURL };
}

export async function getFallbackProvider(): Promise<ProviderSettings | null> {
  const s = await loadAllSettings();
  const fb = s["ai_fallback_provider"] as ProviderName | undefined;
  if (!fb || !PROVIDER_CONFIGS[fb]) return null;
  return getProviderSettingsByName(fb);
}

// ============================================================================
// Tool format converters
// ============================================================================

function convertPropGemini(v: any): any {
  const out: any = { type: v.type.toUpperCase() };
  if (v.description) out.description = v.description;
  if (v.items) out.items = convertPropGemini(v.items);
  if (v.properties) {
    out.properties = Object.fromEntries(
      Object.entries(v.properties).map(([k, pv]: [string, any]) => [k, convertPropGemini(pv)])
    );
  }
  if (v.required) out.required = v.required;
  return out;
}

function geminiToolFormat(tools: ToolDeclaration[]) {
  return tools.map((t) => {
    const params: any = { type: "OBJECT" };
    const propEntries = Object.entries(t.parameters.properties);
    if (propEntries.length > 0) {
      params.properties = Object.fromEntries(propEntries.map(([k, v]) => [k, convertPropGemini(v)]));
    }
    if (t.parameters.required && t.parameters.required.length > 0) {
      params.required = t.parameters.required;
    }
    return { name: t.name, description: t.description, parameters: params };
  });
}

function convertPropJsonSchema(v: any): any {
  const t = v.type?.toLowerCase?.() ?? "string";
  const out: any = {
    type: t === "number" ? "number" : t === "boolean" ? "boolean" : t === "array" ? "array" : t === "object" ? "object" : "string",
  };
  if (v.description) out.description = v.description;
  if (v.items) out.items = convertPropJsonSchema(v.items);
  if (v.properties) {
    out.properties = Object.fromEntries(
      Object.entries(v.properties).map(([k, pv]: [string, any]) => [k, convertPropJsonSchema(pv)])
    );
  }
  if (v.required) out.required = v.required;
  return out;
}

function openaiToolFormat(tools: ToolDeclaration[]) {
  return tools.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          Object.entries(t.parameters.properties).map(([k, v]) => [k, convertPropJsonSchema(v)])
        ),
        required: t.parameters.required ?? [],
      },
    },
  }));
}

function anthropicToolFormat(tools: ToolDeclaration[]) {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: {
      type: "object" as const,
      properties: Object.fromEntries(
        Object.entries(t.parameters.properties).map(([k, v]) => [k, convertPropJsonSchema(v)])
      ),
      required: t.parameters.required ?? [],
    },
  }));
}

// ============================================================================
// Vision helpers — convert dataUrl to provider-specific format
// ============================================================================

function dataUrlParts(dataUrl: string): { mimeType: string; data: string } {
  const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
  if (m) return { mimeType: m[1] || "image/png", data: m[2] || "" };
  // Plain URL — return empty data, pass URL via mimeType field for openai-compatible
  return { mimeType: "image/url", data: dataUrl };
}

// ============================================================================
// streamChat — text-only chat streaming with provider dispatch
// ============================================================================

export async function streamChat(
  settings: ProviderSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<StreamChunk>> {
  const cfg = PROVIDER_CONFIGS[settings.provider];
  switch (cfg.apiStyle) {
    case "gemini":
      return streamGeminiChat(settings, systemPrompt, messages, signal);
    case "anthropic":
      return streamAnthropicChat(settings, systemPrompt, messages, signal);
    case "openai-compatible":
      return streamOpenAICompatChat(settings, systemPrompt, messages, signal);
  }
}

function makeErrorStream(msg: string): ReadableStream<StreamChunk> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue({ error: msg });
      controller.enqueue({ done: true });
      controller.close();
    },
  });
}

async function streamGeminiChat(
  settings: ProviderSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<StreamChunk>> {
  const contents = messages.map((m) => {
    const parts: any[] = [];
    if (m.images?.length) {
      for (const img of m.images) {
        const { mimeType, data } = dataUrlParts(img.dataUrl);
        if (mimeType !== "image/url" && data) {
          parts.push({ inlineData: { mimeType: img.mimeType || mimeType, data } });
        }
      }
    }
    if (m.content) parts.push({ text: m.content });
    return { role: m.role === "assistant" ? "model" : "user", parts: parts.length ? parts : [{ text: m.content || "" }] };
  });

  const geminiBase =
    settings.baseURL ||
    PROVIDER_CONFIGS[settings.provider]?.defaultBaseURL ||
    "https://generativelanguage.googleapis.com/v1beta";
  const response = await fetch(
    `${geminiBase}/models/${settings.model}:streamGenerateContent?alt=sse&key=${settings.apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal,
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { maxOutputTokens: 65536, temperature: 0.3 },
      }),
    }
  );

  if (!response.ok) {
    const errText = await response.text();
    return makeErrorStream(`${PROVIDER_CONFIGS[settings.provider]?.label ?? "Gemini"} API error ${response.status}: ${errText.slice(0, 300)}`);
  }

  return parseSSEStream(response, (data) => {
    try {
      const parsed = JSON.parse(data);
      const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
      return text ? { text } : null;
    } catch {
      return null;
    }
  });
}

async function streamAnthropicChat(
  settings: ProviderSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<StreamChunk>> {
  const anthropicMessages = messages.map((m) => {
    const role = m.role === "user" ? ("user" as const) : ("assistant" as const);
    if (m.images?.length) {
      const blocks: any[] = [];
      for (const img of m.images) {
        const { mimeType, data } = dataUrlParts(img.dataUrl);
        if (mimeType !== "image/url" && data) {
          blocks.push({ type: "image", source: { type: "base64", media_type: img.mimeType || mimeType, data } });
        } else {
          blocks.push({ type: "image", source: { type: "url", url: img.dataUrl } });
        }
      }
      if (m.content) blocks.push({ type: "text", text: m.content });
      return { role, content: blocks };
    }
    return { role, content: m.content };
  });

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": settings.apiKey,
      "anthropic-version": "2023-06-01",
    },
    signal,
    body: JSON.stringify({
      model: settings.model,
      max_tokens: 16384,
      system: systemPrompt,
      messages: anthropicMessages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    return makeErrorStream(`Anthropic API error ${response.status}: ${errText.slice(0, 300)}`);
  }

  return parseSSEStream(response, (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === "content_block_delta" && parsed.delta?.text) return { text: parsed.delta.text };
      if (parsed.type === "message_stop") return { done: true };
      return null;
    } catch {
      return null;
    }
  });
}

async function streamOpenAICompatChat(
  settings: ProviderSettings,
  systemPrompt: string,
  messages: ChatMessage[],
  signal?: AbortSignal
): Promise<ReadableStream<StreamChunk>> {
  const baseURL = settings.baseURL || PROVIDER_CONFIGS[settings.provider].defaultBaseURL || "https://api.openai.com/v1";
  const oaiMessages: any[] = [{ role: "system", content: systemPrompt }];
  for (const m of messages) {
    if (m.images?.length) {
      const content: any[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const img of m.images) {
        content.push({ type: "image_url", image_url: { url: img.dataUrl } });
      }
      oaiMessages.push({ role: m.role, content });
    } else {
      oaiMessages.push({ role: m.role, content: m.content });
    }
  }

  const isReasoningModel =
    settings.model.startsWith("o1") || settings.model.startsWith("o3") || settings.model.startsWith("o4");

  const body: any = {
    model: settings.model,
    messages: oaiMessages,
    stream: true,
  };
  if (!isReasoningModel) body.max_tokens = 16384;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  // OpenRouter: optional but recommended headers for ranking
  if (settings.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://luxi-ide.dev";
    headers["X-Title"] = "Luxi IDE";
  }

  const response = await fetch(`${baseURL}/chat/completions`, {
    method: "POST",
    headers,
    signal,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    return makeErrorStream(`${PROVIDER_CONFIGS[settings.provider].label} API error ${response.status}: ${errText.slice(0, 300)}`);
  }

  return parseSSEStream(response, (data) => {
    if (data === "[DONE]") return { done: true };
    try {
      const parsed = JSON.parse(data);
      const text = parsed.choices?.[0]?.delta?.content;
      return text ? { text } : null;
    } catch {
      return null;
    }
  });
}

function parseSSEStream(
  response: Response,
  parseLine: (data: string) => StreamChunk | null
): ReadableStream<StreamChunk> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  return new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          if (buffer.trim().startsWith("data: ")) {
            const line = buffer.trim().slice(6).trim();
            if (line && line !== "[DONE]") {
              const c = parseLine(line);
              if (c) controller.enqueue(c);
            }
          }
          controller.enqueue({ done: true });
          controller.close();
          return;
        }
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const raw of lines) {
          const line = raw.trim();
          if (!line || !line.startsWith("data: ")) continue;
          const data = line.slice(6).trim();
          if (!data) continue;
          const c = parseLine(data);
          if (c) {
            controller.enqueue(c);
            if (c.done) {
              controller.close();
              return;
            }
          }
        }
      } catch (err: any) {
        if (err.name !== "AbortError") {
          controller.enqueue({ error: err.message ?? "Stream read error" });
        }
        controller.enqueue({ done: true });
        controller.close();
      }
    },
  });
}

// ============================================================================
// agentCall — non-streaming with tools
// ============================================================================

export async function agentCall(
  settings: ProviderSettings,
  systemPrompt: string,
  contents: any[],
  tools: ToolDeclaration[],
  signal?: AbortSignal
): Promise<AgentResponse> {
  const cfg = PROVIDER_CONFIGS[settings.provider];
  switch (cfg.apiStyle) {
    case "gemini":
      return agentCallGemini(settings, systemPrompt, contents, tools, signal);
    case "anthropic":
      return agentCallAnthropic(settings, systemPrompt, contents, tools, signal);
    case "openai-compatible":
      return agentCallOpenAICompat(settings, systemPrompt, contents, tools, signal);
  }
}

export async function agentCallWithRetry(
  settings: ProviderSettings,
  systemPrompt: string,
  contents: any[],
  tools: ToolDeclaration[],
  signal?: AbortSignal,
  fallback?: ProviderSettings | null
): Promise<AgentResponse> {
  // First attempt
  let res = await agentCall(settings, systemPrompt, contents, tools, signal);
  if (!res.finishReason?.startsWith("error:")) return res;

  // Determine if transient (5xx, 429, network)
  const transient = /error:(429|5\d\d|0|fetch)/i.test(res.finishReason || "");
  if (transient) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await agentCall(settings, systemPrompt, contents, tools, signal);
    if (!res.finishReason?.startsWith("error:")) return res;
  }

  // Fallback provider
  if (fallback && fallback.provider !== settings.provider) {
    logger.warn({ primary: settings.provider, fallback: fallback.provider }, "AI provider failover");
    const fbRes = await agentCall(fallback, systemPrompt, contents, tools, signal);
    if (!fbRes.finishReason?.startsWith("error:")) return fbRes;
    return fbRes;
  }

  return res;
}

async function agentCallGemini(
  settings: ProviderSettings,
  systemPrompt: string,
  contents: any[],
  tools: ToolDeclaration[],
  signal?: AbortSignal
): Promise<AgentResponse> {
  const cleanedTools = geminiToolFormat(tools);

  const geminiBase =
    settings.baseURL ||
    PROVIDER_CONFIGS[settings.provider]?.defaultBaseURL ||
    "https://generativelanguage.googleapis.com/v1beta";

  let response: Response;
  try {
    response = await fetch(
      `${geminiBase}/models/${settings.model}:generateContent?key=${settings.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal,
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents,
          ...(cleanedTools.length > 0 && {
            tools: [{ functionDeclarations: cleanedTools }],
            tool_config: { function_calling_config: { mode: "AUTO" } },
          }),
          generationConfig: { maxOutputTokens: 65536, temperature: 0.2 },
        }),
      }
    );
  } catch (err: any) {
    return { textParts: [], toolCalls: [], finishReason: `error:fetch:${err.message?.slice(0, 200)}` };
  }

  if (!response.ok) {
    const errText = await response.text();
    return { textParts: [], toolCalls: [], finishReason: `error:${response.status}:${errText.slice(0, 200)}` };
  }

  const data = (await response.json()) as any;
  const candidate = data.candidates?.[0];
  if (!candidate?.content?.parts) {
    logger.warn(
      {
        finishReason: candidate?.finishReason,
        blockReason: data.promptFeedback?.blockReason,
        safetyRatings: candidate?.safetyRatings,
        candidateCount: data.candidates?.length,
      },
      "Gemini no_content"
    );
    return { textParts: [], toolCalls: [], finishReason: "no_content" };
  }

  const parts = candidate.content.parts;
  const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text as string);
  const toolCalls = parts
    .filter((p: any) => p.functionCall)
    .map((p: any) => ({
      name: p.functionCall.name as string,
      args: (p.functionCall.args ?? {}) as Record<string, any>,
    }));

  const u = data.usageMetadata ?? {};
  const tokensIn = u.promptTokenCount ?? 0;
  const tokensOut = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  const usage: UsageInfo = { tokensIn, tokensOut, costUsd: computeCostUsd(settings.model, tokensIn, tokensOut) };

  return { textParts, toolCalls, finishReason: candidate.finishReason, usage };
}

export function buildGeminiContents(
  history: { role: string; content: string }[],
  message: string,
  images?: ChatImage[]
): any[] {
  const chatHistory = history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const userParts: any[] = [];
  if (images?.length) {
    for (const img of images) {
      const { mimeType, data } = dataUrlParts(img.dataUrl);
      if (mimeType !== "image/url" && data) {
        userParts.push({ inlineData: { mimeType: img.mimeType || mimeType, data } });
      }
    }
  }
  userParts.push({ text: message });
  return [...chatHistory, { role: "user", parts: userParts }];
}

export function appendGeminiModelParts(contents: any[], parts: any[]) {
  contents.push({ role: "model", parts });
}

export function appendGeminiToolResults(
  contents: any[],
  results: { name: string; result: string }[]
) {
  contents.push({
    role: "user",
    parts: results.map((r) => ({
      functionResponse: { name: r.name, response: { result: r.result } },
    })),
  });
}

async function agentCallAnthropic(
  settings: ProviderSettings,
  systemPrompt: string,
  contents: any[],
  tools: ToolDeclaration[],
  signal?: AbortSignal
): Promise<AgentResponse> {
  const messages = convertContentsToAnthropic(contents);

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": settings.apiKey,
        "anthropic-version": "2023-06-01",
      },
      signal,
      body: JSON.stringify({
        model: settings.model,
        max_tokens: 16384,
        system: systemPrompt,
        messages,
        ...(tools.length > 0 && { tools: anthropicToolFormat(tools) }),
      }),
    });
  } catch (err: any) {
    return { textParts: [], toolCalls: [], finishReason: `error:fetch:${err.message?.slice(0, 200)}` };
  }

  if (!response.ok) {
    const errText = await response.text();
    return { textParts: [], toolCalls: [], finishReason: `error:${response.status}:${errText.slice(0, 200)}` };
  }

  const data = (await response.json()) as any;
  const textParts: string[] = [];
  const toolCalls: { name: string; args: Record<string, any> }[] = [];

  for (const block of data.content ?? []) {
    if (block.type === "text") textParts.push(block.text);
    if (block.type === "tool_use") toolCalls.push({ name: block.name, args: block.input ?? {} });
  }

  const u = data.usage ?? {};
  const tokensIn = u.input_tokens ?? 0;
  const tokensOut = u.output_tokens ?? 0;
  const usage: UsageInfo = { tokensIn, tokensOut, costUsd: computeCostUsd(settings.model, tokensIn, tokensOut) };

  return { textParts, toolCalls, finishReason: data.stop_reason, usage };
}

function convertContentsToAnthropic(contents: any[]): any[] {
  const messages: any[] = [];
  let idCounter = 0;
  let lastModelCallIds: string[] = [];

  for (const c of contents) {
    if (c.role === "user") {
      if (c.parts?.[0]?.functionResponse) {
        const toolResults = c.parts.map((p: any, idx: number) => ({
          type: "tool_result",
          tool_use_id: lastModelCallIds[idx] ?? `call_${idCounter++}`,
          content:
            typeof p.functionResponse.response?.result === "string"
              ? p.functionResponse.response.result
              : JSON.stringify(p.functionResponse.response),
        }));
        messages.push({ role: "user", content: toolResults });
      } else {
        const blocks: any[] = [];
        for (const p of c.parts ?? []) {
          if (p.text) blocks.push({ type: "text", text: p.text });
          if (p.inlineData) {
            blocks.push({
              type: "image",
              source: { type: "base64", media_type: p.inlineData.mimeType, data: p.inlineData.data },
            });
          }
        }
        if (blocks.length === 1 && blocks[0].type === "text") {
          messages.push({ role: "user", content: blocks[0].text });
        } else if (blocks.length > 0) {
          messages.push({ role: "user", content: blocks });
        }
      }
    } else if (c.role === "model" || c.role === "assistant") {
      const content: any[] = [];
      lastModelCallIds = [];
      for (const p of c.parts ?? []) {
        if (p.text) content.push({ type: "text", text: p.text });
        if (p.functionCall) {
          const callId = `call_${idCounter++}`;
          lastModelCallIds.push(callId);
          content.push({
            type: "tool_use",
            id: callId,
            name: p.functionCall.name,
            input: p.functionCall.args ?? {},
          });
        }
      }
      if (content.length > 0) messages.push({ role: "assistant", content });
    }
  }

  return messages;
}

async function agentCallOpenAICompat(
  settings: ProviderSettings,
  systemPrompt: string,
  contents: any[],
  tools: ToolDeclaration[],
  signal?: AbortSignal
): Promise<AgentResponse> {
  const baseURL = settings.baseURL || PROVIDER_CONFIGS[settings.provider].defaultBaseURL || "https://api.openai.com/v1";
  const messages = convertContentsToOpenAI(contents, systemPrompt);

  const isReasoningModel =
    settings.model.startsWith("o1") || settings.model.startsWith("o3") || settings.model.startsWith("o4");
  const body: any = {
    model: settings.model,
    messages,
  };
  if (tools.length > 0) {
    body.tools = openaiToolFormat(tools);
    body.tool_choice = "auto";
  }
  if (!isReasoningModel) body.max_tokens = 16384;

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  if (settings.provider === "openrouter") {
    headers["HTTP-Referer"] = "https://luxi-ide.dev";
    headers["X-Title"] = "Luxi IDE";
  }

  let response: Response;
  try {
    response = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers,
      signal,
      body: JSON.stringify(body),
    });
  } catch (err: any) {
    return { textParts: [], toolCalls: [], finishReason: `error:fetch:${err.message?.slice(0, 200)}` };
  }

  if (!response.ok) {
    const errText = await response.text();
    return { textParts: [], toolCalls: [], finishReason: `error:${response.status}:${errText.slice(0, 200)}` };
  }

  const data = (await response.json()) as any;
  const choice = data.choices?.[0];
  const msg = choice?.message;

  const textParts: string[] = msg?.content ? [msg.content] : [];
  const toolCalls: { name: string; args: Record<string, any> }[] = [];

  for (const tc of msg?.tool_calls ?? []) {
    if (tc.type === "function" || tc.function) {
      try {
        toolCalls.push({
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments ?? "{}"),
        });
      } catch {
        toolCalls.push({ name: tc.function.name, args: {} });
      }
    }
  }

  const u = data.usage ?? {};
  const tokensIn = u.prompt_tokens ?? 0;
  const tokensOut = u.completion_tokens ?? 0;
  const usage: UsageInfo = { tokensIn, tokensOut, costUsd: computeCostUsd(settings.model, tokensIn, tokensOut) };

  return { textParts, toolCalls, finishReason: choice?.finish_reason, usage };
}

function convertContentsToOpenAI(contents: any[], systemPrompt: string): any[] {
  const messages: any[] = [{ role: "system", content: systemPrompt }];
  let idCounter = 0;
  let lastModelCallIds: string[] = [];

  for (const c of contents) {
    if (c.role === "user") {
      if (c.parts?.[0]?.functionResponse) {
        for (let i = 0; i < c.parts.length; i++) {
          const p = c.parts[i];
          messages.push({
            role: "tool",
            tool_call_id: lastModelCallIds[i] ?? `call_${idCounter++}`,
            content:
              typeof p.functionResponse.response?.result === "string"
                ? p.functionResponse.response.result
                : JSON.stringify(p.functionResponse.response),
          });
        }
      } else {
        const blocks: any[] = [];
        let textOnly = "";
        for (const p of c.parts ?? []) {
          if (p.text) {
            blocks.push({ type: "text", text: p.text });
            textOnly += p.text;
          }
          if (p.inlineData) {
            blocks.push({
              type: "image_url",
              image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` },
            });
          }
        }
        if (blocks.length === 1 && blocks[0].type === "text") {
          messages.push({ role: "user", content: textOnly });
        } else if (blocks.length > 0) {
          messages.push({ role: "user", content: blocks });
        }
      }
    } else if (c.role === "model" || c.role === "assistant") {
      const textChunks: string[] = [];
      const tool_calls: any[] = [];
      lastModelCallIds = [];
      for (const p of c.parts ?? []) {
        if (p.text) textChunks.push(p.text);
        if (p.functionCall) {
          const callId = `call_${idCounter++}`;
          lastModelCallIds.push(callId);
          tool_calls.push({
            id: callId,
            type: "function",
            function: {
              name: p.functionCall.name,
              arguments: JSON.stringify(p.functionCall.args ?? {}),
            },
          });
        }
      }
      const msg: any = { role: "assistant" };
      if (textChunks.length) msg.content = textChunks.join("");
      else msg.content = null;
      if (tool_calls.length) msg.tool_calls = tool_calls;
      if (msg.content !== undefined || tool_calls.length) messages.push(msg);
    }
  }

  return messages;
}
