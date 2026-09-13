"use client"

import { useEffect, useState } from "react"
import { apiFetch, ApiError, withOwner } from "@/lib/api-client"
import type { TagView } from "@/lib/services/tags"
import type { TopicListItem } from "@/lib/services/topics"

export type LibraryData = { topics: TopicListItem[]; tags: TagView[] }

/**
 * Loads topics+tags for the current filters. `loading` is derived from the
 * response key, so no state is set synchronously inside the effect (React
 * compiler lint) and stale responses never overwrite newer ones. When an
 * admin browses another user's library, `ownerId` scopes every request.
 */
export function useLibraryData(
  query: string,
  tagIds: string[],
  ownerId: string | null = null,
): {
  data: LibraryData | null
  error: string | null
  loading: boolean
  reload: () => void
} {
  const key = `${ownerId ?? ""}|${query.trim()}|${[...tagIds].sort().join(",")}`
  const [state, setState] = useState<{ key: string; data: LibraryData } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams()
    if (query.trim()) params.set("q", query.trim())
    if (tagIds.length > 0) params.set("tagIds", tagIds.join(","))
    const suffix = params.toString()
    Promise.all([
      apiFetch<TopicListItem[]>(withOwner(`/api/topics${suffix ? `?${suffix}` : ""}`, ownerId)),
      apiFetch<TagView[]>(withOwner("/api/tags", ownerId)),
    ])
      .then(([topics, tags]) => {
        if (cancelled) return
        setState({ key, data: { topics, tags } })
        setError(null)
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof ApiError ? cause.message : "Could not load your library.")
        }
      })
    return () => {
      cancelled = true
    }
  }, [key, query, tagIds, ownerId, nonce])

  return {
    data: state && state.key === key ? state.data : null,
    error,
    loading: state === null || state.key !== key,
    reload: () => setNonce((value) => value + 1),
  }
}
