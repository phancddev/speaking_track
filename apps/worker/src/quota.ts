/**
 * YouTube Data API quota accounting resets at midnight Pacific Time (with
 * DST handled by the timezone database). The scanner uses this to defer
 * quota-blocked uploads until just after the next reset.
 */

const PT_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Los_Angeles",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
})

/** Next midnight Pacific Time strictly after `from`, as a UTC instant. */
export function nextQuotaResetUtc(from: Date = new Date()): Date {
  const parts = PT_PARTS.formatToParts(from)
  const value = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value)
  const hour = value("hour") % 24
  const minutesElapsedPt = hour * 60 + value("minute")
  const minutesUntilReset = 24 * 60 - minutesElapsedPt
  // One-minute safety margin: retry just after the reset, never just before.
  return new Date(from.getTime() + (minutesUntilReset + 1) * 60_000)
}
