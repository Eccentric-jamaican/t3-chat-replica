import { useCallback, useEffect, useState } from "react";
import {
  getSelectedModelId,
  setSelectedModelId,
  subscribeSelectedModelId,
} from "../lib/selectedModel";

export function useSelectedModelId() {
  const [selectedModelId, setSelectedModelIdState] = useState(() =>
    getSelectedModelId(),
  );

  useEffect(() => {
    return subscribeSelectedModelId(() => {
      setSelectedModelIdState(getSelectedModelId());
    });
  }, []);

  const setSelectedModelIdStable = useCallback((modelId: string) => {
    setSelectedModelId(modelId);
  }, []);

  return [selectedModelId, setSelectedModelIdStable] as const;
}

