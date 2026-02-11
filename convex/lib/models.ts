export interface ModelCapability {
  id: string;
  supportsTools: boolean;
  supportsStreaming: boolean;
  isThinking: boolean; // For DeepSeek R1, o1, etc.
  toolFallback?: "regex" | "none";
  promptStrategy?: "standard" | "reasoning" | "minimal"; // New strategy field
}

export const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  // === GOOGLE ===
  "google/gemini-2.0-flash-exp:free": {
    id: "google/gemini-2.0-flash-exp:free",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "google/gemini-3-flash-preview": {
    id: "google/gemini-3-flash-preview",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "google/gemini-flash-1.5": {
    id: "google/gemini-flash-1.5",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "google/gemini-pro-1.5": {
    id: "google/gemini-pro-1.5",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },

  // === ANTHROPIC ===
  "anthropic/claude-3.5-sonnet": {
    id: "anthropic/claude-3.5-sonnet",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "anthropic/claude-3-haiku": {
    id: "anthropic/claude-3-haiku",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "anthropic/claude-haiku-4.5": {
    id: "anthropic/claude-haiku-4.5",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },

  // === OPENAI ===
  "openai/gpt-4o": {
    id: "openai/gpt-4o",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "openai/gpt-4o-mini": {
    id: "openai/gpt-4o-mini",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "openai/gpt-5-nano": {
    id: "openai/gpt-5-nano",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "openai/gpt-5-nano:free": {
    id: "openai/gpt-5-nano:free",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "openai/o1-mini": {
    id: "openai/o1-mini",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: true,
    toolFallback: "regex",
    promptStrategy: "reasoning",
  },
  "openai/o1-preview": {
    id: "openai/o1-preview",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: true,
    toolFallback: "regex",
    promptStrategy: "reasoning",
  },
  // [NEW] GPT-OSS-120B (Open-Weight Native Tool Support)
  "openai/gpt-oss-120b": {
    id: "openai/gpt-oss-120b",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false, // Standard MoE
    promptStrategy: "standard",
  },

  // === DEEPSEEK ===
  "deepseek/deepseek-chat": {
    id: "deepseek/deepseek-chat",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "deepseek/deepseek-r1": {
    id: "deepseek/deepseek-r1",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: true,
    promptStrategy: "reasoning", // Needs <think> handling awareness
  },

  // === META ===
  "meta-llama/llama-3.3-70b-instruct": {
    id: "meta-llama/llama-3.3-70b-instruct",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },

  // === MOONSHOT (KIMI) ===
  "moonshotai/kimi-k2.5": {
    id: "moonshotai/kimi-k2.5",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
  "moonshotai/moonshot-v1-8k": {
    id: "moonshotai/moonshot-v1-8k",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },

  // === XAI (GROK) ===
  "x-ai/grok-2-vision-1212": {
    id: "x-ai/grok-2-vision-1212",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard", // Grok now supports native tools via OpenRouter
  },
  "x-ai/grok-4": {
    id: "x-ai/grok-4",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: true, // Grok 4 has reasoning
    promptStrategy: "reasoning",
  },

  // === OPENAI GPT-5 ===
  "openai/gpt-5.1-chat": {
    id: "openai/gpt-5.1-chat",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
    promptStrategy: "standard",
  },
};

export function getModelCapabilities(
  modelId: string | undefined,
): ModelCapability {
  if (!modelId) {
    return MODEL_CAPABILITIES["moonshotai/kimi-k2.5"]; // Default
  }

  // Specific override for known capabilities if not found in map
  if (MODEL_CAPABILITIES[modelId]) {
    return MODEL_CAPABILITIES[modelId];
  }

  // [AGENTIC] Modern Default Strategy
  // Assume most new models on OpenRouter support tools unless known otherwise.
  // This replaces the old "safely fail to regex" strategy.

  const modelIdLower = modelId.toLowerCase();
  const isThinking =
    modelIdLower.includes("r1") ||
    modelIdLower.includes("reasoning") ||
    modelIdLower.includes("thinking");

  if (modelIdLower.includes("gpt-5")) {
    return {
      id: modelId,
      supportsTools: true,
      supportsStreaming: true,
      isThinking,
      promptStrategy: isThinking ? "reasoning" : "standard",
    };
  }

  return {
    id: modelId,
    supportsTools: false, // Default to false for tool safety
    supportsStreaming: true, // Most modern models support streaming
    isThinking,
    promptStrategy: isThinking ? "reasoning" : "standard",
    toolFallback: "regex", // Fallback to parsing text for tool blocks if they occur
  };
}
