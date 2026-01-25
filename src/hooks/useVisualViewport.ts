import { useEffect } from 'react'

/**
 * Hook to handle the Visual Viewport API.
 * It sets a CSS variable --visual-viewport-bottom representing the keyboard height
 * (distance from the bottom of the layout viewport to the bottom of the visual viewport).
 */
export function useVisualViewport() {
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return

    const handleVisualViewportChange = () => {
      const vv = window.visualViewport
      if (!vv) return

      // Height of the keyboard (roughly)
      const bottomOffset = window.innerHeight - vv.height - vv.offsetTop
      
      // Prevent negative values or very small jitter
      const keyboardHeight = Math.max(0, bottomOffset)

      document.documentElement.style.setProperty(
        '--visual-viewport-bottom',
        `${keyboardHeight}px`
      )
      
      // Also set the height of the visual viewport for elements that need it
      document.documentElement.style.setProperty(
        '--visual-viewport-height',
        `${vv.height}px`
      )
    }

    // Initialize
    handleVisualViewportChange()

    window.visualViewport.addEventListener('resize', handleVisualViewportChange)
    window.visualViewport.addEventListener('scroll', handleVisualViewportChange)

    return () => {
      window.visualViewport?.removeEventListener('resize', handleVisualViewportChange)
      window.visualViewport?.removeEventListener('scroll', handleVisualViewportChange)
    }
  }, [])
}
