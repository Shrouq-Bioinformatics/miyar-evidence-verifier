import { jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const workspaceAuditLog = pgTable("workspace_audit_log", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  actorUserId: text("actor_user_id").notNull(),
  action: text("action").notNull(),
  caseId: text("case_id"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WorkspaceAuditLog = typeof workspaceAuditLog.$inferSelect;