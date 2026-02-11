const SELECTED_MODEL_KEY = "sendcat_selected_model";
const LEGACY_SELECTED_MODEL_KEY = "t3_selected_model";

// Default model when the user has never picked one.
// Must match OpenRouter's model id exactly.
export const DEFAULT_MODEL_ID = "moonshotai/kimi-k2.5";

const MODEL_CHANGE_EVENT = "sendcat:selected-model-changed";

export function getSelectedModelId(): string {
  if (typeof window === "undefined") return DEFAULT_MODEL_ID;

  const current = localStorage.getItem(SELECTED_MODEL_KEY);
  if (current) return current;

  const legacy = localStorage.getItem(LEGACY_SELECTED_MODEL_KEY);
  if (legacy) {
    // Migration: persist the legacy value under the new key.
    try {
      localStorage.setItem(SELECTED_MODEL_KEY, legacy);
    } catch {
      // Ignore localStorage failures.
    }
    return legacy;
  }

  return DEFAULT_MODEL_ID;
}

export function setSelectedModelId(modelId: string) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(SELECTED_MODEL_KEY, modelId);
    // Back-compat: keep legacy key in sync while older code paths may still read it.
    localStorage.setItem(LEGACY_SELECTED_MODEL_KEY, modelId);
  } catch {
    // Ignore localStorage failures.
  }

  try {
    window.dispatchEvent(new CustomEvent(MODEL_CHANGE_EVENT));
  } catch {
    // Ignore event failures.
  }
}

export function subscribeSelectedModelId(onChange: () => void) {
  if (typeof window === "undefined") return () => {};

  const onStorage = (e: StorageEvent) => {
    if (e.key === SELECTED_MODEL_KEY || e.key === LEGACY_SELECTED_MODEL_KEY) {
      onChange();
    }
  };

  const onCustom = () => onChange();

  window.addEventListener("storage", onStorage);
  window.addEventListener(MODEL_CHANGE_EVENT, onCustom as EventListener);

  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(MODEL_CHANGE_EVENT, onCustom as EventListener);
  };
}

