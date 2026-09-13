import { and, eq, isNull } from "drizzle-orm"
import { notFound } from "next/navigation"
import { headers } from "next/headers"
import { requireSession, resolveOwnerScope } from "@/lib/auth/authorization"
import { getDb } from "@/lib/db"
import { drafts, questions, topics } from "@speaking-track/db"
import { listRecordingsForQuestion } from "@/lib/services/recordings"
import { PracticeWorkspace } from "./practice-workspace"

/**
 * Practice workspace (task 07): one owner-authorized server composition for
 * question/topic/draft/recordings. Missing/foreign resources share the same
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
    .select({
      question: questions,
      topic: topics,
      draft: drafts,
    })
    .from(questions)
    .innerJoin(topics, eq(topics.id, questions.topicId))
    .leftJoin(drafts, eq(drafts.questionId, questions.id))
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
  const recordings = await listRecordingsForQuestion(db, { ownerId, questionId })
  return (
    <PracticeWorkspace
      question={{
        id: row.question.id,
        prompt: row.question.prompt,
        position: row.question.position,
        topicId: row.topic.id,
        topicTitle: row.topic.title,
      }}
      initialDraft={row.draft?.content ?? ""}
      initialRecordings={recordings}
    />
  )
}
