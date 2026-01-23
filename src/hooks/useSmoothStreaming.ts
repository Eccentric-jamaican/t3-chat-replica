import { useEffect, useState, useRef } from 'react';

export function useSmoothStreaming(
  text: string,
  streaming: boolean,
) {
  const [displayedText, setDisplayedText] = useState(streaming ? '' : text);
  // Use a float to track position for sub-pixel smooth interpolation
  const currentLength = useRef(0);
  const targetLength = useRef(0);
  const velocity = useRef(0);
  const animationFrameId = useRef<number | undefined>(undefined);

  // Spring physics parameters for smooth momentum
  // Higher stiffness = faster acceleration toward target
  // Lower damping = less resistance, faster movement
  // Higher minVelocity = faster minimum speed
  const stiffness = 0.5;
  const damping = 0.5;
  const minVelocity = 10;

  // Update target length whenever text changes
  useEffect(() => {
    targetLength.current = text.length;

    // If not streaming (or just loaded), jump to end
    if (!streaming) {
      currentLength.current = text.length;
      velocity.current = 0;
      setDisplayedText(text);
      return;
    }

    // If text shrunk (reset/cleared), reset immediately
    if (text.length < currentLength.current) {
       currentLength.current = text.length;
       velocity.current = 0;
       setDisplayedText(text);
       return;
    }
  }, [text, streaming]);

  useEffect(() => {
    if (!streaming) return;

    const animate = () => {
      const distance = targetLength.current - currentLength.current;

      if (distance <= 0.01) {
        if (distance < 0) {
            // Correct overshoot if any (rare)
            currentLength.current = targetLength.current;
            setDisplayedText(text.slice(0, Math.floor(currentLength.current)));
        }
        velocity.current = 0;
        return;
      }

      // Spring physics: acceleration toward target with damping
      // Creates smooth momentum-based reveal instead of linear catch-up
      const force = distance * stiffness;
      velocity.current = velocity.current * damping + force;

      // Ensure minimum velocity so we always make progress
      velocity.current = Math.max(velocity.current, minVelocity);

      currentLength.current += velocity.current;

      // Clamp to target
      if (currentLength.current > targetLength.current) {
        currentLength.current = targetLength.current;
      }

      setDisplayedText(text.slice(0, Math.floor(currentLength.current)));

      if (currentLength.current < targetLength.current) {
        animationFrameId.current = requestAnimationFrame(animate);
      }
    };

    animationFrameId.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameId.current) cancelAnimationFrame(animationFrameId.current);
    };
  }, [text, streaming]); // Re-run animation loop when text (target) updates

  return displayedText;
}
