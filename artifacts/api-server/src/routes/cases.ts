import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db, workspaceAuditLog, workspaceCases, workspaceCaseReviews, workspaceEvidence,
} from "@workspace/db";
import type { AuthenticatedRequest } from "../middlewares/auth";
import { canReview, roleInWorkspace } from "../lib/workspaces";
import { hasMeaningfulReviewerNote } from "../lib/workspace-policy";
import { manualIntakeCaseFields, serializeCase } from "../lib/case-provenance";

const router: IRouter = Router();
const userIdOf = (req: AuthenticatedRequest) => req.userId!;

async function caseInWorkspace(workspaceId: string, caseId: string) {
  const [item] = await db.select().from(workspaceCases)
    .where(and(eq(workspaceCases.id, caseId), eq(workspaceCases.workspaceId, workspaceId))).limit(1);
  return item;
}

router.get("/cases", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : userId;
  if (!await roleInWorkspace(workspaceId, userId)) {
    res.status(404).json({ error: "مساحة العمل غير موجودة." });
    return;
  }
  const rows = await db.select().from(workspaceCases)
    .where(eq(workspaceCases.workspaceId, workspaceId)).orderBy(desc(workspaceCases.createdAt));
  res.json({ cases: rows.map(serializeCase) });
});

router.post("/cases", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const body = req.body as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "بيانات الحالة غير صالحة." });
    return;
  }
  const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : userId;
  if (!await roleInWorkspace(workspaceId, userId)) {
    res.status(404).json({ error: "مساحة العمل غير موجودة." });
    return;
  }
  const claim = typeof body.claim === "string" ? body.claim.trim() : "";
  if (!claim || typeof body.context !== "string" || typeof body.language !== "string") {
    res.status(400).json({ error: "يلزم إرسال المطالبة والسياق واللغة." });
    return;
  }
  const id = randomUUID();
  const safeIntake = manualIntakeCaseFields({
    claim,
    context: body.context as string,
    language: body.language as string,
    workspaceId,
  });
  const [row] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(workspaceCases).values({
      id,
      ...safeIntake,
    }).returning();
    await tx.insert(workspaceAuditLog).values({
      id: randomUUID(), workspaceId, actorUserId: userId, action: "case_created", caseId: id,
      metadata: { status: safeIntake.status, analysisMode: safeIntake.analysisMode },
    });
    return [created];
  });
  res.status(201).json(serializeCase(row));
});

router.patch("/cases/:id/decision", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const workspaceId = typeof req.body?.workspaceId === "string" ? req.body.workspaceId : "";
  const status = req.body?.status;
  const reviewerNote = typeof req.body?.reviewerNote === "string" ? req.body.reviewerNote.trim() : "";
  if (!workspaceId || !["supported", "needs_review", "insufficient"].includes(status)
    || !hasMeaningfulReviewerNote(reviewerNote)) {
    res.status(400).json({ error: "يلزم تحديد مساحة العمل والقرار وملاحظة مراجعة ذات معنى." });
    return;
  }
  if (!await canReview(workspaceId, userId)) {
    res.status(403).json({ error: "قرار الحالة متاح للمالك أو للمراجع فقط." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(workspaceCases)
      .where(and(eq(workspaceCases.id, req.params.id), eq(workspaceCases.workspaceId, workspaceId)))
      .limit(1).for("update");
    if (!current) return null;
    if (status === "supported") {
      const [accepted] = await tx.select({ id: workspaceEvidence.id }).from(workspaceEvidence)
        .where(and(eq(workspaceEvidence.caseId, current.id), eq(workspaceEvidence.workspaceId, workspaceId),
          eq(workspaceEvidence.status, "accepted"))).limit(1);
      if (!accepted) return { noEvidence: true as const };
    }
    const [updated] = await tx.update(workspaceCases).set({
      status, reviewerNote, reviewedAt: new Date(), reviewedBy: userId, reviewValidated: true,
    }).where(and(eq(workspaceCases.id, current.id), eq(workspaceCases.workspaceId, workspaceId))).returning();
    await tx.insert(workspaceCaseReviews).values({
      id: randomUUID(), workspaceId, caseId: current.id, reviewerUserId: userId, status, reviewerNote,
    });
    await tx.insert(workspaceAuditLog).values({
      id: randomUUID(), workspaceId, actorUserId: userId, action: "case_decision_changed", caseId: current.id,
      metadata: { status, reviewerNote },
    });
    return { updated };
  });
  if (!result) {
    res.status(404).json({ error: "لم نعثر على الحالة في مساحة العمل." });
    return;
  }
  if ("noEvidence" in result) {
    res.status(409).json({ error: "لا يمكن اعتماد الحالة دون دليل خاص بها وافق عليه مراجع." });
    return;
  }
  res.json(serializeCase(result.updated));
});

router.get("/cases/:id/audit", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "";
  if (!workspaceId || !await roleInWorkspace(workspaceId, userId)) {
    res.status(404).json({ error: "لم نعثر على الحالة." });
    return;
  }
  if (!await caseInWorkspace(workspaceId, req.params.id)) {
    res.status(404).json({ error: "لم نعثر على الحالة." });
    return;
  }
  const rows = await db.select().from(workspaceAuditLog).where(and(
    eq(workspaceAuditLog.workspaceId, workspaceId), eq(workspaceAuditLog.caseId, req.params.id),
  )).orderBy(desc(workspaceAuditLog.createdAt));
  res.json({ audit: rows.map((row) => ({
    id: row.id, action: row.action, actorUserId: row.actorUserId,
    metadata: row.metadata, createdAt: row.createdAt.toISOString(),
  })) });
});

