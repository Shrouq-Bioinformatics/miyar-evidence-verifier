import { createInsertSchema } from "drizzle-zod";
import { jsonb, integer, pgTable, text, timestamp, uniqueIndex, boolean } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const workspaceCases = pgTable("workspace_cases", {
  id: text("id").primaryKey(),
  claim: text("claim").notNull(),
  context: text("context").notNull(),
  language: text("language").notNull(),
  status: text("status").notNull(),
  confidence: integer("confidence").notNull().default(0),
  evidenceLevel: text("evidence_level").notNull(),
  summary: text("summary"),
  recommendedAction: text("recommended_action"),
  reviewerNote: text("reviewer_note"),
  sourceIds: jsonb("source_ids").$type<string[]>().notNull().default([]),
  sourceNotes: jsonb("source_notes").$type<string[]>().notNull().default([]),
  evidence: jsonb("evidence").$type<unknown[]>().notNull().default([]),
  analysisMode: text("analysis_mode").notNull(),
  modeNote: text("mode_note").notNull(),
  workspaceId: text("workspace_id").notNull().default("default"),
  analysisVerified: boolean("analysis_verified").notNull().default(false),
  reviewValidated: boolean("review_validated").notNull().default(false),
  analysisRequestId: text("analysis_request_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  reviewedBy: text("reviewed_by"),
}, (table) => ({
  workspaceAnalysisRequestUnique: uniqueIndex("workspace_cases_workspace_request_idx")
    .on(table.workspaceId, table.analysisRequestId),
}));

export const insertWorkspaceCaseSchema = createInsertSchema(workspaceCases).omit({
  createdAt: true,
  reviewedAt: true,
  reviewedBy: true,
  analysisVerified: true,
  reviewValidated: true,
  analysisRequestId: true,
});

export const caseStatusSchema = z.enum(["supported", "needs_review", "insufficient"]);
export type WorkspaceCase = typeof workspaceCases.$inferSelect;
export type InsertWorkspaceCase = z.infer<typeof insertWorkspaceCaseSchema>;