import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const teamWorkspaces = pgTable("team_workspaces", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceMembers = pgTable("workspace_members", {
  workspaceId: text("workspace_id").notNull(),
  userId: text("user_id").notNull(),
  role: text("role").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  memberPk: uniqueIndex("workspace_members_workspace_user_idx").on(table.workspaceId, table.userId),
}));

export const workspaceInvites = pgTable("workspace_invites", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  codeHash: text("code_hash").notNull().unique(),
  role: text("role").notNull(),
  createdBy: text("created_by").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceEvidence = pgTable("workspace_evidence", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  caseId: text("case_id").notNull(),
  submittedBy: text("submitted_by").notNull(),
  title: text("title").notNull(),
  excerpt: text("excerpt").notNull(),
  reference: text("reference").notNull(),
  edition: text("edition"),
  url: text("url"),
  status: text("status").notNull().default("pending"),
  reviewerNote: text("reviewer_note"),
  reviewedBy: text("reviewed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
});