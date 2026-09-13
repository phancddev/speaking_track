import * as React from "react"

const MOBILE_BREAKPOINT = 768

/**
 * Tracks whether the viewport is below the mobile breakpoint. The initial
 * sync happens inside the media-query listener wiring (not as a separate
 * synchronous setState) to avoid cascading renders flagged by the React
 * compiler lint rules.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const query = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    onChange()
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}
