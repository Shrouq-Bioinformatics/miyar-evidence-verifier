import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const workspaceSavedSources = pgTable("workspace_saved_sources", {
  id: text("id").primaryKey(),
  workspaceId: text("workspace_id").notNull(),
  sourceId: text("source_id").notNull(),
  savedBy: text("saved_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  workspaceSourceUnique: uniqueIndex("workspace_saved_sources_workspace_source_idx")
    .on(table.workspaceId, table.sourceId),
}));

export const insertWorkspaceSavedSourceSchema = createInsertSchema(workspaceSavedSources).omit({
  id: true,
  createdAt: true,
});

export type InsertWorkspaceSavedSource = z.infer<typeof insertWorkspaceSavedSourceSchema>;
export type WorkspaceSavedSource = typeof workspaceSavedSources.$inferSelect;