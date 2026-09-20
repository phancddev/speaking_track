"use client"

import { useCallback, useState } from "react"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CircleAlertIcon,
  LoaderCircleIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { apiFetch, ApiError } from "@/lib/api-client"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"

export type DraftView = {
  id: string
  title: string | null
  content: string
  updatedAt: Date | string
}

const MAX_TITLE = 200
const MAX_CONTENT = 100000

/**
 * Multi-draft panel: a question can hold any number of drafts, each with an
 * optional title. Saves are explicit per draft; create/edit/delete operate
 * on the drafts API directly and patch local state from server responses.
 */
export function DraftsPanel({
  questionId,
  initialDrafts,
  onFormOpenChange,
}: {
  questionId: string
  initialDrafts: DraftView[]
  /** Notifies the parent while any draft form is open (beforeunload guard). */
  onFormOpenChange?: (open: boolean) => void
}) {
  const [items, setItems] = useState<DraftView[]>(initialDrafts)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState("")
  const [newContent, setNewContent] = useState("")
  const [creatingBusy, setCreatingBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState("")
  const [editContent, setEditContent] = useState("")
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [moving, setMoving] = useState(false)

  const message = (cause: unknown, fallback: string) =>
    cause instanceof ApiError ? cause.message : fallback

  const startCreate = useCallback(() => {
    setCreating(true)
    setNewTitle("")
    setNewContent("")
    setError(null)
    onFormOpenChange?.(true)
  }, [onFormOpenChange])

  const closeCreate = useCallback(() => {
    setCreating(false)
    setNewTitle("")
    setNewContent("")
    onFormOpenChange?.(false)
  }, [onFormOpenChange])

  const createDraft = useCallback(async () => {
    if (creatingBusy) return
    setCreatingBusy(true)
    setError(null)
    try {
      const result = await apiFetch<{ draft: DraftView }>(`/api/questions/${questionId}/drafts`, {
        method: "POST",
        body: JSON.stringify({ title: newTitle, content: newContent }),
      })
      setItems((current) => [...current, result.draft])
      closeCreate()
    } catch (cause) {
      setError(message(cause, "Could not add the draft. Try again."))
    } finally {
      setCreatingBusy(false)
    }
  }, [closeCreate, creatingBusy, newContent, newTitle, questionId])

  const beginEdit = useCallback(
    (draft: DraftView) => {
      setEditingId(draft.id)
      setEditTitle(draft.title ?? "")
      setEditContent(draft.content)
      setError(null)
      onFormOpenChange?.(true)
    },
    [onFormOpenChange],
  )

  const closeEdit = useCallback(() => {
    setEditingId(null)
    setEditTitle("")
    setEditContent("")
    onFormOpenChange?.(false)
  }, [onFormOpenChange])

  const saveEdit = useCallback(
    async (draftId: string) => {
      if (savingId) return
      setSavingId(draftId)
      setError(null)
      try {
        const result = await apiFetch<{ draft: DraftView }>(`/api/drafts/${draftId}`, {
          method: "PATCH",
          body: JSON.stringify({ title: editTitle, content: editContent }),
        })
        setItems((current) => current.map((d) => (d.id === draftId ? result.draft : d)))
        closeEdit()
      } catch (cause) {
        setError(message(cause, "Could not save the draft. Try again."))
      } finally {
        setSavingId(null)
      }
    },
    [closeEdit, editContent, editTitle, savingId],
  )

  const removeDraft = useCallback(
    async (draftId: string) => {
      if (deletingId) return
      setDeletingId(draftId)
      setError(null)
      try {
        await apiFetch(`/api/drafts/${draftId}`, { method: "DELETE" })
        setItems((current) => current.filter((d) => d.id !== draftId))
        if (editingId === draftId) {
          closeEdit()
        }
      } catch (cause) {
        setError(message(cause, "Could not delete the draft. Try again."))
      } finally {
        setDeletingId(null)
      }
    },
    [closeEdit, deletingId, editingId],
  )

  // Optimistic swap; the server rewrites positions densely and the response
  // list becomes the new truth. Failures revert and surface the error.
  const moveDraft = useCallback(
    async (index: number, direction: -1 | 1) => {
      const target = index + direction
      if (target < 0 || target >= items.length || moving) return
      const previous = items
      const next = [...items]
      const [moved] = next.splice(index, 1)
      next.splice(target, 0, moved!)
      setItems(next)
      setMoving(true)
      setError(null)
      try {
        const response = await apiFetch<{ drafts: DraftView[] }>(
          `/api/questions/${questionId}/drafts/reorder`,
          {
            method: "PUT",
            body: JSON.stringify({ draftIds: next.map((draft) => draft.id) }),
          },
        )
        setItems(response.drafts)
      } catch (cause) {
        setItems(previous)
        setError(cause instanceof ApiError ? cause.message : "Could not reorder drafts.")
      } finally {
        setMoving(false)
      }
    },
    [items, moving, questionId],
  )

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold">
          Drafts
          <span className="text-muted-foreground ml-2 text-sm font-normal">
            {items.length === 0 ? "" : `${items.length}`}
          </span>
        </CardTitle>
        {!creating ? (
          <Button size="sm" variant="outline" onClick={startCreate}>
            <PlusIcon aria-hidden />
            New draft
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {error ? (
          <Alert variant="destructive">
            <CircleAlertIcon aria-hidden />
            <AlertTitle>Draft error</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        {creating ? (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <Label htmlFor="new-draft-title" className="text-muted-foreground text-xs">
              Title (optional)
            </Label>
            <Input
              id="new-draft-title"
              value={newTitle}
              onChange={(event) => setNewTitle(event.target.value)}
              maxLength={MAX_TITLE}
              placeholder="e.g. Opening with a story"
            />
            <Label htmlFor="new-draft-content" className="sr-only">
              Draft content
            </Label>
            <Textarea
              id="new-draft-content"
              value={newContent}
              onChange={(event) => setNewContent(event.target.value)}
              rows={6}
              maxLength={MAX_CONTENT}
              placeholder="Plan your answer…"
            />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={closeCreate} disabled={creatingBusy}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => void createDraft()} disabled={creatingBusy}>
                {creatingBusy ? (
                  <>
                    <LoaderCircleIcon aria-hidden className="animate-spin" />
                    Adding…
                  </>
                ) : (
                  "Add draft"
                )}
              </Button>
            </div>
          </div>
        ) : null}

        {items.length === 0 && !creating ? (
          <p className="text-muted-foreground text-sm">
            No drafts yet. Add one to plan your answer before recording.
          </p>
        ) : null}

        <ul className="flex flex-col gap-4">
          {items.map((draft, index) => {
            const editing = editingId === draft.id
            return (
              <li key={draft.id} className="rounded-lg border p-3">
                {editing ? (
                  <div className="flex flex-col gap-2">
                    <Label
                      htmlFor={`draft-title-${draft.id}`}
                      className="text-muted-foreground text-xs"
                    >
                      Title (optional)
                    </Label>
                    <Input
                      id={`draft-title-${draft.id}`}
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      maxLength={MAX_TITLE}
                    />
                    <Label htmlFor={`draft-content-${draft.id}`} className="sr-only">
                      Draft content
                    </Label>
                    <Textarea
                      id={`draft-content-${draft.id}`}
                      value={editContent}
                      onChange={(event) => setEditContent(event.target.value)}
                      rows={6}
                      maxLength={MAX_CONTENT}
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={closeEdit}
                        disabled={savingId === draft.id}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => void saveEdit(draft.id)}
                        disabled={savingId === draft.id}
                      >
                        {savingId === draft.id ? (
                          <>
                            <LoaderCircleIcon aria-hidden className="animate-spin" />
                            Saving…
                          </>
                        ) : (
                          "Save"
                        )}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1">
                    {draft.title ? (
                      <p className="text-sm font-semibold">{draft.title}</p>
                    ) : (
                      <p className="text-muted-foreground text-sm italic">Untitled</p>
                    )}
                    {draft.content ? (
                      <p className="text-sm whitespace-pre-wrap">{draft.content}</p>
                    ) : (
                      <p className="text-muted-foreground text-sm italic">Empty draft</p>
                    )}
                    <div className="mt-1 flex items-center justify-between">
                      <span className="text-muted-foreground text-xs">
                        Updated {new Date(draft.updatedAt).toLocaleString()}
                      </span>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={
                            draft.title
                              ? `Move draft ${draft.title} up`
                              : `Move draft ${index + 1} up`
                          }
                          disabled={index === 0 || moving}
                          onClick={() => void moveDraft(index, -1)}
                        >
                          <ArrowUpIcon aria-hidden />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={
                            draft.title
                              ? `Move draft ${draft.title} down`
                              : `Move draft ${index + 1} down`
                          }
                          disabled={index === items.length - 1 || moving}
                          onClick={() => void moveDraft(index, 1)}
                        >
                          <ArrowDownIcon aria-hidden />
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => beginEdit(draft)}>
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={draft.title ? `Delete draft ${draft.title}` : "Delete draft"}
                          disabled={deletingId === draft.id}
                          onClick={() => void removeDraft(draft.id)}
                        >
                          {deletingId === draft.id ? (
                            <LoaderCircleIcon aria-hidden className="animate-spin" />
                          ) : (
                            <Trash2Icon aria-hidden />
                          )}
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
