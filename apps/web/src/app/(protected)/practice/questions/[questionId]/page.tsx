import { and, asc, eq, isNull } from "drizzle-orm"
import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { getDb } from "@/lib/db"
import { drafts, questions, topics } from "@speaking-track/db"
import { listRecordingsForQuestion } from "@/lib/services/recordings"
import { PracticeWorkspace } from "./practice-workspace"

/**
 * Practice workspace (task 07): one owner-authorized server composition for
 * question/topic/drafts/recordings. Missing/foreign resources share the same
 * safe not-found behavior.
 */
export default async function PracticePage({
  params,
}: {
  params: Promise<{ questionId: string }>
}) {
  const { questionId } = await params
  const ownerId = resolveOwnerScope(await requireSession(await headers()))
  const db = getDb()

  const [row] = await db
    .select({ question: questions, topic: topics })
    .from(questions)
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .where(
      and(
        eq(questions.id, questionId),
        eq(topics.ownerId, ownerId),
        isNull(questions.deletedAt),
        isNull(topics.deletedAt),
      ),
    )
    .limit(1)
  if (!row) {
    notFound()
  }
  const [questionDrafts, recordings, siblings] = await Promise.all([
    db
      .select({
        id: drafts.id,
        title: drafts.title,
        content: drafts.content,
        updatedAt: drafts.updatedAt,
      })
      .from(drafts)
      .where(eq(drafts.questionId, questionId))
      .orderBy(asc(drafts.position), asc(drafts.updatedAt)),
    listRecordingsForQuestion(db, { ownerId, questionId }),
    db
      .select({ id: questions.id, position: questions.position })
      .from(questions)
      .where(and(eq(questions.topicId, row.question.topicId), isNull(questions.deletedAt)))
      .orderBy(asc(questions.position)),
  ])
  const index = siblings.findIndex((question) => question.id === questionId)
  return (
    <PracticeWorkspace
      question={{
        id: row.question.id,
        prompt: row.question.prompt,
        position: row.question.position,
        draftedAt: row.question.draftedAt?.toISOString() ?? null,
        topicId: row.topic.id,
        topicTitle: row.topic.title,
      }}
      navigation={{
        prev: index > 0 ? { id: siblings[index - 1]!.id, position: siblings[index - 1]!.position } : null,
        next:
          index >= 0 && index < siblings.length - 1
            ? { id: siblings[index + 1]!.id, position: siblings[index + 1]!.position }
            : null,
      }}
      initialDrafts={questionDrafts}
      initialRecordings={recordings}
    />
  )
}
