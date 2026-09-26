import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db, workspaceAuditLog, workspaceCaseReviews, workspaceCases, workspaceSavedSources,
} from "@workspace/db";
import type { AuthenticatedRequest } from "../middlewares/auth";
import { roleInWorkspace } from "../lib/workspaces";
import { isKnownSavedSource } from "../lib/workspace-policy";

const router: IRouter = Router();
const userIdOf = (req: AuthenticatedRequest) => req.userId!;
const workspaceIdFromQuery = (req: AuthenticatedRequest) =>
  typeof req.query.workspaceId === "string" ? req.query.workspaceId : "";

router.get("/activity", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const workspaceId = workspaceIdFromQuery(req as AuthenticatedRequest);
  if (!workspaceId || !await roleInWorkspace(workspaceId, userId)) {
    res.status(404).json({ error: "مساحة العمل غير موجودة." });
    return;
  }
  const rows = await db.select({
    id: workspaceAuditLog.id,
    action: workspaceAuditLog.action,
    caseId: workspaceAuditLog.caseId,
    claim: workspaceCases.claim,
    metadata: workspaceAuditLog.metadata,
    createdAt: workspaceAuditLog.createdAt,
  }).from(workspaceAuditLog).leftJoin(workspaceCases, and(
    eq(workspaceCases.id, workspaceAuditLog.caseId),
    eq(workspaceCases.workspaceId, workspaceAuditLog.workspaceId),
  )).where(eq(workspaceAuditLog.workspaceId, workspaceId))
    .orderBy(desc(workspaceAuditLog.createdAt)).limit(30);

  const activities = rows.map((row) => {
    const claim = row.claim ? `: ${row.claim}` : "";
    const sourceId = typeof row.metadata.sourceId === "string" ? row.metadata.sourceId : "";
    const text = row.action === "case_created" || row.action === "case_ai_analysis_saved"
      ? `أُنشئت حالة${claim}`
      : row.action === "case_decision_changed"
        ? `حُدّث قرار المراجعة${claim}`
        : row.action === "evidence_submitted"
          ? `قُدّم مقتطف للمراجعة${claim}`
          : row.action === "evidence_reviewed"
            ? `رُوجع مقتطف${claim}`
            : row.action === "source_saved"
              ? `حُفظ مصدر${sourceId ? ` (${sourceId})` : ""}`
              : row.action === "source_unsaved"
                ? `أزيل مصدر${sourceId ? ` (${sourceId})` : ""}`
                : row.action;
    return {
      id: row.id,
      text,
      time: row.createdAt.toISOString(),
      tone: row.action === "case_decision_changed" || row.action === "evidence_reviewed" ? "success" : "neutral",
    };
  });
  res.json({ activities });
});

router.get("/reviews", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const workspaceId = workspaceIdFromQuery(req as AuthenticatedRequest);
  if (!workspaceId || !await roleInWorkspace(workspaceId, userId)) {
    res.status(404).json({ error: "مساحة العمل غير موجودة." });
    return;
  }
  const reviews = await db.select({
    id: workspaceCaseReviews.id,
    caseId: workspaceCaseReviews.caseId,
    reviewerUserId: workspaceCaseReviews.reviewerUserId,
    status: workspaceCaseReviews.status,
    reviewerNote: workspaceCaseReviews.reviewerNote,
    createdAt: workspaceCaseReviews.createdAt,
  }).from(workspaceCaseReviews)
    .where(eq(workspaceCaseReviews.workspaceId, workspaceId))
    .orderBy(desc(workspaceCaseReviews.createdAt)).limit(500);
  res.json({ reviews: reviews.map((review) => ({ ...review, createdAt: review.createdAt.toISOString() })) });
});

router.get("/sources/saved", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const workspaceId = workspaceIdFromQuery(req as AuthenticatedRequest);
  if (!workspaceId || !await roleInWorkspace(workspaceId, userId)) {
    res.status(404).json({ error: "مساحة العمل غير موجودة." });
    return;
  }
  const sources = await db.select({
    sourceId: workspaceSavedSources.sourceId,
    savedBy: workspaceSavedSources.savedBy,
    createdAt: workspaceSavedSources.createdAt,
  }).from(workspaceSavedSources)
    .where(eq(workspaceSavedSources.workspaceId, workspaceId))
    .orderBy(desc(workspaceSavedSources.createdAt));
  res.json({ sources: sources.map((source) => ({ ...source, createdAt: source.createdAt.toISOString() })) });
});

router.post("/sources/saved", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const { workspaceId, sourceId } = req.body ?? {};
  if (typeof workspaceId !== "string" || !await roleInWorkspace(workspaceId, userId)) {
    res.status(404).json({ error: "مساحة العمل غير موجودة." });
    return;
  }
  if (!isKnownSavedSource(sourceId)) {
    res.status(400).json({ error: "المصدر المطلوب غير موجود في الفهرس." });
    return;
  }
  const [created] = await db.transaction(async (tx) => {
    const [saved] = await tx.insert(workspaceSavedSources).values({
      id: randomUUID(), workspaceId, sourceId, savedBy: userId,
    }).onConflictDoNothing({
      target: [workspaceSavedSources.workspaceId, workspaceSavedSources.sourceId],
    }).returning();
    if (saved) {
      await tx.insert(workspaceAuditLog).values({
        id: randomUUID(), workspaceId, actorUserId: userId, action: "source_saved",
        metadata: { sourceId },
      });
    }
    return [saved];
  });
  res.status(created ? 201 : 200).json({ saved: true, sourceId });
});

router.delete("/sources/saved/:sourceId", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "";
  if (!workspaceId || !await roleInWorkspace(workspaceId, userId)) {
    res.status(404).json({ error: "مساحة العمل غير موجودة." });
    return;
  }
  if (!isKnownSavedSource(req.params.sourceId)) {
    res.status(400).json({ error: "المصدر المطلوب غير موجود في الفهرس." });
    return;
  }
  await db.transaction(async (tx) => {
    const [removed] = await tx.delete(workspaceSavedSources).where(and(
      eq(workspaceSavedSources.workspaceId, workspaceId),
      eq(workspaceSavedSources.sourceId, req.params.sourceId),
    )).returning();
    if (removed) {
      await tx.insert(workspaceAuditLog).values({
        id: randomUUID(), workspaceId, actorUserId: userId, action: "source_unsaved",
        metadata: { sourceId: removed.sourceId },
      });
    }
  });
  res.json({ saved: false, sourceId: req.params.sourceId });
});

export default router;