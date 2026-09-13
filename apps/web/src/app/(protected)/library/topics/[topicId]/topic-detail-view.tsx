"use client"

import {
  ArrowDownIcon,
  ArrowUpIcon,
  CirclePlusIcon,
  PencilIcon,
  Trash2Icon,
  UserRoundIcon,
  VideoIcon,
} from "lucide-react"
import Link from "next/link"
import { useState } from "react"
import { apiFetch, ApiError, withOwner } from "@/lib/api-client"
import type { TagView } from "@/lib/services/tags"
import type { QuestionListItem, TopicDetail } from "@/lib/services/topics"
import { TagsManagerDialog } from "../../../library/library-view"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle } from "@/components/ui/card"
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
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"

/**
 * Topic detail (plan/03 § Topic detail): metadata/tags, ordered questions
 * with keyboard up/down reordering, add/edit/delete, and a practice link
 * per question.
 */
export function TopicDetailView({
  initialTopic,
  tags,
  ownerId = null,
  ownerLabel = null,
}: {
  initialTopic: TopicDetail
  tags: TagView[]
  ownerId?: string | null
  ownerLabel?: string | null
}) {
  const [topic, setTopic] = useState(initialTopic)
  const [tagIds, setTagIds] = useState<string[]>(initialTopic.tags.map((tag) => tag.id))
  const [editing, setEditing] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function saveTags(nextTagIds: string[]) {
    setError(null)
    try {
      const updated = await apiFetch<TopicDetail>(withOwner(`/api/topics/${topic.id}`, ownerId), {
        method: "PATCH",
        body: JSON.stringify({ tagIds: nextTagIds }),
      })
      setTopic((current) => ({ ...current, tags: updated.tags }))
      setTagIds(nextTagIds)
      setNotice(null)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save tags.")
    }
  }

  async function reorder(questions: QuestionListItem[], index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= questions.length) return
    const next = [...questions]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved!)
    setError(null)
    try {
      const ordered = await apiFetch<QuestionListItem[]>(
        withOwner(`/api/topics/${topic.id}/questions/reorder`, ownerId),
        {
          method: "PUT",
          body: JSON.stringify({ questionIds: next.map((question) => question.id) }),
        },
      )
      setTopic((current) => ({ ...current, questions: ordered }))
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not reorder questions.")
    }
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <nav aria-label="Breadcrumb" className="text-muted-foreground mb-2 text-sm">
        <Link href={withOwner("/library", ownerId)} className="hover:underline">
          {ownerLabel ? `${ownerLabel}'s library` : "Library"}
        </Link>
        <span aria-hidden> / </span>
        <span className="text-foreground">{topic.title}</span>
      </nav>

      {ownerId && ownerLabel ? (
        <Alert className="mb-6">
          <UserRoundIcon aria-hidden />
          <AlertTitle>Editing {ownerLabel}&apos;s topic in admin mode</AlertTitle>
          <AlertDescription>
            Changes here stay owned by {ownerLabel}.{" "}
            <Link href="/library" className="underline underline-offset-3">
              Back to my library
            </Link>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{topic.title}</h1>
          {topic.description ? (
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm">{topic.description}</p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setTagsOpen(true)}>
            Manage tags
          </Button>
          <Button variant="outline" onClick={() => setEditing(true)}>
            <PencilIcon aria-hidden />
            Edit topic
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {topic.tags.length > 0 ? (
          topic.tags.map((tag) => (
            <Badge key={tag.id} variant="outline">
              {tag.name}
            </Badge>
          ))
        ) : (
          <span className="text-muted-foreground text-sm">No tags</span>
        )}
      </div>

      {error ? (
        <Alert variant="destructive" className="mt-4">
          <AlertTitle>Something went wrong</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}
      {notice ? <p className="text-muted-foreground mt-4 text-sm">{notice}</p> : null}

      <Separator className="my-6" />

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Questions</h2>
        <AddQuestionButton
          topicId={topic.id}
          ownerId={ownerId}
          onAdded={(question) =>
            setTopic((current) => ({ ...current, questions: [...current.questions, question] }))
          }
        />
      </div>

      {topic.questions.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">
          No questions yet. Add your first practice question.
        </p>
      ) : (
        <ol className="mt-4 flex flex-col gap-3">
          {topic.questions.map((question, index) => (
            <li key={question.id}>
              <Card className="py-4">
                <CardHeader>
                  <CardTitle className="flex items-start gap-3 text-base font-medium">
                    <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
                    <span className="flex-1">{question.prompt}</span>
                    <span
                      className="text-muted-foreground inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-normal"
                      title={`${question.recordingCount} recorded video${question.recordingCount === 1 ? "" : "s"}`}
                    >
                      <VideoIcon aria-hidden className="size-3.5" />
                      {question.recordingCount}
                    </span>
                  </CardTitle>
                  <div className="flex flex-wrap items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move question ${index + 1} up`}
                      disabled={index === 0}
                      onClick={() => reorder(topic.questions, index, -1)}
                    >
                      <ArrowUpIcon aria-hidden />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move question ${index + 1} down`}
                      disabled={index === topic.questions.length - 1}
                      onClick={() => reorder(topic.questions, index, 1)}
                    >
                      <ArrowDownIcon aria-hidden />
                    </Button>
                    <EditQuestionButton
                      question={question}
                      ownerId={ownerId}
                      onSaved={(updated) =>
                        setTopic((current) => ({
                          ...current,
                          questions: current.questions.map((q) =>
                            q.id === updated.id ? updated : q,
                          ),
                        }))
                      }
                    />
                    <DeleteQuestionButton
                      question={question}
                      ownerId={ownerId}
                      onDeleted={() =>
                        setTopic((current) => ({
                          ...current,
                          questions: current.questions.filter((q) => q.id !== question.id),
                        }))
                      }
                    />
                    {!ownerId ? (
                      <Button
                        variant="outline"
                        size="sm"
                        render={<Link href={`/practice/questions/${question.id}`} />}
                      >
                        Practice
                      </Button>
                    ) : null}
                  </div>
                </CardHeader>
              </Card>
            </li>
          ))}
        </ol>
      )}
      <TagsManagerDialog
        open={tagsOpen}
        onOpenChange={setTagsOpen}
        tags={tags}
        ownerId={ownerId}
        onTagsChanged={() => void saveTags(tagIds)}
      />
      <EditTopicDialog
        open={editing}
        onOpenChange={setEditing}
        topic={topic}
        ownerId={ownerId}
        onSaved={(updated) => setTopic((current) => ({ ...current, ...updated }))}
      />
    </div>
  )
}

function AddQuestionButton({
  topicId,
  ownerId,
  onAdded,
}: {
  topicId: string
  ownerId?: string | null
  onAdded: (question: QuestionListItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || prompt.trim().length === 0) return
    setPending(true)
    setError(null)
    try {
      const question = await apiFetch<QuestionListItem>(
        withOwner(`/api/topics/${topicId}/questions`, ownerId),
        {
          method: "POST",
          body: JSON.stringify({ prompt: prompt.trim() }),
        },
      )
      onAdded(question)
      setOpen(false)
      setPrompt("")
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not add the question.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <CirclePlusIcon aria-hidden />
        Add question
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add question</DialogTitle>
          <DialogDescription>New questions are appended to the end of the list.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="question-prompt">Prompt</Label>
            <Textarea
              id="question-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              maxLength={5000}
              required
              autoFocus
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || prompt.trim().length === 0}>
              {pending ? "Adding…" : "Add question"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function EditQuestionButton({
  question,
  ownerId,
  onSaved,
}: {
  question: QuestionListItem
  ownerId?: string | null
  onSaved: (question: QuestionListItem) => void
}) {
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState(question.prompt)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || prompt.trim().length === 0) return
    setPending(true)
    setError(null)
    try {
      const updated = await apiFetch<QuestionListItem>(
        withOwner(`/api/questions/${question.id}`, ownerId),
        {
          method: "PATCH",
          body: JSON.stringify({ prompt: prompt.trim() }),
        },
      )
      onSaved(updated)
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save the question.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Edit question ${question.position + 1}`}
          />
        }
      >
        <PencilIcon aria-hidden />
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit question</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-question-prompt">Prompt</Label>
            <Textarea
              id="edit-question-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              rows={4}
              maxLength={5000}
              required
              autoFocus
            />
          </div>
          {error ? (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending || prompt.trim().length === 0}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
function DeleteQuestionButton({
  question,
  ownerId,
  onDeleted,
}: {
  question: QuestionListItem
  ownerId?: string | null
  onDeleted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onDelete() {
    setPending(true)
    setError(null)
    try {
      await apiFetch(withOwner(`/api/questions/${question.id}`, ownerId), { method: "DELETE" })
      onDeleted()
      setOpen(false)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not delete the question.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Delete question ${question.position + 1}`}
          />
        }
      >
        <Trash2Icon aria-hidden />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete this question?</DialogTitle>
          <DialogDescription>
            Recordings that belong to this question are cleaned up in the background.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onDelete} disabled={pending}>
            {pending ? "Deleting…" : "Delete question"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function EditTopicDialog({
  open,
  onOpenChange,
  topic,
  ownerId,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  topic: TopicDetail
  ownerId?: string | null
  onSaved: (topic: Pick<TopicDetail, "title" | "description">) => void
}) {
  const [title, setTitle] = useState(topic.title)
  const [description, setDescription] = useState(topic.description ?? "")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (pending || title.trim().length === 0) return
    setPending(true)
    setError(null)
    try {
      const updated = await apiFetch<TopicDetail>(withOwner(`/api/topics/${topic.id}`, ownerId), {
        method: "PATCH",
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim().length > 0 ? description.trim() : null,
        }),
      })
      onSaved({ title: updated.title, description: updated.description })
      onOpenChange(false)
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save the topic.")
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit topic</DialogTitle>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="grid gap-2">
            <Label htmlFor="edit-topic-title">Title</Label>
            <Input
              id="edit-topic-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={160}
              required
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="edit-topic-description">Description</Label>
            <Textarea
              id="edit-topic-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              maxLength={5000}
            />
          </div>
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
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