router.get("/cases/:id/evidence", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const workspaceId = typeof req.query.workspaceId === "string" ? req.query.workspaceId : "";
  if (!workspaceId || !await roleInWorkspace(workspaceId, userId) || !await caseInWorkspace(workspaceId, req.params.id)) {
    res.status(404).json({ error: "لم نعثر على الحالة." });
    return;
  }
  const evidence = await db.select().from(workspaceEvidence).where(and(
    eq(workspaceEvidence.workspaceId, workspaceId), eq(workspaceEvidence.caseId, req.params.id),
  )).orderBy(desc(workspaceEvidence.createdAt));
  res.json({ evidence });
});

router.post("/cases/:id/evidence", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const { workspaceId, title, excerpt, reference, edition, url } = req.body ?? {};
  const sourceUrl = typeof url === "string" ? url.trim() : url;
  if (typeof workspaceId !== "string" || !await roleInWorkspace(workspaceId, userId)) {
    res.status(404).json({ error: "مساحة العمل غير موجودة." });
    return;
  }
  if (typeof title !== "string" || !title.trim() || typeof excerpt !== "string" || !excerpt.trim()
    || typeof reference !== "string" || !reference.trim()
    || title.length > 500 || excerpt.length > 20_000 || reference.length > 2_000
    || (edition !== undefined && edition !== null && typeof edition !== "string")
    || (url !== undefined && url !== null && typeof url !== "string")
    || (typeof sourceUrl === "string" && sourceUrl.length > 2_000)) {
    res.status(400).json({ error: "يلزم عنوان ومقتطف ومرجع صالح للدليل." });
    return;
  }
  if (!await caseInWorkspace(workspaceId, req.params.id)) {
    res.status(404).json({ error: "لم نعثر على الحالة." });
    return;
  }
  if (sourceUrl) {
    try {
      const parsedUrl = new URL(sourceUrl);
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") throw new Error();
    } catch {
      res.status(400).json({ error: "يجب أن يكون رابط المصدر صالحًا عبر HTTP أو HTTPS." });
      return;
    }
  }
  const [item] = await db.transaction(async (tx) => {
    const [created] = await tx.insert(workspaceEvidence).values({
      id: randomUUID(), workspaceId, caseId: req.params.id, submittedBy: userId,
      title: title.trim(), excerpt: excerpt.trim(), reference: reference.trim(),
      edition: typeof edition === "string" ? edition.trim() || null : null,
      url: sourceUrl || null,
    }).returning();
    await tx.insert(workspaceAuditLog).values({
      id: randomUUID(), workspaceId, actorUserId: userId, action: "evidence_submitted",
      caseId: req.params.id, metadata: { evidenceId: created.id, status: created.status },
    });
    return [created];
  });
  res.status(201).json({ evidence: item });
});

router.patch("/cases/:id/evidence/:evidenceId", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const { workspaceId, status } = req.body ?? {};
  const reviewerNote = typeof req.body?.reviewerNote === "string" ? req.body.reviewerNote.trim() : "";
  if (typeof workspaceId !== "string" || (status !== "accepted" && status !== "rejected")
    || !hasMeaningfulReviewerNote(reviewerNote, 8)) {
    res.status(400).json({ error: "يلزم القرار وملاحظة مراجعة ذات معنى ومساحة العمل." });
    return;
  }
  if (!await canReview(workspaceId, userId)) {
    res.status(403).json({ error: "مراجعة الأدلة متاحة للمالك أو للمراجع فقط." });
    return;
  }
  const [item] = await db.transaction(async (tx) => {
    const [caseRow] = await tx.select().from(workspaceCases).where(and(
      eq(workspaceCases.id, req.params.id), eq(workspaceCases.workspaceId, workspaceId),
    )).limit(1).for("update");
    if (!caseRow) return [];
    const [existing] = await tx.select().from(workspaceEvidence).where(and(
      eq(workspaceEvidence.id, req.params.evidenceId), eq(workspaceEvidence.caseId, req.params.id),
      eq(workspaceEvidence.workspaceId, workspaceId),
    )).limit(1);
    if (!existing) return [];
    const [updated] = await tx.update(workspaceEvidence).set({
      status, reviewerNote, reviewedBy: userId, reviewedAt: new Date(),
    }).where(eq(workspaceEvidence.id, existing.id)).returning();
    await tx.insert(workspaceAuditLog).values({
      id: randomUUID(), workspaceId, actorUserId: userId, action: "evidence_reviewed",
      caseId: req.params.id, metadata: { evidenceId: existing.id, status, reviewerNote },
    });
    if (status === "rejected") {
      if (caseRow.status === "supported") {
        const [anotherAccepted] = await tx.select({ id: workspaceEvidence.id }).from(workspaceEvidence).where(and(
          eq(workspaceEvidence.workspaceId, workspaceId), eq(workspaceEvidence.caseId, req.params.id),
          eq(workspaceEvidence.status, "accepted"),
        )).limit(1);
        // The current evidence row has already been rejected in this transaction.
        if (!anotherAccepted) {
          await tx.update(workspaceCases).set({
            status: "needs_review", reviewerNote: `أعيدت للمراجعة بعد رفض الدليل: ${reviewerNote}`,
            reviewedAt: new Date(), reviewedBy: userId,
          }).where(and(eq(workspaceCases.id, req.params.id), eq(workspaceCases.workspaceId, workspaceId)));
          await tx.insert(workspaceAuditLog).values({
            id: randomUUID(), workspaceId, actorUserId: userId, action: "case_decision_changed",
            caseId: req.params.id, metadata: { status: "needs_review", reason: "no_accepted_evidence" },
          });
        }
      }
    }
    return [updated];
  });
  if (!item) {
    res.status(404).json({ error: "لم نعثر على الدليل." });
    return;
  }
  res.json({ evidence: item });
});

export default router;