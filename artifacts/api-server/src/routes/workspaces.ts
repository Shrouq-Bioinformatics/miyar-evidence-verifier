import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db, teamWorkspaces, workspaceInvites, workspaceMembers } from "@workspace/db";
import type { AuthenticatedRequest } from "../middlewares/auth";
import { mayManageWorkspace } from "../lib/workspace-policy";

const router: IRouter = Router();
const userIdOf = (req: AuthenticatedRequest) => req.userId!;
const hashCode = (code: string) => createHash("sha256").update(code).digest("hex");

router.get("/workspaces", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const teams = await db.select({ id: teamWorkspaces.id, name: teamWorkspaces.name, role: workspaceMembers.role })
    .from(workspaceMembers)
    .innerJoin(teamWorkspaces, eq(teamWorkspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, userId));
  res.json({ workspaces: [{ id: userId, name: "مساحتي الشخصية", role: "owner", isPersonal: true },
    ...teams.map((item) => ({ ...item, isPersonal: false }))] });
});

router.post("/workspaces", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name || name.length > 120) {
    res.status(400).json({ error: "اسم مساحة العمل مطلوب (120 حرفًا كحد أقصى)." });
    return;
  }
  const workspace = { id: randomUUID(), name, role: "owner", isPersonal: false };
  await db.transaction(async (tx) => {
    await tx.insert(teamWorkspaces).values({ id: workspace.id, name, createdBy: userId });
    await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId, role: "owner" });
  });
  res.status(201).json({ workspace });
});

router.post("/workspaces/:id/invites", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const workspaceId = req.params.id;
  const role = req.body?.role;
  if (role !== "member" && role !== "reviewer") {
    res.status(400).json({ error: "الدور المطلوب غير مدعوم." });
    return;
  }
  const [membership] = await db.select({ role: workspaceMembers.role }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))).limit(1);
  if (!mayManageWorkspace(membership?.role)) {
    res.status(403).json({ error: "إنشاء الدعوات متاح لمالك مساحة الفريق فقط." });
    return;
  }
  const code = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  await db.insert(workspaceInvites).values({
    id: randomUUID(), workspaceId, role, createdBy: userId, codeHash: hashCode(code), expiresAt,
  });
  res.status(201).json({ code, expiresAt: expiresAt.toISOString() });
});

router.post("/workspaces/join", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const code = typeof req.body?.code === "string" ? req.body.code : "";
  if (!code || code.length > 256) {
    res.status(400).json({ error: "رمز الدعوة غير صالح." });
    return;
  }
  const codeHash = hashCode(code);
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [invite] = await tx.select().from(workspaceInvites)
      .where(and(eq(workspaceInvites.codeHash, codeHash), isNull(workspaceInvites.usedAt), gt(workspaceInvites.expiresAt, now)))
      .limit(1);
    if (!invite) return null;
    const consumed = await tx.update(workspaceInvites).set({ usedAt: now })
      .where(and(eq(workspaceInvites.id, invite.id), isNull(workspaceInvites.usedAt), gt(workspaceInvites.expiresAt, now)))
      .returning({ id: workspaceInvites.id });
    if (!consumed.length) return null;
    await tx.insert(workspaceMembers).values({ workspaceId: invite.workspaceId, userId, role: invite.role });
    const [workspace] = await tx.select({ id: teamWorkspaces.id, name: teamWorkspaces.name })
      .from(teamWorkspaces).where(eq(teamWorkspaces.id, invite.workspaceId)).limit(1);
    return workspace ? { ...workspace, role: invite.role, isPersonal: false } : null;
  });
  if (!result) {
    res.status(400).json({ error: "رمز الدعوة منتهي الصلاحية أو مستخدم أو غير صالح." });
    return;
  }
  res.json({ workspace: result });
});

router.get("/workspaces/:id/members", async (req, res): Promise<void> => {
  const userId = userIdOf(req as AuthenticatedRequest);
  const workspaceId = req.params.id;
  if (workspaceId === userId) {
    res.json({ members: [{ userId, role: "owner" }] });
    return;
  }
  const [membership] = await db.select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  if (!membership) {
    res.status(404).json({ error: "مساحة العمل غير موجودة." });
    return;
  }
  const members = await db.select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
  res.json({ members });
});

export default router;