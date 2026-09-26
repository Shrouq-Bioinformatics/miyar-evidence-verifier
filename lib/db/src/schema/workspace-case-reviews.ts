import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, index } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const workspaceCaseReviews = pgTable("workspace_case_reviews", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  caseId: text("case_id").notNull(),
  reviewerUserId: text("reviewer_user_id").notNull(),
  status: text("status").notNull(),
  reviewerNote: text("reviewer_note").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workspaceCaseCreatedIdx: index("workspace_case_reviews_case_created_idx")
    .on(table.workspaceId, table.caseId, table.createdAt),
}));

export const insertWorkspaceCaseReviewSchema = createInsertSchema(workspaceCaseReviews).omit({
  id: true,
  createdAt: true,
});

export type InsertWorkspaceCaseReview = z.infer<typeof insertWorkspaceCaseReviewSchema>;
export type WorkspaceCaseReview = typeof workspaceCaseReviews.$inferSelect;