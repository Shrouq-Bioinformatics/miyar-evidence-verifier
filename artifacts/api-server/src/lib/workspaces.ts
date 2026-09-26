import { and, eq } from "drizzle-orm";
import { db, workspaceMembers } from "@workspace/db";
import { mayReview, type WorkspaceRole } from "./workspace-policy";

export async function roleInWorkspace(workspaceId: string, userId: string): Promise<WorkspaceRole | null> {
  if (workspaceId === userId) return "owner";
  const [membership] = await db.select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)))
    .limit(1);
  return membership && ["owner", "reviewer", "member"].includes(membership.role)
    ? membership.role as WorkspaceRole
    : null;
}

export async function canReview(workspaceId: string, userId: string): Promise<boolean> {
  const role = await roleInWorkspace(workspaceId, userId);
  return mayReview(role);
}