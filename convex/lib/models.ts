export interface ModelCapability {
  id: string;
  supportsTools: boolean;
  supportsStreaming: boolean;
  isThinking: boolean; // For DeepSeek R1, o1, etc.
  toolFallback?: "regex" | "none";
}

export const MODEL_CAPABILITIES: Record<string, ModelCapability> = {
  // === GOOGLE ===
  "google/gemini-2.0-flash-exp:free": {
    id: "google/gemini-2.0-flash-exp:free",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
  },
  "google/gemini-flash-1.5": {
    id: "google/gemini-flash-1.5",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
  },
  "google/gemini-pro-1.5": {
    id: "google/gemini-pro-1.5",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
  },

  // === ANTHROPIC ===
  "anthropic/claude-3-opus": {
    id: "anthropic/claude-3-opus",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
  },
  "anthropic/claude-3.5-sonnet": {
    id: "anthropic/claude-3.5-sonnet",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
  },
  "anthropic/claude-3-haiku": {
    id: "anthropic/claude-3-haiku",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false, // Standard Haiku
  },

  // === OPENAI ===
  "openai/gpt-4o": {
    id: "openai/gpt-4o",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
  },
  "openai/gpt-4o-mini": {
    id: "openai/gpt-4o-mini",
    supportsTools: true, // Generally supports tools
    supportsStreaming: true,
    isThinking: false,
  },
  "openai/o1-mini": {
    id: "openai/o1-mini",
    supportsTools: false, // o1 often has limited tool support in preview
    supportsStreaming: true,
    isThinking: true,
    toolFallback: "regex", // Force regex if user really wants search
  },
  "openai/o1-preview": {
    id: "openai/o1-preview",
    supportsTools: false,
    supportsStreaming: true,
    isThinking: true,
    toolFallback: "regex",
  },

  // === DEEPSEEK ===
  "deepseek/deepseek-chat": {
    id: "deepseek/deepseek-chat",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
  },
  "deepseek/deepseek-r1": {
    id: "deepseek/deepseek-r1",
    supportsTools: true, // R1 supports tools but often needs prompting
    supportsStreaming: true,
    isThinking: true,
  },

  // === META ===
  "meta-llama/llama-3.3-70b-instruct": {
    id: "meta-llama/llama-3.3-70b-instruct",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
  },

  // === MOONSHOT (KIMI) ===
  "moonshotai/moonshot-v1-8k": {
    id: "moonshotai/moonshot-v1-8k",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
  },

  // === OPENAI GPT-5 ===
  "openai/gpt-5": {
    id: "openai/gpt-5",
    supportsTools: true,
    supportsStreaming: true,
    isThinking: false,
  },
};

export function getModelCapabilities(modelId: string | undefined): ModelCapability {
  if (!modelId) {
     return MODEL_CAPABILITIES["moonshotai/moonshot-v1-8k"];
  }
  const supportsTools = modelId.toLowerCase().includes("grok") || modelId.toLowerCase().includes("x-ai") ? true : false;
  
  return MODEL_CAPABILITIES[modelId] || {
    id: modelId,
    supportsTools, // Default to FALSE for safety
    supportsStreaming: true,
    isThinking: modelId.toLowerCase().includes("thinking") || 
                modelId.toLowerCase().includes("r1") || 
                modelId.toLowerCase().includes("o1") ||
                modelId.toLowerCase().includes("kimi"),
    toolFallback: supportsTools ? undefined : "regex", // Only use regex if native tools aren't supported
  };
}
