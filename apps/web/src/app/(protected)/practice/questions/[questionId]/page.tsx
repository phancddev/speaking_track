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
  const [questionDrafts, recordings] = await Promise.all([
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
  ])
  return (
    <PracticeWorkspace
      question={{
        id: row.question.id,
        prompt: row.question.prompt,
        position: row.question.position,
        topicId: row.topic.id,
        topicTitle: row.topic.title,
      }}
      initialDrafts={questionDrafts}
      initialRecordings={recordings}
    />
  )
}
