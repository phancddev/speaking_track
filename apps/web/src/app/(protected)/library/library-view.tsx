"use client"

import { CirclePlusIcon, TagsIcon, Trash2Icon, UserRoundIcon } from "lucide-react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useRef, useState } from "react"
import { apiFetch, ApiError, withOwner } from "@/lib/api-client"
import type { TagView } from "@/lib/services/tags"
import type { TopicListItem } from "@/lib/services/topics"
import { useLibraryData } from "./use-library-data"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Library surface (plan/03 § Library): search, multi-tag intersection
 * filter, removable filter badges, tag management, and topic CRUD. Filter
 * state lives in URL search params so refresh/back preserves the view.
 */
export function LibraryView({
  initialQuery,
  initialTagIds,
  ownerId = null,
  ownerLabel = null,
}: {
  initialQuery: string
  initialTagIds: string[]
  ownerId?: string | null
  ownerLabel?: string | null
}) {
  const router = useRouter()

  const [query, setQuery] = useState(initialQuery)
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>(initialTagIds)
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const library = useLibraryData(query, selectedTagIds, ownerId)
  const { topics, tags } = library.data ?? { topics: [], tags: [] }
  const loading = library.loading
  const error = library.error

  // Filters are server-provided initial state; URL updates happen only when
  // a filter actually changes (no self-firing replace loop on mount).
  const firstUrlSync = useRef(true)

  useEffect(() => {
    // Sync the URL only when filters differ from what the URL already
    // carries — the initial mount must NOT rewrite history.
    const params = new URLSearchParams()
    if (ownerId) params.set("ownerId", ownerId)
    if (query.trim()) params.set("q", query.trim())
    if (selectedTagIds.length > 0) params.set("tagIds", selectedTagIds.join(","))
    const next = params.toString()
    if (firstUrlSync.current) {
      // First run mirrors the server-rendered URL; only later changes sync.
      firstUrlSync.current = false
      return
    }
    router.replace(next ? `/library?${next}` : "/library", { scroll: false })
  }, [query, selectedTagIds, ownerId, router])

  const tagsById = useMemo(() => new Map(tags.map((tag) => [tag.id, tag])), [tags])

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      {ownerId && ownerLabel ? (
        <Alert className="mb-6">
          <UserRoundIcon aria-hidden />
          <AlertTitle>Browsing {ownerLabel}&apos;s library</AlertTitle>
          <AlertDescription>
            You are viewing another user&apos;s data in admin mode. Every change you make here stays
            owned by {ownerLabel}.{" "}
            <Link href="/library" className="underline underline-offset-3">
              Back to my library
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          {ownerLabel ? `${ownerLabel}'s library` : "Library"}
        </h1>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setTagsDialogOpen(true)}>
            <TagsIcon aria-hidden />
            Manage tags
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <CirclePlusIcon aria-hidden />
            Create topic
          </Button>
        </div>
      </div>
      <div className="mt-6 flex flex-col gap-3 sm:flex-row">
        <div className="flex-1">
          <Label htmlFor="library-search" className="sr-only">
            Search topics
          </Label>
          <Input
            id="library-search"
            placeholder="Search topics by title…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="sm:w-64">
          <Label htmlFor="library-tag-filter" className="sr-only">
            Filter by tags
          </Label>
          <Select
            value=""
            onValueChange={(tagId: string | null) => {
              if (!tagId) return
              setSelectedTagIds((current) =>
                current.includes(tagId) ? current : [...current, tagId],
              )
            }}
          >
            <SelectTrigger id="library-tag-filter">
              <SelectValue placeholder="Filter by tag…" />
            </SelectTrigger>
            <SelectContent>
              {tags.length === 0 ? (
                <div className="text-muted-foreground px-2 py-1.5 text-sm">No tags yet</div>
              ) : (
                tags
                  .filter((tag) => !selectedTagIds.includes(tag.id))
                  .map((tag) => (
                    <SelectItem key={tag.id} value={tag.id}>
                      {tag.name}
                    </SelectItem>
                  ))
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedTagIds.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {selectedTagIds.map((tagId) => {
            const tag = tagsById.get(tagId)
            return (
              <Badge key={tagId} variant="secondary" className="gap-1">
                {tag?.name ?? "Unknown tag"}
                <button
                  type="button"
                  aria-label={`Remove filter ${tag?.name ?? "tag"}`}
                  className="hover:bg-muted-foreground/20 rounded-sm px-1"
                  onClick={() =>
                    setSelectedTagIds((current) => current.filter((id) => id !== tagId))
                  }
                >
                  ×
                </button>
              </Badge>
            )
          })}
        </div>
      ) : null}

      {error ? (
        <Alert variant="destructive" className="mt-6">
          <AlertTitle>Could not load your library</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <Separator className="my-6" />

      {loading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : topics.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          {query || selectedTagIds.length > 0
            ? "No topics match the current filters."
            : "Welcome! Create your first topic and add questions to start practicing."}
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {topics.map((topic) => (
            <li key={topic.id}>
              <Card className="py-4 transition-colors hover:bg-muted/40">
                <CardHeader>
                  <CardTitle>
                    <a
                      href={withOwner(`/library/topics/${topic.id}`, ownerId)}
                      className="hover:underline"
                    >
                      {topic.title}
                    </a>
                  </CardTitle>
                  <CardDescription className="line-clamp-2">
                    {topic.description ?? "No description"}
                  </CardDescription>
                  <CardAction className="flex flex-col items-end gap-2">
                    <DeleteTopicButton
                      topicId={topic.id}
                      title={topic.title}
                      ownerId={ownerId}
                      onDeleted={() => library.reload()}
                    />
                  </CardAction>
                  {topic.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {topic.tags.map((tag) => (
                        <Badge key={tag.id} variant="outline">
                          {tag.name}
                        </Badge>
                      ))}
                    </div>
                  ) : null}
                </CardHeader>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <TagsManagerDialog
        open={tagsDialogOpen}
        onOpenChange={setTagsDialogOpen}
        tags={tags}
        ownerId={ownerId}
        onTagsChanged={() => library.reload()}
      />
      <CreateTopicDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        tags={tags}
        ownerId={ownerId}
        onCreated={(topic) => router.push(withOwner(`/library/topics/${topic.id}`, ownerId))}
      />
    </div>
  )
}

function DeleteTopicButton({
  topicId,
  title,
  ownerId,
  onDeleted,
}: {
  topicId: string
  title: string
  ownerId?: string | null
  onDeleted: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onDelete() {
    setPending(true)
    try {
      await apiFetch(withOwner(`/api/topics/${topicId}`, ownerId), { method: "DELETE" })
      onDeleted()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Delete failed.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={confirming} onOpenChange={setConfirming}>
      <DialogTrigger
        render={<Button variant="ghost" size="icon" aria-label={`Delete topic ${title}`} />}
      >
        <Trash2Icon aria-hidden />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{title}”?</DialogTitle>
          <DialogDescription>
            The topic and its questions are removed from the library. Recordings belonging to its
            questions are cleaned up in the background.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setConfirming(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onDelete} disabled={pending}>
            {pending ? "Deleting…" : "Delete topic"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function TagsManagerDialog({
  open,
  onOpenChange,
  tags,
  ownerId,
  onTagsChanged,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tags: TagView[]
  ownerId?: string | null
  onTagsChanged: (tags: TagView[]) => void
}) {
  const [name, setName] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reload() {
    onTagsChanged(await apiFetch<TagView[]>(withOwner("/api/tags", ownerId)))
  }

  async function onCreate(event: React.FormEvent) {
    event.preventDefault()
    if (pending || name.trim().length === 0) return
    setPending(true)
    setError(null)
    try {
      await apiFetch(withOwner("/api/tags", ownerId), {
        method: "POST",
        body: JSON.stringify({ name: name.trim() }),
      })
      setName("")
      await reload()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not create the tag.")
    } finally {
      setPending(false)
    }
  }

  async function onDelete(tagId: string, tagName: string) {
    setError(null)
    try {
      await apiFetch(withOwner(`/api/tags/${tagId}`, ownerId), { method: "DELETE" })
      await reload()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : `Could not delete ${tagName}.`)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Manage tags</DialogTitle>
          <DialogDescription>
            Tags are free-form labels. Deleting a tag removes it from topics but never deletes
            topics.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onCreate} className="flex items-end gap-2">
          <div className="flex-1">
            <Label htmlFor="new-tag-name">New tag</Label>
            <Input
              id="new-tag-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Part 1, Travel, Work"
              maxLength={50}
            />
          </div>
          <Button type="submit" disabled={pending || name.trim().length === 0}>
            {pending ? "Adding…" : "Add"}
          </Button>
        </form>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {tags.length === 0 ? (
          <p className="text-muted-foreground text-sm">No tags yet.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {tags.map((tag) => (
              <li key={tag.id}>
                <Badge variant="secondary" className="gap-1 py-1">
                  {tag.name}
                  <button
                    type="button"
                    aria-label={`Delete tag ${tag.name}`}
                    className="hover:bg-muted-foreground/20 rounded-sm px-1"
                    onClick={() => onDelete(tag.id, tag.name)}
                  >
                    ×
                  </button>
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}

function CreateTopicDialog({
  open,
  onOpenChange,
  tags,
  ownerId,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tags: TagView[]
  ownerId?: string | null
  onCreated: (topic: TopicListItem) => void
}) {
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [tagIds, setTagIds] = useState<string[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || title.trim().length === 0) return
    setPending(true)
    setError(null)
    try {
      const topic = await apiFetch<TopicListItem>(withOwner("/api/topics", ownerId), {
        method: "POST",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim().length > 0 ? description.trim() : null,
          tagIds,
        }),
      })
      onCreated(topic)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not create the topic.")
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Create topic</DialogTitle>
          <DialogDescription>A topic groups ordered practice questions.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="topic-title">Title</Label>
            <Input
              id="topic-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              required
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="topic-description">Description (optional)</Label>
            <Input
              id="topic-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={5000}
            />
          </div>
          {tags.length > 0 ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">Tags</legend>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => {
                  const checked = tagIds.includes(tag.id)
                  return (
                    <label
                      key={tag.id}
                      className="flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-sm has-[[input:checked]]:border-primary"
                    >
                      <input
                        type="checkbox"
                        className="accent-primary size-4"
                        checked={checked}
                        onChange={(event) =>
                          setTagIds((current) =>
                            event.target.checked
                              ? [...current, tag.id]
                              : current.filter((id) => id !== tag.id),
                          )
                        }
                      />
                      {tag.name}
                    </label>
                  )
                })}
              </div>
            </fieldset>
          ) : null}
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || title.trim().length === 0}>
              {pending ? "Creating…" : "Create topic"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
