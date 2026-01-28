import { useEffect, useState, useRef, useCallback } from "react";

export function useSmoothStreaming(text: string, streaming: boolean) {
  const [displayedText, setDisplayedText] = useState(streaming ? "" : text);
  const [isAnimating, setIsAnimating] = useState(false);

  const currentLength = useRef(0);
  const targetLength = useRef(0);
  const velocity = useRef(0);
  const animationFrameId = useRef<number | undefined>(undefined);
  const wasEverStreaming = useRef(streaming);
  const textRef = useRef(text);

  // Spring physics parameters
  const stiffness = 0.4;
  const damping = 0.6;
  const minVelocity = 2;
  const maxVelocity = 64;

  textRef.current = text;

  // Update target when text changes
  useEffect(() => {
    targetLength.current = text.length;

    // Never streamed (loaded from history) — show immediately
    if (!streaming && !wasEverStreaming.current) {
      currentLength.current = text.length;
      setDisplayedText(text);
      return;
    }

    if (streaming) {
      wasEverStreaming.current = true;
    }

    // Text shrunk (reset/cleared) — snap immediately
    if (text.length < currentLength.current) {
      currentLength.current = text.length;
      velocity.current = 0;
      setDisplayedText(text);
      return;
    }
  }, [text, streaming]);

  const animate = useCallback(() => {
    const distance = targetLength.current - currentLength.current;

    // Animation complete — caught up to target
    if (distance <= 0.5) {
      currentLength.current = targetLength.current;
      setDisplayedText(
        textRef.current.slice(0, Math.floor(currentLength.current)),
      );
      velocity.current = 0;
      setIsAnimating(false);
      return;
    }

    setIsAnimating(true);

    const force = distance * stiffness;
    velocity.current = velocity.current * damping + force;
    velocity.current = Math.min(
      Math.max(velocity.current, minVelocity),
      maxVelocity,
    );

    currentLength.current += velocity.current;

    if (currentLength.current > targetLength.current) {
      currentLength.current = targetLength.current;
    }

    setDisplayedText(
      textRef.current.slice(0, Math.floor(currentLength.current)),
    );
    animationFrameId.current = requestAnimationFrame(animate);
  }, [stiffness, damping, minVelocity, maxVelocity]);

  // Run animation whenever there's a gap between current and target
  useEffect(() => {
    // Never streamed — nothing to animate
    if (!wasEverStreaming.current) return;

    const distance = targetLength.current - currentLength.current;
    if (distance <= 0.5) return;

    // Start animation loop
    setIsAnimating(true);
    animationFrameId.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameId.current)
        cancelAnimationFrame(animationFrameId.current);
    };
  }, [text, streaming, animate]);

  return { displayedText, isAnimating };
}
